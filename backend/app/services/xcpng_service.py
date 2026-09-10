"""XCP-ng inventory via Xen Orchestra (XO) JSON-RPC WebSocket API.

Connects to the XO server at ws(s)://host/api/ using JSON-RPC 2.0 over WebSocket.
Authentication is session-based; credentials are the XO email + password.

This avoids direct XAPI XML-RPC (which requires root or AD subjects) in favour
of XO's own service account support.
"""

from __future__ import annotations

import json
import logging
import ssl
from typing import Any

import websockets
import websockets.exceptions

from app.services.mac_utils import normalize_mac
from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

merge_xcpng_properties = merge_zigbee_properties

_CONNECT_TIMEOUT = 10.0
_READ_TIMEOUT = 30.0
_BYTES_PER_GB = 1024 ** 3

_rpc_counter = 0


def _next_id() -> int:
    global _rpc_counter
    _rpc_counter += 1
    return _rpc_counter


def _gb(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return round(n / _BYTES_PER_GB, 1)


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _sanitize_error(exc: BaseException) -> str:
    logger.warning("XO API error (sanitized): %r", exc)
    raw = str(exc).lower()
    if "unauthorized" in raw or "authentication" in raw or "invalid credentials" in raw:
        return "Authentication failed — check XCPNG_USERNAME and XCPNG_PASSWORD"
    if "certificate" in raw or "ssl" in raw or "tls" in raw:
        return "TLS verification failed — set XCPNG_VERIFY_TLS=false for self-signed certs"
    if "timed out" in raw or "timeout" in raw:
        return "Connection to XO server timed out"
    if "refused" in raw:
        return "Connection refused by XO server"
    if "nodename nor servname" in raw or "getaddrinfo" in raw or "name or service not known" in raw:
        return "XO host could not be resolved"
    if "invalid_credentials" in raw or "incorrect" in raw:
        return "Authentication failed — check XCPNG_USERNAME and XCPNG_PASSWORD"
    return f"XO API connection failed: {type(exc).__name__}"


def _make_ssl_context(verify_tls: bool) -> ssl.SSLContext | bool:
    if not verify_tls:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return True  # websockets default: verify


async def _rpc(ws: Any, method: str, params: dict[str, Any] | None = None) -> Any:
    """Send one JSON-RPC 2.0 call over websocket; raise ConnectionError on errors."""
    rpc_id = _next_id()
    payload = {"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params or {}}
    await ws.send(json.dumps(payload))
    raw = await ws.recv()
    data = json.loads(raw)
    if "error" in data:
        err = data["error"]
        code = err.get("code") if isinstance(err, dict) else None
        msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
        if code in (1, -32000) or "credential" in msg.lower() or "authentication" in msg.lower():
            raise ConnectionError("Authentication failed — check XCPNG_USERNAME and XCPNG_PASSWORD")
        raise ConnectionError(f"XO RPC {method} error: {msg}")
    return data.get("result")


async def _sign_in(ws: Any, username: str, password: str) -> None:
    await _rpc(ws, "session.signIn", {"email": username, "password": password})


async def _get_objects(ws: Any, obj_type: str) -> dict[str, dict[str, Any]]:
    result = await _rpc(ws, "xo.getAllObjects", {"filter": {"type": obj_type}})
    if isinstance(result, dict):
        return result
    return {}


def _host_node(xo_id: str, rec: dict[str, Any]) -> dict[str, Any] | None:
    uuid = rec.get("uuid") or xo_id
    name = rec.get("name_label") or uuid
    mem = rec.get("memory") or {}
    cpus = rec.get("cpus") or {}
    return {
        "id": f"xcpng-host-{uuid}",
        "label": name,
        "type": "xcpng",
        "ieee_address": f"xcpng-host-{uuid}",
        "hostname": name,
        "ip": rec.get("address") or None,
        "status": "online",
        "cpu_count": _int_or_none(cpus.get("cores")),
        "ram_gb": _gb(mem.get("size")),
        "disk_gb": None,
        "vendor": "XCP-ng",
        "model": rec.get("version") or "Hypervisor",
        "parent_ieee": None,
        "_xo_id": xo_id,
    }


def _vm_node(
    xo_id: str,
    rec: dict[str, Any],
    host_ieee: str | None,
    mac: str | None,
) -> dict[str, Any] | None:
    uuid = rec.get("uuid") or xo_id
    name = rec.get("name_label") or f"vm-{uuid}"
    power = rec.get("power_state", "Halted")
    mem = rec.get("memory") or {}
    cpus = rec.get("CPUs") or {}
    return {
        "id": f"xcpng-vm-{uuid}",
        "label": name,
        "type": "vm",
        "ieee_address": f"xcpng-vm-{uuid}",
        "hostname": name,
        "ip": None,
        "mac": mac,
        "status": "online" if power == "Running" else "offline",
        "cpu_count": _int_or_none(cpus.get("number") or cpus.get("max")),
        "ram_gb": _gb(mem.get("size")),
        "disk_gb": None,
        "vendor": "XCP-ng",
        "model": "VM",
        "vmid": uuid,
        "parent_ieee": host_ieee,
    }


def _parse_inventory(
    hosts_raw: dict[str, dict[str, Any]],
    vms_raw: dict[str, dict[str, Any]],
    vifs_raw: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen: set[str] = set()

    # XO id → ieee map for hosts
    host_ieee: dict[str, str] = {}
    for xo_id, rec in hosts_raw.items():
        node = _host_node(xo_id, rec)
        if node and node["id"] not in seen:
            seen.add(node["id"])
            host_ieee[xo_id] = node["ieee_address"]
            nodes.append({k: v for k, v in node.items() if k != "_xo_id"})

    # XO VM id → first MAC from VIFs
    vm_mac: dict[str, str | None] = {}
    for _ref, vif in vifs_raw.items():
        vm_ref = vif.get("$VM") or vif.get("VM")
        if not vm_ref or vm_ref in vm_mac:
            continue
        raw_mac = vif.get("MAC") or ""
        vm_mac[vm_ref] = normalize_mac(raw_mac) if raw_mac else None

    # Filter and build VMs
    for xo_id, rec in vms_raw.items():
        if rec.get("is_template"):
            continue
        if rec.get("type", "VM") != "VM":
            continue

        container = rec.get("$container") or rec.get("resident_on") or ""
        parent_ieee = host_ieee.get(container) if container else None
        if parent_ieee is None and len(host_ieee) == 1:
            parent_ieee = next(iter(host_ieee.values()))

        mac = vm_mac.get(xo_id)
        node = _vm_node(xo_id, rec, parent_ieee, mac)
        if node and node["id"] not in seen:
            seen.add(node["id"])
            nodes.append(node)
            if parent_ieee:
                edges.append({"source": parent_ieee, "target": node["ieee_address"]})

    return nodes, edges


def _ws_connect(host: str, verify_tls: bool) -> Any:
    """Return a websockets async context manager for the XO API."""
    scheme = "wss" if verify_tls else "ws"
    uri = f"{scheme}://{host}/api/"
    kwargs: dict[str, Any] = {"open_timeout": _CONNECT_TIMEOUT}
    if verify_tls:
        kwargs["ssl"] = _make_ssl_context(verify_tls)
    return websockets.connect(uri, **kwargs)


async def fetch_xcpng_inventory(
    host: str,
    username: str,
    password: str,
    verify_tls: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fetch hosts + VMs from XO. Returns (nodes, edges).

    Raises:
        ConnectionError: transport / auth / API failures (sanitized).
    """
    try:
        async with _ws_connect(host, verify_tls) as ws:
            await _sign_in(ws, username, password)
            hosts_raw = await _get_objects(ws, "host")
            vms_raw = await _get_objects(ws, "VM")
            vifs_raw = await _get_objects(ws, "VIF")
        return _parse_inventory(hosts_raw, vms_raw, vifs_raw)
    except ConnectionError:
        raise
    except (websockets.exceptions.WebSocketException, OSError) as exc:
        raise ConnectionError(_sanitize_error(exc)) from exc
    except Exception as exc:
        raise ConnectionError(_sanitize_error(exc)) from exc


async def test_xcpng_connection(
    host: str,
    username: str,
    password: str,
    verify_tls: bool = False,
) -> tuple[bool, str]:
    """Reachability + auth check. Returns (connected, message). Never raises credentials outward."""
    try:
        async with _ws_connect(host, verify_tls) as ws:
            await _sign_in(ws, username, password)
            hosts = await _get_objects(ws, "host")
            vms_all = await _get_objects(ws, "VM")
            n_vms = sum(
                1 for rec in vms_all.values()
                if not rec.get("is_template") and rec.get("type", "VM") == "VM"
            )
        return True, f"Connected to XO — {len(hosts)} host(s), {n_vms} VM(s)"
    except ConnectionError as exc:
        return False, str(exc)
    except Exception as exc:
        return False, _sanitize_error(exc)


def build_xcpng_properties(node: dict[str, Any]) -> list[dict[str, Any]]:
    props: list[dict[str, Any]] = []
    vmid = node.get("vmid")
    if vmid:
        props.append({"key": "UUID", "value": str(vmid), "icon": None, "visible": False})
    if node.get("model"):
        props.append({"key": "Kind", "value": node["model"], "icon": None, "visible": False})
    if node.get("cpu_count") is not None:
        props.append({"key": "CPU Cores", "value": str(node["cpu_count"]), "icon": "Cpu", "visible": False})
    if node.get("ram_gb") is not None:
        props.append({"key": "RAM", "value": f"{node['ram_gb']} GB", "icon": "MemoryStick", "visible": False})
    props.append({"key": "Source", "value": "XCP-ng / XO", "icon": None, "visible": False})
    return props
