"""LLDP/CDP topology discovery via SNMP walk.

puresnmp 2.x: Client is not a context manager; walk() takes ObjectIdentifier
and yields VarBind(oid, value) named tuples.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)

_LLDP_CHASSIS_ID = "1.0.8802.1.1.2.1.4.1.1.4"
_LLDP_PORT_ID    = "1.0.8802.1.1.2.1.4.1.1.5"
_LLDP_PORT_DESC  = "1.0.8802.1.1.2.1.4.1.1.7"
_LLDP_SYS_NAME   = "1.0.8802.1.1.2.1.4.1.1.9"
_LLDP_SYS_DESC   = "1.0.8802.1.1.2.1.4.1.1.10"

_CDP_DEVICE_ID   = "1.3.6.1.4.1.9.9.23.1.2.1.1.6"
_CDP_DEVICE_PORT = "1.3.6.1.4.1.9.9.23.1.2.1.1.7"
_CDP_PLATFORM    = "1.3.6.1.4.1.9.9.23.1.2.1.1.8"
_CDP_ADDRESS     = "1.3.6.1.4.1.9.9.23.1.2.1.1.4"


def _mac_from_bytes(raw: bytes) -> str:
    if len(raw) == 6:
        return ":".join(f"{b:02x}" for b in raw)
    try:
        return raw.decode("utf-8", errors="replace").strip()
    except Exception:
        return raw.hex()


def _str_from_raw(raw: Any) -> str | None:
    if raw is None:
        return None
    if hasattr(raw, "pythonize"):
        val = raw.pythonize()
        if isinstance(val, bytes):
            return val.decode("utf-8", errors="replace").strip() or None
        return str(val) or None
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace").strip() or None
    return str(raw) or None


def _ip_from_bytes(raw: bytes) -> str | None:
    if len(raw) == 4:
        return ".".join(str(b) for b in raw)
    return raw.hex()


def _index_tail(oid_str: str, base: str) -> tuple[int, int] | None:
    """Extract (localPortNum, remoteIndex) from an OID returned by walk."""
    s = str(oid_str)
    if not s.startswith(base):
        return None
    suffix = s[len(base):].lstrip(".")
    parts = suffix.split(".")
    if len(parts) < 2:
        return None
    try:
        if len(parts) == 2:
            return int(parts[0]), int(parts[1])
        return int(parts[-2]), int(parts[-1])
    except ValueError:
        return None


async def discover_neighbors(
    host: str,
    community: str = "public",
    port: int = 161,
    timeout: float = 10.0,
) -> list[dict[str, Any]]:
    """Walk LLDP neighbor table; fall back to CDP if empty. Returns neighbor dicts."""
    try:
        from puresnmp import ObjectIdentifier, V2C  # noqa: I001
        from puresnmp.api.raw import Client
    except ImportError:
        logger.error("puresnmp not installed — LLDP discovery unavailable")
        return []

    try:
        client = Client(host, V2C(community), port=port)
        neighbors = await _walk_lldp(client, ObjectIdentifier)
        if not neighbors:
            neighbors = await _walk_cdp(client, ObjectIdentifier)
        return neighbors
    except Exception as exc:
        logger.debug("LLDP/CDP walk failed for %s: %s", host, exc)
        return []


async def _walk_lldp(client: Any, OID: Any) -> list[dict[str, Any]]:
    table: dict[tuple[int, int], dict[str, Any]] = {}

    async def _collect(base: str, key: str, transform: Any) -> None:
        try:
            async for varbind in client.walk(OID(base)):
                oid_str = str(varbind.oid)
                idx = _index_tail(oid_str, base)
                if idx is None:
                    continue
                if idx not in table:
                    table[idx] = {"local_port_num": idx[0]}
                val = varbind.value
                if hasattr(val, "pythonize"):
                    val = val.pythonize()
                table[idx][key] = transform(val)
        except Exception as exc:
            logger.debug("LLDP walk %s failed: %s", base, exc)

    await _collect(_LLDP_CHASSIS_ID, "chassis_id",
                   lambda v: _mac_from_bytes(v) if isinstance(v, bytes) else _str_from_raw(v))
    await _collect(_LLDP_PORT_ID,    "port_id",    _str_from_raw)
    await _collect(_LLDP_PORT_DESC,  "port_desc",  _str_from_raw)
    await _collect(_LLDP_SYS_NAME,   "sys_name",   _str_from_raw)
    await _collect(_LLDP_SYS_DESC,   "sys_desc",   _str_from_raw)

    return list(table.values())


async def _walk_cdp(client: Any, OID: Any) -> list[dict[str, Any]]:
    table: dict[tuple[Any, ...], dict[str, Any]] = {}

    async def _collect(base: str, key: str, transform: Any) -> None:
        try:
            async for varbind in client.walk(OID(base)):
                oid_str = str(varbind.oid)
                if not oid_str.startswith(base):
                    continue
                suffix = tuple(oid_str[len(base):].lstrip(".").split("."))
                if suffix not in table:
                    table[suffix] = {"local_port_num": None}
                val = varbind.value
                if hasattr(val, "pythonize"):
                    val = val.pythonize()
                table[suffix][key] = transform(val)
        except Exception as exc:
            logger.debug("CDP walk %s failed: %s", base, exc)

    await _collect(_CDP_DEVICE_ID,   "sys_name",   _str_from_raw)
    await _collect(_CDP_DEVICE_PORT, "port_id",    _str_from_raw)
    await _collect(_CDP_PLATFORM,    "sys_desc",   _str_from_raw)
    await _collect(_CDP_ADDRESS,     "chassis_id",
                   lambda v: _ip_from_bytes(v) if isinstance(v, bytes) else _str_from_raw(v))

    results = []
    for entry in table.values():
        r = dict(entry)
        r.setdefault("chassis_id", None)
        r.setdefault("port_id", None)
        r.setdefault("port_desc", None)
        r.setdefault("sys_desc", None)
        if r.get("chassis_id") is None:
            r["chassis_id"] = r.get("sys_name")
        results.append(r)
    return results
