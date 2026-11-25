"""Tailscale API client: list the devices of a tailnet.

Reads ``GET /api/v2/tailnet/{tailnet}/devices?fields=all`` with either an API
access token or an OAuth client. An OAuth client (scope ``devices:core:read``)
is the recommended credential: it does not expire and cannot write. Its
client id and secret are exchanged for a one-hour access token on every run.

Identity: each device is keyed on its Tailscale ``nodeId`` as the synthetic
``tailscale-{nodeId}`` ieee. Tailscale reports no MAC address, so a device an IP
scan found on the LAN cannot be matched automatically; it is merged by hand
once, from the Device Inventory, and found by its tailnet address after that.

Addresses: only the tailnet IPv4 goes in ``ip``. The IPv6 address and the
endpoints the client reports (which include Docker bridge and public
addresses) are kept as hidden properties and never used for matching.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Same NodeProperty shape + visibility-preservation rules as the other importers.
merge_tailscale_properties = merge_zigbee_properties

API_BASE = "https://api.tailscale.com/api/v2"
TOKEN_URL = f"{API_BASE}/oauth/token"

SOURCE = "tailscale"
IEEE_PREFIX = "tailscale-"
# The property holding the tailnet IPv4, read back on re-sync to drop an old
# address from a merged row when Tailscale renumbers the device.
TAILNET_IP_KEY = "Tailscale IP"

_TIMEOUT = httpx.Timeout(15.0, connect=8.0)

# Tailscale's OS strings → homelable node types. Anything else is a server: on
# a homelab tailnet a Linux box is the common case, and the user retypes it on
# approve like any other discovery.
_TYPE_MAP: dict[str, str] = {
    "linux": "server",
    "windows": "computer",
    "macos": "computer",
    "ios": "mobile",
    "android": "mobile",
    "tvos": "generic",
    "freebsd": "server",
    "openbsd": "server",
    "illumos": "server",
}

_EXIT_ROUTES = {"0.0.0.0/0", "::/0"}


class TailscaleAuthError(ConnectionError):
    """The API or the token endpoint refused the credential, with the reason."""


class TailscaleApiError(ConnectionError):
    """The device list could not be read (unreachable, tailnet unknown, …)."""


def _api_detail(r: httpx.Response) -> str:
    """Tailscale's own error message, or ''. Never echoes request headers."""
    try:
        body = r.json()
    except ValueError:
        return ""
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error_description") or body.get("error") or "")
    return ""


async def _access_token(
    client: httpx.AsyncClient,
    api_key: str | None,
    client_id: str | None,
    client_secret: str | None,
) -> str:
    """The bearer token for the device list: the API key, or a fresh OAuth token."""
    if api_key:
        return api_key
    if not (client_id and client_secret):
        raise TailscaleAuthError("No Tailscale API key or OAuth client provided")
    try:
        r = await client.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
        )
    except httpx.TimeoutException as exc:
        raise TailscaleApiError("Tailscale did not answer in time (api.tailscale.com)") from exc
    except httpx.HTTPError as exc:
        raise TailscaleApiError(f"Cannot reach api.tailscale.com — {type(exc).__name__}") from exc
    if r.status_code in (400, 401, 403):
        detail = _api_detail(r)
        raise TailscaleAuthError(
            "OAuth client rejected" + (f" ({detail})" if detail else "")
            + " — check the client id and secret"
        )
    if r.status_code != 200:
        raise TailscaleApiError(f"Tailscale token endpoint answered HTTP {r.status_code}")
    try:
        token = r.json().get("access_token")
    except (ValueError, AttributeError):
        token = None
    if not token:
        raise TailscaleApiError("Tailscale token endpoint returned no access token")
    return str(token)


async def _fetch_devices(client: httpx.AsyncClient, token: str, tailnet: str) -> list[dict[str, Any]]:
    url = f"{API_BASE}/tailnet/{quote(tailnet or '-', safe='-.@')}/devices"
    try:
        r = await client.get(
            url,
            params={"fields": "all"},
            headers={"Authorization": f"Bearer {token}"},
        )
    except httpx.TimeoutException as exc:
        raise TailscaleApiError("Tailscale did not answer in time (api.tailscale.com)") from exc
    except httpx.HTTPError as exc:
        raise TailscaleApiError(f"Cannot reach api.tailscale.com — {type(exc).__name__}") from exc

    if r.status_code == 401:
        raise TailscaleAuthError("Tailscale rejected the credential — it is invalid or has expired")
    if r.status_code == 403:
        raise TailscaleAuthError(
            "The credential may not read devices — an OAuth client needs the devices:core:read scope"
        )
    if r.status_code == 404:
        raise TailscaleApiError(f"Tailnet '{tailnet}' not found — use '-' for the credential's own tailnet")
    if r.status_code != 200:
        detail = _api_detail(r)
        raise TailscaleApiError(
            f"Tailscale device list answered HTTP {r.status_code}" + (f" ({detail})" if detail else "")
        )
    body = r.json()
    devices = body.get("devices") if isinstance(body, dict) else None
    if not isinstance(devices, list):
        raise TailscaleApiError("Unexpected answer from the Tailscale device list")
    return [d for d in devices if isinstance(d, dict)]


def _keep(d: dict[str, Any], include_shared: bool, tags: list[str]) -> bool:
    """Shared-in devices only when asked; with a tag filter, only tagged devices."""
    if d.get("isExternal") and not include_shared:
        return False
    if tags:
        own = {str(t).lower() for t in (d.get("tags") or [])}
        return any(t.lower() in own for t in tags)
    return True


async def test_tailscale_connection(
    *,
    api_key: str | None,
    client_id: str | None,
    client_secret: str | None,
    tailnet: str,
    include_shared: bool = False,
    tags: list[str] | None = None,
) -> tuple[bool, str, int]:
    """Check the credential and count the devices an import would bring in."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            token = await _access_token(client, api_key, client_id, client_secret)
            devices = await _fetch_devices(client, token, tailnet)
    except ConnectionError as exc:
        return False, str(exc), 0
    except Exception:
        logger.exception("Unexpected error testing the Tailscale connection")
        return False, "Unexpected error talking to Tailscale", 0
    kept = [d for d in devices if _keep(d, include_shared, tags or [])]
    skipped = len(devices) - len(kept)
    message = f"Connected — {len(kept)} device(s) to import"
    if skipped:
        message += f" ({skipped} left out by the filters)"
    return True, message, len(kept)


async def fetch_tailscale_inventory(
    *,
    api_key: str | None,
    client_id: str | None,
    client_secret: str | None,
    tailnet: str,
    include_shared: bool = False,
    tags: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Fetch the tailnet's devices and return normalized dicts (one per device)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        token = await _access_token(client, api_key, client_id, client_secret)
        devices = await _fetch_devices(client, token, tailnet)
    out: list[dict[str, Any]] = []
    for d in devices:
        if not _keep(d, include_shared, tags or []):
            continue
        dev = normalize_device(d)
        if dev is not None:
            out.append(dev)
    return out


def _prop(key: str, value: str, icon: str | None = None) -> dict[str, Any]:
    """One NodeProperty row, hidden until the user opts in (inventory convention)."""
    return {"key": key, "value": value, "icon": icon, "visible": False}


def _short_name(d: dict[str, Any]) -> str:
    """The MagicDNS machine name without the tailnet suffix, else the hostname."""
    name = str(d.get("name") or "")
    first = name.split(".", 1)[0]
    return first or _reported_hostname(d)


# Hostnames that name no machine. iOS reports "localhost" for every iPhone and
# iPad, so on a tailnet with several of them the reported name says nothing.
_PLACEHOLDER_HOSTNAMES = {"localhost", "localhost.localdomain", "localhost6"}


def _reported_hostname(d: dict[str, Any]) -> str:
    """The hostname the device reports, or '' when it is a placeholder."""
    hostname = str(d.get("hostname") or "").strip()
    return "" if hostname.lower() in _PLACEHOLDER_HOSTNAMES else hostname


def _online(d: dict[str, Any]) -> bool | None:
    value = d.get("connectedToControl")
    return value if isinstance(value, bool) else None


def normalize_device(d: dict[str, Any]) -> dict[str, Any] | None:
    """Convert one Tailscale device record to a homelable inventory dict.

    Returns None for a record without a node id — the only stable identity the
    API offers.
    """
    node_id = str(d.get("nodeId") or d.get("id") or "").strip()
    if not node_id:
        return None

    addresses = [str(a) for a in (d.get("addresses") or []) if a]
    ipv4 = next((a for a in addresses if ":" not in a), None)
    ipv6 = [a for a in addresses if ":" in a]

    os_name = str(d.get("os") or "").strip()
    hostname = _reported_hostname(d) or _short_name(d)
    label = _short_name(d) or hostname or node_id

    props: list[dict[str, Any]] = []
    if ipv4:
        props.append(_prop(TAILNET_IP_KEY, ipv4, "Network"))
    for a in ipv6:
        props.append(_prop("Tailscale IPv6", a, "Network"))
    if d.get("name"):
        props.append(_prop("MagicDNS name", str(d["name"]), "Globe"))
    online = _online(d)
    if online is not None:
        props.append(_prop("Tailscale status", "online" if online else "offline", "Zap"))
    if d.get("lastSeen"):
        props.append(_prop("Last seen", str(d["lastSeen"]), "Clock"))
    if d.get("clientVersion"):
        props.append(_prop("Tailscale version", str(d["clientVersion"]), "CircuitBoard"))
    if d.get("user"):
        props.append(_prop("Tailscale user", str(d["user"]), "Tag"))
    tags = [str(t) for t in (d.get("tags") or [])]
    if tags:
        props.append(_prop("Tailscale tags", ", ".join(tags), "Tag"))
    enabled = [str(r) for r in (d.get("enabledRoutes") or [])]
    advertised = [str(r) for r in (d.get("advertisedRoutes") or [])]
    subnets = [r for r in enabled if r not in _EXIT_ROUTES]
    if subnets:
        props.append(_prop("Subnet routes", ", ".join(subnets), "Layers"))
    if _EXIT_ROUTES & set(advertised):
        approved = bool(_EXIT_ROUTES & set(enabled))
        props.append(_prop("Exit node", "approved" if approved else "advertised", "Link"))
    if d.get("isExternal"):
        props.append(_prop("Shared in", "yes", "Link"))
    if d.get("keyExpiryDisabled"):
        props.append(_prop("Key expiry", "disabled", "Key"))
    elif d.get("expires"):
        props.append(_prop("Key expires", str(d["expires"]), "Key"))
    # What the client reports as its own endpoints: LAN, public and container
    # bridge addresses alike. Context only, never identity (bridge addresses
    # repeat on every Docker host).
    endpoints = [str(e) for e in ((d.get("clientConnectivity") or {}).get("endpoints") or [])]
    if endpoints:
        props.append(_prop("Endpoints", ", ".join(endpoints), "EthernetPort"))

    return {
        "ieee_address": f"{IEEE_PREFIX}{node_id}",
        "ip": ipv4,
        "mac": None,
        "hostname": hostname or None,
        "label": label,
        "type": _TYPE_MAP.get(os_name.lower(), "server"),
        "os": _os_label(d),
        "vendor": None,
        "model": None,
        "properties": props,
        "online": online,
    }


def _os_label(d: dict[str, Any]) -> str | None:
    os_name = str(d.get("os") or "").strip()
    distro = d.get("distro") or {}
    if isinstance(distro, dict) and distro.get("name"):
        version = str(distro.get("version") or "").strip()
        return f"{distro['name']} {version}".strip()
    return os_name or None

