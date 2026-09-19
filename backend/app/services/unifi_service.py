"""UniFi Network Controller REST API client.

Cookie-based auth: POST /api/login, then /api/s/<site>/stat/device.
Supports both legacy UniFi Controller (port 8443) and UniFi OS (port 443).
"""
import contextlib
import logging
from typing import Any

import httpx

from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Same NodeProperty shape and the same visibility-preservation rules, so the
# re-sync update path reuses the contract verbatim.
merge_unifi_properties = merge_zigbee_properties


class UnifiApiError(ConnectionError):
    """No UniFi API path answered 200 for a request.

    Distinct from "the controller answered with an empty list": a wrong site
    name returns 401 ``api.err.NoSiteContext``, which must not read as a healthy
    controller with nothing in it. Subclasses ConnectionError so the routes map
    it to a 502 like any other upstream failure.
    """


# discovery_source values. Infrastructure and clients are told apart in the
# data; the UI buckets both under one UniFi filter.
SOURCE_INFRA = "unifi"
SOURCE_CLIENT = "unifi-client"

# Map UniFi device type codes to homelable node types
_TYPE_MAP: dict[str, str] = {
    "ugw": "router",    # UniFi Security Gateway
    "udm": "router",    # UniFi Dream Machine / Dream Router
    "usg": "router",
    "usw": "switch",    # UniFi Switch
    "uap": "ap",        # UniFi Access Point
    "uxg": "router",    # UniFi Express Gateway
}


async def test_unifi_connection(
    host: str,
    port: int,
    site: str,
    username: str,
    password: str,
    verify_tls: bool = False,
    known_clients: bool = False,
    active_clients: bool = False,
) -> tuple[bool, str, dict[str, int]]:
    """Test the controller and count what each selected source holds.

    Infrastructure is always counted — it doubles as the reachability check.
    The client sources are counted only when asked, so the UI can show how many
    rows a box would import before the user ticks it; list/user runs long.
    """
    counts: dict[str, int] = {}
    try:
        client = httpx.AsyncClient(verify=verify_tls, timeout=10.0)
        try:
            cookies = await _login(client, host, port, username, password)
            if not cookies:
                return False, "Login failed: invalid credentials or unreachable host", counts
            counts["infrastructure"] = len(
                await _fetch_devices(client, host, port, site, cookies)
            )
            if known_clients:
                counts["known_clients"] = len(
                    await _fetch_known_clients(client, host, port, site, cookies)
                )
            if active_clients:
                counts["active_clients"] = len(
                    await _fetch_clients(client, host, port, site, cookies)
                )
            return (
                True,
                f"Connected — {counts['infrastructure']} device(s) found in site '{site}'",
                counts,
            )
        finally:
            await client.aclose()
    except httpx.ConnectError as exc:
        return False, f"Cannot reach {host}:{port} — {exc}", counts
    except Exception as exc:
        return False, str(exc), counts


async def fetch_unifi_inventory(
    host: str,
    port: int,
    site: str,
    username: str,
    password: str,
    verify_tls: bool = False,
    infrastructure: bool = True,
    known_clients: bool = False,
    active_clients: bool = False,
) -> list[dict[str, Any]]:
    """Fetch the selected UniFi sources and return normalized dicts.

    Three sources, three different things (see README):

    - ``infrastructure`` — ``stat/device``, the adopted gear (AP, switch,
      gateway). Carries IP, model and firmware.
    - ``known_clients`` — ``list/user``, every client the controller has ever
      recorded. Persistent but thin: no IP, no point of attachment.
    - ``active_clients`` — ``stat/sta``, the sessions live right now. Carries
      the IP and the AP or switch port the client hangs off.

    A MAC seen by more than one source is merged once, live data winning over
    the persistent record.
    """
    client = httpx.AsyncClient(verify=verify_tls, timeout=15.0)
    try:
        cookies = await _login(client, host, port, username, password)
        if not cookies:
            raise ConnectionError("UniFi login failed: invalid credentials or unreachable host")

        # Weakest source first: later sources overwrite the fields they know
        # better, and `list/user` knows the least.
        merged: dict[str, dict[str, Any]] = {}
        if known_clients:
            for raw in await _fetch_known_clients(client, host, port, site, cookies):
                _merge(merged, _normalize_client(raw))
        if active_clients:
            for raw in await _fetch_clients(client, host, port, site, cookies):
                _merge(merged, _normalize_client(raw))
        if infrastructure:
            for raw in await _fetch_devices(client, host, port, site, cookies):
                _merge(merged, _normalize(raw))
        return list(merged.values())
    finally:
        await client.aclose()


def _merge(acc: dict[str, dict[str, Any]], dev: dict[str, Any] | None) -> None:
    """Add ``dev`` to ``acc``, keyed by ieee, filling blanks on a known key."""
    if dev is None:
        return
    key = dev["ieee_address"]
    prev = acc.get(key)
    if prev is None:
        acc[key] = dev
        return
    # Same device from a richer source: take its values, keep what it lacks.
    for field, value in dev.items():
        if field == "properties":
            keys = {p["key"] for p in value}
            value = value + [p for p in prev["properties"] if p["key"] not in keys]
        if value:
            prev[field] = value


async def _login(
    client: httpx.AsyncClient,
    host: str,
    port: int,
    username: str,
    password: str,
) -> dict[str, str] | None:
    """Try both UniFi OS and legacy controller login paths."""
    base = f"https://{host}:{port}"
    payload = {"username": username, "password": password}

    # UniFi OS (Dream Machine series) uses /api/auth/login
    for path in ["/api/auth/login", "/api/login"]:
        try:
            r = await client.post(f"{base}{path}", json=payload, follow_redirects=True)
            if r.status_code in (200, 201):
                return dict(r.cookies)
        except Exception:
            continue
    return None


async def _get_list(
    client: httpx.AsyncClient,
    host: str,
    port: int,
    cookies: dict[str, str],
    paths: list[str],
    what: str,
) -> list[dict[str, Any]]:
    """GET the first of ``paths`` that answers 200 and return its ``data`` list.

    Raises UnifiApiError when none does, so a wrong site (401
    ``api.err.NoSiteContext``) or a missing endpoint is reported instead of
    passing for an empty result.
    """
    base = f"https://{host}:{port}"
    headers = {}
    # UniFi OS requires X-CSRF-Token header
    if "csrf_token" in cookies:
        headers["X-CSRF-Token"] = cookies["csrf_token"]

    # Try UniFi OS proxy path first, then legacy path
    failures: list[str] = []
    for path in paths:
        try:
            r = await client.get(
                f"{base}{path}",
                cookies=cookies,
                headers=headers,
                follow_redirects=True,
            )
            if r.status_code == 200:
                data: list[dict[str, Any]] = r.json().get("data", [])
                return data
            failures.append(f"{path} → HTTP {r.status_code}")
        except Exception as exc:
            failures.append(f"{path} → {exc}")
    raise UnifiApiError(f"UniFi {what} endpoint unavailable ({'; '.join(failures)})")


async def _fetch_devices(
    client: httpx.AsyncClient,
    host: str,
    port: int,
    site: str,
    cookies: dict[str, str],
) -> list[dict[str, Any]]:
    return await _get_list(
        client,
        host,
        port,
        cookies,
        [
            f"/proxy/network/api/s/{site}/stat/device",
            f"/api/s/{site}/stat/device",
        ],
        "device",
    )


async def fetch_unifi_topology(
    host: str,
    port: int,
    site: str,
    username: str,
    password: str,
    verify_tls: bool = False,
) -> dict[str, Any]:
    """Return UniFi topology: LLDP edges between infra, client uplinks, infra MAC map."""
    empty: dict[str, Any] = {
        "lldp_edges": [], "client_uplinks": {}, "infra_macs": {}, "device_uplinks": {}, "stp_priorities": {}
    }
    client = httpx.AsyncClient(verify=verify_tls, timeout=15.0)
    try:
        cookies = await _login(client, host, port, username, password)
        if not cookies:
            return empty

        infra_devices = await _fetch_devices(client, host, port, site, cookies)
        clients = await _fetch_clients(client, host, port, site, cookies)

        lldp_edges: list[tuple[str, str]] = []
        infra_macs: dict[str, dict[str, str]] = {}

        # device_uplinks: maps a UniFi device MAC → its uplink device MAC.
        # When the uplink resolves to a known device, BFS can route correctly.
        # When it doesn't (e.g. uplink is the router), the device is a core switch
        # that should be wired directly to the BFS root.
        device_uplinks: dict[str, str] = {}
        # Maps device MAC → STP bridge priority (lower = closer to root bridge).
        # UniFi exposes this as stp_priority at the top level of each switch device.
        stp_priorities: dict[str, int] = {}

        for device in infra_devices:
            dev_mac = (device.get("mac") or "").lower()
            raw_type = (device.get("type") or "").lower()
            node_type = _TYPE_MAP.get(raw_type, "device")
            name = device.get("name") or device.get("hostname") or dev_mac
            if dev_mac:
                infra_macs[dev_mac] = {"type": node_type, "name": name}
            for neighbor in (device.get("lldp_table") or []):
                neighbor_mac = (
                    neighbor.get("chassis_id") or neighbor.get("lldp_chassis_id") or ""
                ).lower()
                if dev_mac and neighbor_mac and dev_mac != neighbor_mac:
                    lldp_edges.append((dev_mac, neighbor_mac))
            # Uplink field — present on switches/APs managed by UniFi.
            # The uplink dict uses "mac" for the upstream device MAC (not "uplink_mac").
            uplink = device.get("uplink") or {}
            uplink_mac = (uplink.get("mac") or uplink.get("uplink_mac") or "").lower()
            if dev_mac and uplink_mac and uplink_mac != dev_mac:
                device_uplinks[dev_mac] = uplink_mac
            # STP bridge priority — lowest value = root bridge. UniFi stores this
            # as stp_priority on the switch device. Only meaningful for switches.
            if raw_type.startswith("usw"):
                stp_val = device.get("stp_priority")
                if stp_val is None:
                    # Also try nested locations some firmware versions use
                    stp_val = (device.get("config") or {}).get("stp_priority")
                if stp_val is not None:
                    with contextlib.suppress(ValueError, TypeError):
                        stp_priorities[dev_mac] = int(stp_val)

        logger.info(
            "unifi_topology: device_uplinks (%d entries): %s",
            len(device_uplinks),
            {infra_macs.get(k, {}).get("name", k): v for k, v in device_uplinks.items()},
        )
        logger.info(
            "unifi_topology: stp_priorities (%d entries): %s",
            len(stp_priorities),
            {infra_macs.get(k, {}).get("name", k): v for k, v in sorted(stp_priorities.items(), key=lambda x: x[1])},
        )

        client_uplinks: dict[str, str] = {}
        for sta in clients:
            sta_mac = (sta.get("mac") or "").lower()
            if not sta_mac:
                continue
            uplink = (sta.get("ap_mac") or sta.get("sw_mac") or "").lower()
            if uplink:
                client_uplinks[sta_mac] = uplink

        return {
            "lldp_edges": lldp_edges,
            "client_uplinks": client_uplinks,
            "infra_macs": infra_macs,
            "device_uplinks": device_uplinks,
            "stp_priorities": stp_priorities,
        }
    except Exception as exc:
        logger.warning("UniFi topology fetch failed: %s", exc)
        return empty
    finally:
        await client.aclose()


async def _fetch_clients(
    client: httpx.AsyncClient,
    host: str,
    port: int,
    site: str,
    cookies: dict[str, str],
) -> list[dict[str, Any]]:
    """Fetch connected client stations (``stat/sta``) from the controller."""
    return await _get_list(
        client,
        host,
        port,
        cookies,
        [
            f"/proxy/network/api/s/{site}/stat/sta",
            f"/api/s/{site}/stat/sta",
        ],
        "active client",
    )


async def _fetch_known_clients(
    client: httpx.AsyncClient,
    host: str,
    port: int,
    site: str,
    cookies: dict[str, str],
) -> list[dict[str, Any]]:
    """Fetch every client the controller knows of (``list/user``).

    Persistent records, kept after the client disconnects — and thin: a manual
    entry carries little more than a MAC, a name and an OUI.
    """
    return await _get_list(
        client,
        host,
        port,
        cookies,
        [
            f"/proxy/network/api/s/{site}/list/user",
            f"/api/s/{site}/list/user",
        ],
        "known client",
    )


def _prop(key: str, value: str, icon: str | None = None) -> dict[str, Any]:
    """One NodeProperty row: ``{key, value, icon, visible}``.

    ``visible`` is False because the whole inventory convention is opt-in — a
    device carries more facts than a canvas should print.
    """
    return {"key": key, "value": value, "icon": icon, "visible": False}


def _normalize(d: dict[str, Any]) -> dict[str, Any]:
    """Convert a raw UniFi device record to a homelable-compatible dict."""
    raw_type = (d.get("type") or "").lower()
    node_type = _TYPE_MAP.get(raw_type, "device")

    mac = (d.get("mac") or "").lower()
    ip = d.get("ip") or None
    name = d.get("name") or d.get("hostname") or mac or "unknown"
    model = d.get("model") or None
    version = d.get("version") or None

    ieee = f"unifi-{mac}" if mac else f"unifi-{name}"

    # NodeProperty rows: keyed, with an icon from PROPERTY_ICONS, hidden until
    # the user opts in from the right panel — as the Proxmox and mesh importers
    # build theirs.
    props: list[dict[str, Any]] = []
    if raw_type:
        props.append(_prop("UniFi type", raw_type, "Tag"))
    if model:
        props.append(_prop("Model", model, "Box"))
    if version:
        props.append(_prop("Firmware", version, "CircuitBoard"))
    uptime = d.get("uptime")
    if uptime is not None:
        props.append(_prop("Uptime (s)", str(uptime), "Clock"))

    return {
        "ieee_address": ieee,
        "mac": mac,
        "ip": ip,
        "hostname": name,
        "label": name,
        "type": node_type,
        "vendor": "Ubiquiti",
        "model": model,
        "properties": props,
        "raw_type": raw_type,
        "source": SOURCE_INFRA,
    }


def _normalize_client(d: dict[str, Any]) -> dict[str, Any] | None:
    """Convert a UniFi client record (``list/user`` or ``stat/sta``) to a dict.

    Returns None for a record with no MAC — the only key both endpoints
    guarantee, and the one the inventory dedupes on.
    """
    mac = (d.get("mac") or "").lower()
    if not mac:
        return None

    name = d.get("name") or d.get("hostname") or d.get("display_name") or mac
    # stat/sta carries the live lease; list/user only ever a reservation.
    ip = d.get("ip") or d.get("fixed_ip") or None
    wired = d.get("is_wired")

    props: list[dict[str, Any]] = []
    if wired is not None:
        props.append(_prop(
            "Connection",
            "wired" if wired else "wifi",
            "EthernetPort" if wired else "Wifi",
        ))
    uplink = d.get("sw_mac") or d.get("ap_mac")
    if uplink:
        label = "Switch" if d.get("sw_mac") else "Access point"
        props.append(_prop(label, str(uplink).lower(), "Network"))
    port = d.get("sw_port")
    if port is not None:
        props.append(_prop("Switch port", str(port), "EthernetPort"))
    for field, label, icon in (
        ("essid", "SSID", "Wifi"),
        ("network", "Network", "Globe"),
        ("oui", "OUI", "Tag"),
    ):
        value = d.get(field)
        if value:
            props.append(_prop(label, str(value), icon))

    return {
        "ieee_address": f"unifi-{mac}",
        "mac": mac,
        "ip": ip,
        "hostname": name,
        "label": name,
        # UniFi says nothing reliable about what a client *is*; the user retypes
        # it on approve, like any other discovery.
        "type": "computer",
        "vendor": d.get("oui") or None,
        "model": None,
        "properties": props,
        "raw_type": "client",
        "source": SOURCE_CLIENT,
    }
