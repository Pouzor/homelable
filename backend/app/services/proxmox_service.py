"""Proxmox VE inventory service: fetch hosts + VMs + LXC via the PVE REST API.

Mirrors the Zigbee/Z-Wave import pipeline, but talks to the Proxmox VE REST API
(``/api2/json``) over HTTPS with an API token instead of MQTT. It returns plain
homelable node dicts + parent→child edge hints; DB persistence lives in the
route layer (``app.api.routes.proxmox``).

Auth uses a Proxmox **API token** (never a password):
``Authorization: PVEAPIToken=<token_id>=<secret>`` where ``token_id`` looks like
``user@realm!tokenname``. A read-only ``PVEAuditor`` role is all that is needed.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Reuse the zigbee property-merge contract verbatim (same NodeProperty shape +
# visibility-preservation rules) for re-sync updates.
merge_proxmox_properties = merge_zigbee_properties

_CONNECT_TIMEOUT = 8.0
_READ_TIMEOUT = 20.0
_BYTES_PER_GB = 1024 ** 3

# net0 config line: "name=eth0,bridge=vmbr0,ip=192.168.1.5/24,gw=..."
_LXC_IP_RE = re.compile(r"(?:^|,)ip=([0-9]{1,3}(?:\.[0-9]{1,3}){3})(?:/\d+)?")


def _sanitize_proxmox_error(exc: BaseException) -> str:
    """Return a generic, credential-free message for a Proxmox/HTTP error.

    Raw httpx errors can echo the request URL and, worse, an
    ``Authorization: PVEAPIToken=...=<secret>`` header in some stacks. Map known
    patterns to coarse categories so the token never reaches an API client. The
    original exception is logged at WARNING for operators.
    """
    logger.warning("Proxmox error (sanitized for client): %r", exc)
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Authentication failed — check the API token and its permissions"
        if code == 404:
            return "Proxmox API path not found — is this a Proxmox VE host?"
        return f"Proxmox API returned HTTP {code}"
    raw = str(exc).lower()
    if "name or service not known" in raw or "getaddrinfo" in raw or "nodename nor servname" in raw:
        return "Proxmox host could not be resolved"
    if "refused" in raw:
        return "Connection refused by Proxmox host"
    if "certificate" in raw or "ssl" in raw or "tls" in raw:
        return "TLS verification failed — enable 'skip TLS verify' for self-signed certs"
    if "timed out" in raw or "timeout" in raw:
        return "Connection to Proxmox host timed out"
    return "Proxmox connection failed"


def _auth_header(token_id: str, token_secret: str) -> dict[str, str]:
    return {"Authorization": f"PVEAPIToken={token_id}={token_secret}"}


def _gb(value: Any) -> float | None:
    """Convert a byte count to GB (1 decimal). None/0 → None."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    return round(num / _BYTES_PER_GB, 1)


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _guest_type_to_homelable(kind: str) -> str:
    """qemu → vm, lxc → lxc (both existing homelable node types)."""
    return "vm" if kind == "qemu" else "lxc"


def _extract_qemu_ip(agent_payload: dict[str, Any] | None) -> str | None:
    """Pull the first non-loopback IPv4 from a qemu guest-agent interfaces reply."""
    if not agent_payload:
        return None
    result = agent_payload.get("result")
    if not isinstance(result, list):
        return None
    for iface in result:
        if not isinstance(iface, dict):
            continue
        for addr in iface.get("ip-addresses") or []:
            if not isinstance(addr, dict):
                continue
            if addr.get("ip-address-type") != "ipv4":
                continue
            ip = addr.get("ip-address")
            if isinstance(ip, str) and ip and not ip.startswith("127."):
                return ip
    return None


def _extract_lxc_ip(config_payload: dict[str, Any] | None) -> str | None:
    """Parse a static IPv4 from an LXC ``net0`` config string (skip dhcp)."""
    if not config_payload:
        return None
    net0 = config_payload.get("net0")
    if not isinstance(net0, str):
        return None
    match = _LXC_IP_RE.search(net0)
    return match.group(1) if match else None


def _host_node(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build a homelable ``proxmox`` host node from a ``/nodes`` entry."""
    name = raw.get("node")
    if not name:
        return None
    ieee = f"pve-node-{name}"
    return {
        "id": ieee,
        "label": name,
        "type": "proxmox",
        "ieee_address": ieee,
        "hostname": name,
        "ip": raw.get("ip") or None,
        "status": "online" if raw.get("status") == "online" else "offline",
        "cpu_count": _int_or_none(raw.get("maxcpu")),
        "ram_gb": _gb(raw.get("maxmem")),
        "disk_gb": _gb(raw.get("maxdisk")),
        "vendor": "Proxmox VE",
        "model": None,
        "parent_ieee": None,
    }


def _guest_node(raw: dict[str, Any], host_name: str, kind: str, ip: str | None) -> dict[str, Any] | None:
    """Build a homelable vm/lxc node from a ``/qemu`` or ``/lxc`` list entry."""
    vmid = raw.get("vmid")
    if vmid is None:
        return None
    ieee = f"pve-{host_name}-{vmid}"
    node_type = _guest_type_to_homelable(kind)
    name = raw.get("name") or f"{node_type}-{vmid}"
    return {
        "id": ieee,
        "label": name,
        "type": node_type,
        "ieee_address": ieee,
        "hostname": name,
        "ip": ip,
        "status": "online" if raw.get("status") == "running" else "offline",
        "cpu_count": _int_or_none(raw.get("maxcpu") or raw.get("cpus")),
        "ram_gb": _gb(raw.get("maxmem")),
        "disk_gb": _gb(raw.get("maxdisk")),
        "vendor": "Proxmox VE",
        "model": kind.upper(),
        "vmid": vmid,
        "parent_ieee": f"pve-node-{host_name}",
    }


def build_proxmox_properties(node: dict[str, Any]) -> list[dict[str, Any]]:
    """Build a NodeProperty list for a Proxmox device (specs + identity).

    Icons match the existing hardware-property convention (``Cpu`` /
    ``MemoryStick`` / ``HardDrive``). All rows default ``visible=False`` — the
    user opts in from the right panel, same as the mesh importers."""
    props: list[dict[str, Any]] = []
    vmid = node.get("vmid")
    if vmid is not None:
        props.append({"key": "VMID", "value": str(vmid), "icon": None, "visible": False})
    if node.get("model"):
        props.append({"key": "Kind", "value": node["model"], "icon": None, "visible": False})
    if node.get("cpu_count") is not None:
        props.append({"key": "CPU Cores", "value": str(node["cpu_count"]), "icon": "Cpu", "visible": False})
    if node.get("ram_gb") is not None:
        props.append({"key": "RAM", "value": f"{node['ram_gb']} GB", "icon": "MemoryStick", "visible": False})
    if node.get("disk_gb") is not None:
        props.append({"key": "Disk", "value": f"{node['disk_gb']} GB", "icon": "HardDrive", "visible": False})
    props.append({"key": "Source", "value": "Proxmox VE", "icon": None, "visible": False})
    return props


def _parse_inventory(
    hosts_raw: list[dict[str, Any]],
    guests_by_host: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Assemble (nodes, edges) from fetched host + guest data.

    ``guests_by_host`` maps host name → list of already-normalized guest node
    dicts. Edges are one host→guest link per guest (materialized as canvas
    edges on approval, mirroring the zigbee/zwave link mechanism).
    """
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen: set[str] = set()

    for raw in hosts_raw:
        host = _host_node(raw)
        if host is None or host["id"] in seen:
            continue
        seen.add(host["id"])
        nodes.append(host)

    for host_name, guests in guests_by_host.items():
        host_ieee = f"pve-node-{host_name}"
        for guest in guests:
            if guest["id"] in seen:
                continue
            seen.add(guest["id"])
            nodes.append(guest)
            edges.append({"source": host_ieee, "target": guest["id"]})

    return nodes, edges


async def _get_json(client: httpx.AsyncClient, path: str) -> Any:
    resp = await client.get(path)
    resp.raise_for_status()
    return resp.json().get("data")


async def fetch_proxmox_inventory(
    host: str,
    port: int,
    token_id: str,
    token_secret: str,
    verify_tls: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fetch hosts + VMs + LXC from a Proxmox VE host, return (nodes, edges).

    Raises:
        ConnectionError: transport/DNS/TLS failures (sanitized message).
        ValueError: malformed API response.
    """
    base_url = f"https://{host}:{port}/api2/json"
    timeout = httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
    guests_by_host: dict[str, list[dict[str, Any]]] = {}

    try:
        async with httpx.AsyncClient(
            base_url=base_url,
            headers=_auth_header(token_id, token_secret),
            verify=verify_tls,
            timeout=timeout,
        ) as client:
            hosts_raw = await _get_json(client, "/nodes")
            if not isinstance(hosts_raw, list):
                raise ValueError("Malformed /nodes response")

            for host_entry in hosts_raw:
                name = host_entry.get("node")
                if not name or host_entry.get("status") != "online":
                    # Offline nodes can't be queried for guests; still shown as host.
                    continue
                guests_by_host[name] = await _fetch_host_guests(client, name)
    except httpx.HTTPStatusError as exc:
        raise ConnectionError(_sanitize_proxmox_error(exc)) from exc
    except httpx.HTTPError as exc:
        raise ConnectionError(_sanitize_proxmox_error(exc)) from exc

    return _parse_inventory(hosts_raw, guests_by_host)


async def _fetch_host_guests(
    client: httpx.AsyncClient, host_name: str
) -> list[dict[str, Any]]:
    """Fetch qemu + lxc guests for one host, resolving guest IPs best-effort."""
    guests: list[dict[str, Any]] = []

    for kind in ("qemu", "lxc"):
        try:
            entries = await _get_json(client, f"/nodes/{host_name}/{kind}")
        except httpx.HTTPError as exc:
            logger.warning("Proxmox %s list failed for %s: %s", kind, host_name, exc)
            continue
        if not isinstance(entries, list):
            continue
        for raw in entries:
            ip = await _resolve_guest_ip(client, host_name, kind, raw)
            node = _guest_node(raw, host_name, kind, ip)
            if node:
                guests.append(node)

    return guests


async def _resolve_guest_ip(
    client: httpx.AsyncClient, host_name: str, kind: str, raw: dict[str, Any]
) -> str | None:
    """Best-effort guest IP. qemu → guest agent, lxc → net0 config. Never raises."""
    vmid = raw.get("vmid")
    if vmid is None:
        return None
    try:
        if kind == "qemu":
            if raw.get("status") != "running":
                return None
            data = await _get_json(
                client, f"/nodes/{host_name}/qemu/{vmid}/agent/network-get-interfaces"
            )
            return _extract_qemu_ip(data)
        data = await _get_json(client, f"/nodes/{host_name}/lxc/{vmid}/config")
        return _extract_lxc_ip(data)
    except httpx.HTTPError:
        # Guest agent not installed / container stopped / no perms → no IP. Fine.
        return None


async def test_proxmox_connection(
    host: str,
    port: int,
    token_id: str,
    token_secret: str,
    verify_tls: bool = True,
) -> tuple[bool, str]:
    """Quick reachability + auth check via ``GET /version``.

    Returns (connected, message). Never raises credentials outward.
    """
    base_url = f"https://{host}:{port}/api2/json"
    timeout = httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(
            base_url=base_url,
            headers=_auth_header(token_id, token_secret),
            verify=verify_tls,
            timeout=timeout,
        ) as client:
            data = await _get_json(client, "/version")
        version = (data or {}).get("version", "?") if isinstance(data, dict) else "?"
        return True, f"Connected to Proxmox VE {version}"
    except httpx.HTTPError as exc:
        return False, _sanitize_proxmox_error(exc)
    except Exception as exc:  # noqa: BLE001 — surface a safe message, log the rest
        logger.exception("Unexpected error during Proxmox connection test")
        return False, _sanitize_proxmox_error(exc)
