"""UniFi Network Controller REST API client.

Cookie-based auth: POST /api/login, then /api/s/<site>/stat/device.
Supports both legacy UniFi Controller (port 8443) and UniFi OS (port 443).
"""
import contextlib
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

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
) -> tuple[bool, str]:
    """Test UniFi controller reachability and credentials."""
    try:
        client = httpx.AsyncClient(verify=verify_tls, timeout=10.0)
        try:
            cookies = await _login(client, host, port, username, password)
            if not cookies:
                return False, "Login failed: invalid credentials or unreachable host"
            devices = await _fetch_devices(client, host, port, site, cookies)
            return True, f"Connected — {len(devices)} device(s) found in site '{site}'"
        finally:
            await client.aclose()
    except httpx.ConnectError as exc:
        return False, f"Cannot reach {host}:{port} — {exc}"
    except Exception as exc:
        return False, str(exc)


async def fetch_unifi_inventory(
    host: str,
    port: int,
    site: str,
    username: str,
    password: str,
    verify_tls: bool = False,
) -> list[dict[str, Any]]:
    """Fetch all devices from the UniFi controller and return normalized dicts."""
    client = httpx.AsyncClient(verify=verify_tls, timeout=15.0)
    try:
        cookies = await _login(client, host, port, username, password)
        if not cookies:
            raise ConnectionError("UniFi login failed: invalid credentials or unreachable host")
        raw = await _fetch_devices(client, host, port, site, cookies)
        return [_normalize(d) for d in raw]
    finally:
        await client.aclose()


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


async def _fetch_devices(
    client: httpx.AsyncClient,
    host: str,
    port: int,
    site: str,
    cookies: dict[str, str],
) -> list[dict[str, Any]]:
    base = f"https://{host}:{port}"
    headers = {}
    # UniFi OS requires X-CSRF-Token header
    if "csrf_token" in cookies:
        headers["X-CSRF-Token"] = cookies["csrf_token"]

    # Try UniFi OS proxy path first, then legacy path
    for path in [
        f"/proxy/network/api/s/{site}/stat/device",
        f"/api/s/{site}/stat/device",
    ]:
        try:
            r = await client.get(
                f"{base}{path}",
                cookies=cookies,
                headers=headers,
                follow_redirects=True,
            )
            if r.status_code == 200:
                data = r.json()
                devices: list[dict[str, Any]] = data.get("data", [])
                return devices
        except Exception:
            continue
    return []


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
    """Fetch connected client stations from the UniFi controller."""
    base = f"https://{host}:{port}"
    headers = {}
    if "csrf_token" in cookies:
        headers["X-CSRF-Token"] = cookies["csrf_token"]

    for path in [
        f"/proxy/network/api/s/{site}/stat/sta",
        f"/api/s/{site}/stat/sta",
    ]:
        try:
            r = await client.get(
                f"{base}{path}",
                cookies=cookies,
                headers=headers,
                follow_redirects=True,
            )
            if r.status_code == 200:
                devices: list[dict[str, Any]] = r.json().get("data", [])
                return devices
        except Exception:
            continue
    return []


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

    props: list[dict[str, str]] = []
    if raw_type:
        props.append({"name": "UniFi type", "value": raw_type})
    if model:
        props.append({"name": "Model", "value": model})
    if version:
        props.append({"name": "Firmware", "value": version})
    uptime = d.get("uptime")
    if uptime is not None:
        props.append({"name": "Uptime (s)", "value": str(uptime)})

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
    }
