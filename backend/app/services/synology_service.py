"""Synology DSM inventory service: fetch the NAS via the DSM Web API.

Mirrors the Proxmox import pipeline, but talks to DSM (``/webapi``) over HTTPS
with a username + password session instead of an API token. It returns a
homelable ``nas`` node dict; DB persistence lives in the route layer
(``app.api.routes.synology``).

Auth uses ``SYNO.API.Auth`` login (session SID). A dedicated limited DSM user
is enough; Homelable never needs write access. Optional OTP covers 2FA on
one-off imports. The SID is never persisted.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.services.mac_utils import normalize_mac
from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Reuse the zigbee property-merge contract verbatim (same NodeProperty shape +
# visibility-preservation rules) for re-sync updates.
merge_synology_properties = merge_zigbee_properties

_CONNECT_TIMEOUT = 8.0
_READ_TIMEOUT = 20.0
_BYTES_PER_GB = 1024 ** 3
_IPV4_RE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
_MAC_RE = re.compile(r"([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})")

# DSM Auth error codes (SYNO.API.Auth).
_AUTH_BAD_CREDENTIALS = {400, 401, 402}
_AUTH_OTP_REQUIRED = {403, 406}
_AUTH_OTP_INVALID = {404, 407, 409}

_INFO_APIS = ",".join([
    "SYNO.API.Auth",
    "SYNO.Core.System",
    "SYNO.Storage.CGI.Storage",
    "SYNO.Core.Network",
    "SYNO.Core.Network.Ethernet",
    "SYNO.Core.System.Utilization",
])


def _sanitize_synology_error(exc: BaseException) -> str:
    """Return a generic, credential-free message for a DSM/HTTP error.

    Raw httpx errors can echo the request URL (and a password if login used a
    query string). Map known patterns to coarse categories so secrets never
    reach an API client. The original exception is logged at WARNING.
    """
    logger.warning("Synology error (sanitized for client): %r", exc)
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Authentication failed — check the DSM username and password"
        if code == 404:
            return "DSM API path not found — is this a Synology NAS?"
        return f"DSM API returned HTTP {code}"
    raw = str(exc).lower()
    if "name or service not known" in raw or "getaddrinfo" in raw or "nodename nor servname" in raw:
        return "Synology host could not be resolved"
    if "refused" in raw:
        return "Connection refused by Synology host"
    if "certificate" in raw or "ssl" in raw or "tls" in raw:
        return "TLS verification failed — enable 'skip TLS verify' for self-signed certs"
    if "timed out" in raw or "timeout" in raw:
        return "Connection to Synology host timed out"
    return "Synology connection failed"


def _auth_error_message(code: int | None) -> str:
    """Map a DSM Auth error code to a credential-free client message."""
    if code in _AUTH_OTP_INVALID:
        return "Invalid OTP code"
    if code in _AUTH_OTP_REQUIRED:
        return "Two-factor authentication required — enter the OTP from your authenticator app"
    if code in _AUTH_BAD_CREDENTIALS:
        return "Authentication failed — check the DSM username and password"
    return "Authentication failed — check the DSM username and password"


def _gb(value: Any) -> float | None:
    """Convert a byte count to GB (1 decimal). None/0 → None."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    return round(num / _BYTES_PER_GB, 1)


def _ram_gb(value: Any) -> float | None:
    """Convert DSM ``ram_size`` to GB.

    DSM reports RAM in MB on most firmware; some payloads use bytes. Values
    above 1 GiB-as-an-integer are treated as bytes.
    """
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    if num >= _BYTES_PER_GB:
        return round(num / _BYTES_PER_GB, 1)
    # MB → GB
    return round(num / 1024.0, 1)


def _is_ipv4(value: str | None) -> bool:
    return bool(value and _IPV4_RE.match(value))


def _cgi_path(api_map: dict[str, Any], api_name: str, default: str) -> str:
    entry = api_map.get(api_name)
    if isinstance(entry, dict) and isinstance(entry.get("path"), str) and entry["path"]:
        return str(entry["path"]).lstrip("/")
    return default


def _api_version(api_map: dict[str, Any], api_name: str, preferred: int) -> int:
    entry = api_map.get(api_name)
    if not isinstance(entry, dict):
        return preferred
    try:
        max_v = int(entry.get("maxVersion") or preferred)
    except (TypeError, ValueError):
        return preferred
    return min(preferred, max_v) if max_v > 0 else preferred


def _unwrap(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Return the ``data`` object from a DSM envelope, or the payload itself."""
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _first_str(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_ip_from_ifaces(payload: Any) -> str | None:
    """Pull the first non-loopback IPv4 from a DSM network/ethernet payload."""
    ifaces: list[Any] = []
    if isinstance(payload, list):
        ifaces = payload
    elif isinstance(payload, dict):
        for key in ("ifaces", "nics", "ethernet", "data"):
            val = payload.get(key)
            if isinstance(val, list):
                ifaces = val
                break
        else:
            ifaces = [payload]
    for iface in ifaces:
        if not isinstance(iface, dict):
            continue
        for key in ("ip", "ipv4", "addr", "address"):
            ip = iface.get(key)
            if isinstance(ip, str) and _is_ipv4(ip) and not ip.startswith("127."):
                return ip
        ip_list = iface.get("ip")
        if isinstance(ip_list, list):
            for entry in ip_list:
                candidate = entry.get("address") if isinstance(entry, dict) else entry
                if isinstance(candidate, str) and _is_ipv4(candidate) and not candidate.startswith("127."):
                    return candidate
    return None


def _extract_mac_from_ifaces(payload: Any) -> str | None:
    """Pull the first real NIC MAC from a DSM network/ethernet payload."""
    ifaces: list[Any] = []
    if isinstance(payload, list):
        ifaces = payload
    elif isinstance(payload, dict):
        for key in ("ifaces", "nics", "ethernet", "data"):
            val = payload.get(key)
            if isinstance(val, list):
                ifaces = val
                break
        else:
            ifaces = [payload]
    for iface in ifaces:
        if not isinstance(iface, dict):
            continue
        for key in ("mac", "macaddr", "hwaddr"):
            raw = iface.get(key)
            if not isinstance(raw, str):
                continue
            match = _MAC_RE.search(raw)
            if not match:
                continue
            mac = normalize_mac(match.group(1))
            if mac and mac != "00:00:00:00:00:00":
                return mac
    return None


def _volume_summaries(storage: dict[str, Any]) -> tuple[float | None, list[str], str | None]:
    """Return (total_gb, per-volume 'name used/total (pct%)' lines, health)."""
    volumes = storage.get("volumes")
    if not isinstance(volumes, list):
        return None, [], None
    total_bytes = 0.0
    lines: list[str] = []
    degraded = 0
    for vol in volumes:
        if not isinstance(vol, dict):
            continue
        size = vol.get("size") if isinstance(vol.get("size"), dict) else {}
        used = size.get("used") if size else vol.get("used")
        total = size.get("total") if size else vol.get("size_total") or vol.get("total")
        try:
            total_n = float(total) if total is not None else 0.0
        except (TypeError, ValueError):
            total_n = 0.0
        try:
            used_n = float(used) if used is not None else 0.0
        except (TypeError, ValueError):
            used_n = 0.0
        total_bytes += total_n
        name = _first_str(vol.get("vol_desc"), vol.get("desc"), vol.get("id"), vol.get("volume_id")) or "Volume"
        status = str(vol.get("status") or "unknown")
        if status and status.lower() not in ("normal", "healthy", ""):
            degraded += 1
        if total_n > 0:
            pct = round(100.0 * used_n / total_n)
            used_gb = _gb(used_n) or 0.0
            total_gb = _gb(total_n) or 0.0
            lines.append(f"{name}: {used_gb:g}/{total_gb:g} GB ({pct}%)")
        else:
            lines.append(f"{name}: {status}")
    health = None
    if volumes:
        health = "degraded" if degraded else "healthy"
    return _gb(total_bytes), lines, health


def _disk_summary(storage: dict[str, Any]) -> str | None:
    disks = storage.get("disks")
    if not isinstance(disks, list) or not disks:
        return None
    healthy = 0
    problem = 0
    for disk in disks:
        if not isinstance(disk, dict):
            continue
        status = str(disk.get("status") or "").lower()
        if status in ("normal", "healthy"):
            healthy += 1
        else:
            problem += 1
    total = healthy + problem
    if problem:
        return f"{healthy}/{total} healthy"
    return f"{total} healthy"


def _identity(serial: str | None, hostname: str | None, host: str) -> str:
    """Stable ieee: serial when present, else hostname, else the connection host."""
    token = _first_str(serial, hostname, host) or "nas"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", token).strip("-") or "nas"
    return f"syno-{safe}"


def build_synology_node(
    system: dict[str, Any],
    storage: dict[str, Any],
    ip: str | None,
    mac: str | None,
    host: str,
) -> dict[str, Any]:
    """Build a homelable ``nas`` node from DSM system + storage payloads."""
    serial = _first_str(system.get("serial"), system.get("serial_number"))
    hostname = _first_str(
        system.get("hostname"),
        system.get("server_name"),
        system.get("time", {}).get("hostname") if isinstance(system.get("time"), dict) else None,
        host,
    )
    model = _first_str(system.get("model"), system.get("product"))
    firmware = _first_str(
        system.get("firmware_ver"),
        system.get("version_string"),
        system.get("firmware_date"),
    )
    ram_gb = _ram_gb(system.get("ram_size") or system.get("ram"))
    disk_gb, volume_lines, volume_health = _volume_summaries(storage)
    disk_health = _disk_summary(storage)
    ieee = _identity(serial, hostname, host)
    label = hostname or model or "Synology NAS"
    return {
        "id": ieee,
        "label": label,
        "type": "nas",
        "ieee_address": ieee,
        "hostname": hostname,
        "ip": ip,
        "mac": mac,
        "status": "online",
        "ram_gb": ram_gb,
        "disk_gb": disk_gb,
        "vendor": "Synology",
        "model": model,
        "serial": serial,
        "firmware": firmware,
        "volume_lines": volume_lines,
        "volume_health": volume_health,
        "disk_health": disk_health,
    }


def build_synology_properties(node: dict[str, Any]) -> list[dict[str, Any]]:
    """Build a NodeProperty list for a Synology NAS (identity + storage).

    Icons match the existing hardware-property convention. All rows default
    ``visible=False`` — the user opts in from the right panel, same as Proxmox.
    """
    props: list[dict[str, Any]] = []
    if node.get("model"):
        props.append({"key": "Model", "value": str(node["model"]), "icon": None, "visible": False})
    if node.get("serial"):
        props.append({"key": "Serial", "value": str(node["serial"]), "icon": None, "visible": False})
    if node.get("firmware"):
        props.append({"key": "DSM", "value": str(node["firmware"]), "icon": None, "visible": False})
    if node.get("ram_gb") is not None:
        props.append({"key": "RAM", "value": f"{node['ram_gb']} GB", "icon": "MemoryStick", "visible": False})
    if node.get("disk_gb") is not None:
        props.append({"key": "Disk", "value": f"{node['disk_gb']} GB", "icon": "HardDrive", "visible": False})
    for i, line in enumerate(node.get("volume_lines") or [], start=1):
        props.append({"key": f"Volume {i}", "value": str(line), "icon": "HardDrive", "visible": False})
    if node.get("volume_health"):
        props.append({"key": "Volume Health", "value": str(node["volume_health"]), "icon": None, "visible": False})
    if node.get("disk_health"):
        props.append({"key": "Disks", "value": str(node["disk_health"]), "icon": "HardDrive", "visible": False})
    props.append({"key": "Source", "value": "Synology DSM", "icon": None, "visible": False})
    return props


def default_check(host: str, port: int, verify_tls: bool) -> tuple[str, str]:
    """Live-status check to apply on a freshly imported NAS.

    HTTPS when TLS is verified; TCP to the DSM port otherwise so a self-signed
    cert does not make every status check look offline.
    """
    if verify_tls:
        return "https", f"https://{host}:{port}"
    return "tcp", f"{host}:{port}"


async def _read_json(resp: httpx.Response) -> dict[str, Any]:
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("Malformed DSM response")
    return data


async def _dsm_get(
    client: httpx.AsyncClient, path: str, params: dict[str, Any]
) -> dict[str, Any]:
    resp = await client.get(f"/webapi/{path.lstrip('/')}", params=params)
    return await _read_json(resp)


async def _dsm_post(
    client: httpx.AsyncClient, path: str, data: dict[str, Any]
) -> dict[str, Any]:
    resp = await client.post(f"/webapi/{path.lstrip('/')}", data=data)
    return await _read_json(resp)


async def _query_api_map(client: httpx.AsyncClient) -> dict[str, Any]:
    payload = await _dsm_get(
        client,
        "query.cgi",
        {"api": "SYNO.API.Info", "version": "1", "method": "query", "query": _INFO_APIS},
    )
    data = payload.get("data") if payload.get("success", True) else None
    return data if isinstance(data, dict) else {}


async def _login(
    client: httpx.AsyncClient,
    api_map: dict[str, Any],
    username: str,
    password: str,
    otp_code: str | None,
) -> str:
    path = _cgi_path(api_map, "SYNO.API.Auth", "auth.cgi")
    version = _api_version(api_map, "SYNO.API.Auth", 6)
    form: dict[str, Any] = {
        "api": "SYNO.API.Auth",
        "version": str(version),
        "method": "login",
        "account": username,
        "passwd": password,
        "session": "Homelable",
        "format": "sid",
    }
    if otp_code:
        form["otp_code"] = otp_code
    payload = await _dsm_post(client, path, form)
    if not payload.get("success", False):
        err = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        code = err.get("code") if isinstance(err, dict) else None
        try:
            code_int = int(code) if code is not None else None
        except (TypeError, ValueError):
            code_int = None
        raise ConnectionError(_auth_error_message(code_int))
    data = _unwrap(payload)
    sid = data.get("sid")
    if not isinstance(sid, str) or not sid:
        raise ValueError("DSM login succeeded but returned no session id")
    return sid


async def _logout(client: httpx.AsyncClient, api_map: dict[str, Any], sid: str) -> None:
    path = _cgi_path(api_map, "SYNO.API.Auth", "auth.cgi")
    try:
        await _dsm_get(
            client,
            path,
            {
                "api": "SYNO.API.Auth",
                "version": "1",
                "method": "logout",
                "session": "Homelable",
                "_sid": sid,
            },
        )
    except httpx.HTTPError:
        logger.debug("DSM logout failed (ignored)", exc_info=True)


async def _call(
    client: httpx.AsyncClient,
    api_map: dict[str, Any],
    api_name: str,
    method: str,
    version: int,
    sid: str,
    extra: dict[str, Any] | None = None,
) -> Any:
    """Best-effort DSM call. Returns data on success, None on miss/error."""
    path = _cgi_path(api_map, api_name, "entry.cgi")
    params: dict[str, Any] = {
        "api": api_name,
        "version": str(_api_version(api_map, api_name, version)),
        "method": method,
        "_sid": sid,
    }
    if extra:
        params.update(extra)
    try:
        payload = await _dsm_get(client, path, params)
    except httpx.HTTPError as exc:
        logger.warning("DSM %s.%s failed: %s", api_name, method, exc)
        return None
    if not payload.get("success", True):
        logger.warning("DSM %s.%s returned error %s", api_name, method, payload.get("error"))
        return None
    data = payload.get("data", payload)
    return data if isinstance(data, dict) or isinstance(data, list) else None


async def _fetch_nas(
    client: httpx.AsyncClient,
    username: str,
    password: str,
    otp_code: str | None,
    host: str,
) -> dict[str, Any]:
    """Login, collect system/storage/network, logout. Returns one nas node."""
    api_map = await _query_api_map(client)
    sid = await _login(client, api_map, username, password, otp_code)
    try:
        system_raw = await _call(client, api_map, "SYNO.Core.System", "info", 3, sid)
        if not isinstance(system_raw, dict):
            # Older DSM uses method=get / getinfo.
            system_raw = await _call(client, api_map, "SYNO.Core.System", "getinfo", 1, sid)
        if not isinstance(system_raw, dict):
            raise ValueError("DSM returned no system info")
        storage_raw = await _call(
            client, api_map, "SYNO.Storage.CGI.Storage", "load_info", 1, sid
        )
        if not isinstance(storage_raw, dict):
            storage_raw = {}

        net_raw = await _call(client, api_map, "SYNO.Core.Network.Ethernet", "list", 1, sid)
        if net_raw is None:
            net_raw = await _call(client, api_map, "SYNO.Core.Network", "list", 1, sid)
        if net_raw is None:
            net_raw = await _call(client, api_map, "SYNO.Core.Network", "get", 1, sid)

        ip = _extract_ip_from_ifaces(net_raw)
        if ip is None and _is_ipv4(host):
            ip = host
        mac = _extract_mac_from_ifaces(net_raw)
        if isinstance(system_raw.get("hostname"), str) is False and isinstance(net_raw, dict):
            hostname = _first_str(net_raw.get("server_name"), net_raw.get("hostname"))
            if hostname:
                system_raw = {**system_raw, "hostname": hostname}
        return build_synology_node(system_raw, storage_raw, ip, mac, host)
    finally:
        await _logout(client, api_map, sid)


async def fetch_synology_inventory(
    host: str,
    port: int,
    username: str,
    password: str,
    verify_tls: bool = True,
    otp_code: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch the NAS from DSM and return a one-item node list.

    Raises:
        ConnectionError: transport/DNS/TLS/auth failures (sanitized message).
        ValueError: malformed API response.
    """
    timeout = httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(
            base_url=f"https://{host}:{port}",
            verify=verify_tls,
            timeout=timeout,
        ) as client:
            node = await _fetch_nas(client, username, password, otp_code, host)
    except ConnectionError:
        raise
    except httpx.HTTPStatusError as exc:
        raise ConnectionError(_sanitize_synology_error(exc)) from exc
    except httpx.HTTPError as exc:
        raise ConnectionError(_sanitize_synology_error(exc)) from exc
    node["check_method"], node["check_target"] = default_check(host, port, verify_tls)
    return [node]


async def test_synology_connection(
    host: str,
    port: int,
    username: str,
    password: str,
    verify_tls: bool = True,
    otp_code: str | None = None,
) -> tuple[bool, str]:
    """Quick reachability + auth check via DSM login + system info.

    Returns (connected, message). Never raises credentials outward.
    """
    timeout = httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(
            base_url=f"https://{host}:{port}",
            verify=verify_tls,
            timeout=timeout,
        ) as client:
            api_map = await _query_api_map(client)
            sid = await _login(client, api_map, username, password, otp_code)
            try:
                system_raw = await _call(client, api_map, "SYNO.Core.System", "info", 3, sid)
            finally:
                await _logout(client, api_map, sid)
        system = system_raw if isinstance(system_raw, dict) else {}
        model = _first_str(system.get("model"), system.get("product")) or "DSM"
        firmware = _first_str(system.get("firmware_ver"), system.get("version_string")) or ""
        extra = f" {firmware}" if firmware else ""
        return True, f"Connected to Synology {model}{extra}".strip()
    except ConnectionError as exc:
        return False, str(exc)
    except httpx.HTTPError as exc:
        return False, _sanitize_synology_error(exc)
    except Exception as exc:  # noqa: BLE001 — surface a safe message, log the rest
        logger.exception("Unexpected error during Synology connection test")
        return False, _sanitize_synology_error(exc)
