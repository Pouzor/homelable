"""Async SNMP polling via puresnmp."""
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_OIDS: list[dict[str, str]] = [
    {"oid": "1.3.6.1.2.1.1.1.0", "label": "sysDescr"},
    {"oid": "1.3.6.1.2.1.1.3.0", "label": "sysUpTime"},
    {"oid": "1.3.6.1.2.1.1.5.0", "label": "sysName"},
    {"oid": "1.3.6.1.2.1.2.1.0", "label": "ifNumber"},
]


async def poll_device(
    host: str,
    community: str = "public",
    version: str = "2c",
    port: int = 161,
    oids: list[dict[str, str]] | None = None,
    timeout: float = 5.0,
) -> list[dict[str, Any]]:
    """Poll a device via SNMP GET. Returns list of {oid, label, value, value_type}."""
    try:
        from puresnmp import ObjectIdentifier, V2C  # noqa: I001
        from puresnmp.api.raw import Client
    except ImportError:
        logger.error("puresnmp not installed — SNMP polling unavailable")
        return []

    targets = oids if oids else DEFAULT_OIDS
    results: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc).isoformat()

    client = Client(host, V2C(community), port=port)
    for target in targets:
        oid_str = target["oid"]
        label = target.get("label", oid_str)
        try:
            raw = await client.get(ObjectIdentifier(oid_str))
            value, vtype = _decode_value(raw)
            results.append({"oid": oid_str, "label": label, "value": value, "value_type": vtype, "polled_at": now})
        except Exception as exc:
            logger.debug("SNMP GET %s from %s failed: %s", oid_str, host, exc)
            results.append({"oid": oid_str, "label": label, "value": None, "value_type": "error", "polled_at": now})

    return results


def _decode_value(raw: Any) -> tuple[str, str]:
    """Convert puresnmp raw value to (str_value, type_name)."""
    # OctetString and similar types expose .pythonize() or .value; fall back to bytes attr
    if hasattr(raw, "pythonize"):
        val = raw.pythonize()
        if isinstance(val, bytes):
            return val.decode("utf-8", errors="replace").strip(), "string"
        return str(val), type(val).__name__
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace").strip(), "string"
    if isinstance(raw, int):
        return str(raw), "integer"
    return str(raw), type(raw).__name__
