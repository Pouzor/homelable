"""TP-Link Omada SDN Controller Open API client.

Talks to the official Open API (Settings > Platform Integration on the
controller), which a software controller, an OC200/OC300 hardware controller
and a cloud-based controller all serve the same way:

1. ``POST /openapi/authorize/token?grant_type=client_credentials`` with the
   Omada ID (``omadacId``) and the client ID and secret of a client-mode
   application returns an access token.
2. Every other call carries ``Authorization: AccessToken=<token>`` and lives
   under ``/openapi/v1/{omadacId}/...``.

Every answer is HTTP 200 with an ``errorCode`` in the body (0 on success), so a
rejected secret or a wrong site has to be read from the body, not the status.
"""
import logging
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.services.mac_utils import normalize_mac
from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Same NodeProperty shape and the same visibility-preservation rules, so the
# re-sync update path reuses the contract verbatim.
merge_omada_properties = merge_zigbee_properties

# discovery_source values. Infrastructure and clients are told apart in the
# data; the UI buckets both under one Omada filter.
SOURCE_INFRA = "omada"
SOURCE_CLIENT = "omada-client"

# The Open API caps pageSize at 1000.
_PAGE_SIZE = 1000

# Map the Omada device ``type`` to homelable node types.
_TYPE_MAP: dict[str, str] = {
    "gateway": "router",
    "switch": "switch",
    "ap": "ap",
}

_URL_HINT = (
    "use the controller's management address, e.g. https://192.168.0.2:8043 for a "
    "software controller, https://192.168.0.2 for an OC200/OC300, or the interface "
    "URL shown under Platform Integration for a cloud-based controller"
)
_APP_HINT = (
    "check the Omada ID, client ID and client secret under Settings > Platform "
    "Integration, and that the application uses client mode"
)


class OmadaApiError(ConnectionError):
    """The controller answered, but not with what was asked for.

    Covers a non-zero ``errorCode`` on a list call, a missing site and an
    unexpected HTTP status. Subclasses ConnectionError so the routes map it to
    a 502 like any other upstream failure.
    """


class OmadaConnectionError(ConnectionError):
    """No usable conversation: unreachable controller, a redirect, or no token."""


def normalize_omada_url(raw: str) -> str:
    """``scheme://host[:port][/path]`` without a trailing slash.

    A bare host (``192.168.0.2:8043``) gets ``https://``: the Open API is served
    over HTTPS on every controller flavour. Raises ValueError on anything that
    is not an http(s) URL with a host.
    """
    value = raw.strip()
    if not value:
        raise ValueError("Enter the controller URL")
    if "://" not in value:
        value = f"https://{value}"
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        raise ValueError(f"Not a controller URL: {raw!r} — {_URL_HINT}")
    if parts.query or parts.fragment:
        raise ValueError(f"The controller URL takes no query string: {raw!r}")
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}{parts.path.rstrip('/')}"


def omada_target(url: str) -> str:
    """The host[:port] of a controller URL, as Scan History lists a run."""
    return urlsplit(url).netloc or url


class _OmadaSession:
    """One authorized conversation with a controller."""

    def __init__(self, client: httpx.AsyncClient, base: str, omadac_id: str) -> None:
        self._client = client
        self._base = base
        self.omadac_id = omadac_id
        self._token = ""
        # Set once the v2 client list has failed, so it is not retried per site.
        self._v1_clients = False

    async def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        """One request, with transport failures turned into readable errors.

        Redirects are not followed: the client secret must never be re-posted
        to a host the user did not enter.
        """
        url = f"{self._base}{path}"
        try:
            r = await self._client.request(method, url, **kwargs)
        except httpx.ConnectError as exc:
            raise OmadaConnectionError(f"Cannot reach {self._base} ({exc}) — {_URL_HINT}") from exc
        except httpx.TimeoutException as exc:
            raise OmadaConnectionError(f"{self._base} did not answer in time") from exc
        except httpx.HTTPError as exc:
            raise OmadaConnectionError(f"Request to {self._base} failed: {exc}") from exc
        if r.is_redirect:
            location = r.headers.get("location", "")
            raise OmadaConnectionError(
                f"{self._base} redirects to {location or 'another address'} — "
                "enter that address as the controller URL"
            )
        return r

    @staticmethod
    def _body(r: httpx.Response, what: str) -> dict[str, Any]:
        try:
            body = r.json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            raise OmadaApiError(
                f"Omada {what}: HTTP {r.status_code} without an Open API answer — {_URL_HINT}"
            )
        return body

    async def resolve_omadac_id(self) -> None:
        """Read the Omada ID from ``/api/info`` when none was given.

        A software or hardware controller publishes it there without login; a
        cloud-based controller does not, so it has to be entered.
        """
        if self.omadac_id:
            return
        r = await self._send("GET", "/api/info")
        body = self._body(r, "controller info") if r.status_code == 200 else {}
        result = body.get("result")
        omadac_id = str(result.get("omadacId") or "") if isinstance(result, dict) else ""
        if not omadac_id:
            raise OmadaConnectionError(
                f"Could not read the Omada ID from {self._base} — enter it from "
                "Settings > Platform Integration (always needed for a cloud-based controller)"
            )
        self.omadac_id = omadac_id

    async def authorize(self, client_id: str, client_secret: str) -> None:
        r = await self._send(
            "POST",
            "/openapi/authorize/token",
            params={"grant_type": "client_credentials"},
            json={
                "omadacId": self.omadac_id,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        if r.status_code == 404:
            raise OmadaConnectionError(f"No Omada Open API at {self._base} — {_URL_HINT}")
        body = self._body(r, "authorization")
        code = body.get("errorCode")
        result = body.get("result")
        token = result.get("accessToken") if isinstance(result, dict) else None
        if code != 0 or not token:
            msg = body.get("msg") or f"HTTP {r.status_code}"
            raise OmadaConnectionError(f"Authorization failed: {msg} (error {code}) — {_APP_HINT}")
        self._token = str(token)

    async def _call(
        self,
        method: str,
        path: str,
        what: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        """The ``result`` of one authorized call; raises on any error code."""
        r = await self._send(
            method,
            f"/openapi/{path}",
            params=params,
            json=json,
            headers={"Authorization": f"AccessToken={self._token}"},
        )
        body = self._body(r, what)
        code = body.get("errorCode")
        if r.status_code != 200 or code != 0:
            msg = body.get("msg") or f"HTTP {r.status_code}"
            raise OmadaApiError(f"Omada {what} request failed: {msg} (error {code})")
        return body.get("result")

    async def _all_pages(
        self,
        what: str,
        fetch: Callable[[int], Awaitable[Any]],
    ) -> list[dict[str, Any]]:
        """Pages from 1 on until ``totalRows`` rows are in.

        Stops on a short page too, so a controller that over-reports
        ``totalRows`` cannot loop forever.
        """
        rows: list[dict[str, Any]] = []
        page = 1
        while True:
            result = await fetch(page)
            if not isinstance(result, dict):
                raise OmadaApiError(f"Omada {what}: unexpected answer shape")
            data = result.get("data") or []
            rows.extend(d for d in data if isinstance(d, dict))
            total = result.get("totalRows")
            if len(data) < _PAGE_SIZE or not isinstance(total, int) or len(rows) >= total:
                return rows
            page += 1

    async def _get_pages(self, path: str, what: str) -> list[dict[str, Any]]:
        async def fetch(page: int) -> Any:
            return await self._call(
                "GET", path, what, params={"page": page, "pageSize": _PAGE_SIZE}
            )

        return await self._all_pages(what, fetch)

    async def sites(self) -> list[dict[str, Any]]:
        return await self._get_pages(f"v1/{self.omadac_id}/sites", "site list")

    async def devices(self, site_id: str) -> list[dict[str, Any]]:
        return await self._get_pages(f"v1/{self.omadac_id}/sites/{site_id}/devices", "device list")

    async def clients(self, site_id: str) -> list[dict[str, Any]]:
        """Clients online now.

        Recent controllers list them with ``POST /openapi/v2/.../clients``;
        older ones only have ``GET /openapi/v1/.../clients``, which lists online
        clients only — ``scope=1`` keeps both answers the same set.
        """
        v1_path = f"v1/{self.omadac_id}/sites/{site_id}/clients"
        if self._v1_clients:
            return await self._get_pages(v1_path, "client list")
        v2_path = f"v2/{self.omadac_id}/sites/{site_id}/clients"

        async def fetch_v2(page: int) -> Any:
            return await self._call(
                "POST",
                v2_path,
                "client list",
                json={"page": page, "pageSize": _PAGE_SIZE, "scope": 1, "filters": {}},
            )

        try:
            return await self._all_pages("client list", fetch_v2)
        except OmadaApiError as exc:
            logger.debug("Omada v2 client list unavailable (%s), using v1", exc)
            self._v1_clients = True
        return await self._get_pages(v1_path, "client list")


async def _open_session(
    client: httpx.AsyncClient,
    url: str,
    omada_id: str,
    client_id: str,
    client_secret: str,
) -> _OmadaSession:
    session = _OmadaSession(client, normalize_omada_url(url), omada_id.strip())
    await session.resolve_omadac_id()
    await session.authorize(client_id, client_secret)
    return session


async def _select_sites(session: _OmadaSession, site: str) -> list[dict[str, Any]]:
    """Every site, or the one named ``site`` (by name or site ID, any case).

    A name that matches nothing is an error listing the real names, rather than
    an import that quietly finds no devices.
    """
    sites = [s for s in await session.sites() if s.get("siteId")]
    wanted = site.strip().lower()
    if not wanted:
        return sites
    picked = [
        s for s in sites
        if wanted in (str(s.get("name") or "").lower(), str(s.get("siteId")).lower())
    ]
    if not picked:
        names = ", ".join(str(s.get("name") or s["siteId"]) for s in sites) or "none"
        raise OmadaApiError(f"Site '{site}' not found on the controller (sites: {names})")
    return picked


async def test_omada_connection(
    url: str,
    omada_id: str,
    client_id: str,
    client_secret: str,
    site: str = "",
    verify_tls: bool = False,
    clients: bool = False,
) -> tuple[bool, str, dict[str, int]]:
    """Authorize and count what each selected source holds.

    Infrastructure is always counted — it doubles as the access check for the
    sites. Clients are counted only when asked, so the UI can show how many rows
    the box would import before the user ticks it.
    """
    counts: dict[str, int] = {}
    try:
        async with httpx.AsyncClient(verify=verify_tls, timeout=10.0) as client:
            session = await _open_session(client, url, omada_id, client_id, client_secret)
            sites = await _select_sites(session, site)
            counts["infrastructure"] = 0
            for s in sites:
                counts["infrastructure"] += len(await session.devices(s["siteId"]))
            if clients:
                counts["clients"] = 0
                for s in sites:
                    counts["clients"] += len(await session.clients(s["siteId"]))
        scope = f"site '{sites[0].get('name')}'" if site.strip() else f"{len(sites)} site(s)"
        return True, f"Connected — {counts['infrastructure']} device(s) found in {scope}", counts
    except (ConnectionError, ValueError) as exc:
        return False, str(exc), counts
    except Exception as exc:
        logger.exception("Unexpected error testing the Omada connection")
        return False, str(exc), counts


async def fetch_omada_inventory(
    url: str,
    omada_id: str,
    client_id: str,
    client_secret: str,
    site: str = "",
    verify_tls: bool = False,
    infrastructure: bool = True,
    clients: bool = False,
) -> list[dict[str, Any]]:
    """Fetch the selected sources of every selected site as normalized dicts.

    - ``infrastructure`` — the adopted gateways, switches and APs, with IP,
      model, firmware and the device each one uplinks to.
    - ``clients`` — the clients online now, with IP and the AP or switch port
      they hang off.

    A MAC seen twice (a device also listed as a client, or a client roaming
    between sites) is merged once, infrastructure winning.
    """
    async with httpx.AsyncClient(verify=verify_tls, timeout=15.0) as client:
        session = await _open_session(client, url, omada_id, client_id, client_secret)
        sites = await _select_sites(session, site)
        merged: dict[str, dict[str, Any]] = {}
        # Weakest source first: later sources overwrite what they know better.
        if clients:
            for s in sites:
                for raw in await session.clients(s["siteId"]):
                    _merge(merged, _normalize_client(raw, s.get("name")))
        if infrastructure:
            for s in sites:
                for raw in await session.devices(s["siteId"]):
                    _merge(merged, _normalize(raw, s.get("name")))
        return list(merged.values())


def _merge(acc: dict[str, dict[str, Any]], dev: dict[str, Any] | None) -> None:
    """Add ``dev`` to ``acc``, keyed by ieee, filling blanks on a known key."""
    if dev is None:
        return
    key = dev["ieee_address"]
    prev = acc.get(key)
    if prev is None:
        acc[key] = dev
        return
    for field, value in dev.items():
        if field == "properties":
            keys = {p["key"] for p in value}
            value = value + [p for p in prev["properties"] if p["key"] not in keys]
        if value:
            prev[field] = value


def _prop(key: str, value: str, icon: str | None = None) -> dict[str, Any]:
    """One NodeProperty row, hidden until the user opts in from the right panel."""
    return {"key": key, "value": value, "icon": icon, "visible": False}


def _peer(name: Any, mac: Any) -> str | None:
    """``name (mac)`` for the device something hangs off, or whichever is known."""
    mac_s = normalize_mac(str(mac)) if mac else None
    if name and mac_s:
        return f"{name} ({mac_s})"
    return str(name) if name else mac_s


def _normalize(d: dict[str, Any], site: Any = None) -> dict[str, Any] | None:
    """Convert an Omada device record to a homelable-compatible dict.

    Returns None without a MAC — the identity every Omada record carries and
    the key the inventory dedupes on.
    """
    mac = normalize_mac(d.get("mac"))
    if not mac:
        return None
    raw_type = str(d.get("type") or "").lower()
    name = d.get("name") or mac
    model = d.get("model") or None

    props: list[dict[str, Any]] = []
    if raw_type:
        props.append(_prop("Omada type", raw_type, "Tag"))
    if model:
        props.append(_prop("Model", str(model), "Box"))
    for field, label, icon in (
        ("firmwareVersion", "Firmware", "CircuitBoard"),
        ("sn", "Serial", "Hash"),
        ("uptime", "Uptime", "Clock"),
    ):
        value = d.get(field)
        if value not in (None, ""):
            props.append(_prop(label, str(value), icon))
    uplink = _peer(d.get("uplinkDeviceName"), d.get("uplinkDeviceMac"))
    if uplink:
        props.append(_prop("Uplink", uplink, "Network"))
    port = d.get("uplinkDevicePort")
    if uplink and port not in (None, ""):
        props.append(_prop("Uplink port", str(port), "EthernetPort"))
    if site:
        props.append(_prop("Omada site", str(site), "Globe"))

    return {
        "ieee_address": f"omada-{mac}",
        "mac": mac,
        "ip": d.get("ip") or None,
        "hostname": name,
        "label": name,
        "type": _TYPE_MAP.get(raw_type, "device"),
        "vendor": "TP-Link",
        "model": model,
        "properties": props,
        "raw_type": raw_type,
        "source": SOURCE_INFRA,
    }


def _normalize_client(d: dict[str, Any], site: Any = None) -> dict[str, Any] | None:
    """Convert an Omada client record to a homelable-compatible dict."""
    mac = normalize_mac(d.get("mac"))
    if not mac:
        return None
    name = d.get("name") or d.get("hostName") or mac
    wireless = d.get("wireless")

    props: list[dict[str, Any]] = []
    if wireless is not None:
        props.append(_prop(
            "Connection",
            "wifi" if wireless else "wired",
            "Wifi" if wireless else "EthernetPort",
        ))
    # connectDevType names the device the client hangs off; each kind has its
    # own name/MAC fields, and only a wired one has a port.
    dev_type = str(d.get("connectDevType") or "").lower()
    if dev_type == "ap" or (not dev_type and d.get("apMac")):
        attached = ("Access point", _peer(d.get("apName"), d.get("apMac")))
    elif dev_type == "switch" or (not dev_type and d.get("switchMac")):
        attached = ("Switch", _peer(d.get("switchName"), d.get("switchMac")))
    elif dev_type == "gateway" or (not dev_type and d.get("gatewayMac")):
        attached = ("Gateway", _peer(d.get("gatewayName"), d.get("gatewayMac")))
    else:
        attached = ("", None)
    if attached[1]:
        props.append(_prop(attached[0], attached[1], "Network"))
        port = d.get("port")
        if not wireless and port not in (None, ""):
            props.append(_prop("Port", str(port), "EthernetPort"))
    for field, label, icon in (
        ("ssid", "SSID", "Wifi"),
        ("networkName", "Network", "Globe"),
        ("vid", "VLAN", "Tag"),
    ):
        value = d.get(field)
        if value not in (None, ""):
            props.append(_prop(label, str(value), icon))
    if site:
        props.append(_prop("Omada site", str(site), "Globe"))

    return {
        "ieee_address": f"omada-{mac}",
        "mac": mac,
        "ip": d.get("ip") or None,
        "hostname": name,
        "label": name,
        # The controller's guess at what a client *is* is not reliable enough to
        # type a node; the user retypes it on approve, like any other discovery.
        "type": "computer",
        "vendor": d.get("vendor") or None,
        "model": None,
        "properties": props,
        "raw_type": "client",
        "source": SOURCE_CLIENT,
    }
