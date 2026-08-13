"""Keep a canvas :class:`Node` and its Device Inventory row in step.

The inventory row owns what a device *is* — addresses, services, properties,
notes, hardware, check method. A node owns only how that device is drawn on one
canvas. This module holds the matching and merging rules shared by:

* the one-off backfill that links pre-3.3.0 nodes to inventory rows,
* the approve / node-create paths, which link instead of copying,
* the canvas save write-through, which pushes a node edit back to the row.

Nothing here commits — the caller owns the transaction.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InventoryDevice, Node
from app.services.discovery_sources import add_source

logger = logging.getLogger(__name__)

# Canvas furniture: annotations, not hardware. These never get an inventory row.
FURNITURE_TYPES = frozenset({"group", "groupRect", "text"})

# Source tag for a device that only ever existed as a canvas node — the backfill
# mints its inventory row.
CANVAS_SOURCE = "canvas"

# Scalar facts the inventory row owns. Order matters only for readability.
DEVICE_SCALARS = (
    "hostname",
    "ip",
    "mac",
    "os",
    "notes",
    "cpu_count",
    "cpu_model",
    "ram_gb",
    "disk_gb",
    "check_method",
    "check_target",
)


def is_furniture(node_type: str | None) -> bool:
    return (node_type or "") in FURNITURE_TYPES


def _ip_tokens(ip: str | None) -> list[str]:
    """Split an ``ip`` field into individual addresses.

    A node or device may carry several comma-separated addresses, so identity
    matching compares per token — same rule as ``node_dedupe._ip_tokens``.
    """
    return [t.strip() for t in ip.split(",") if t.strip()] if ip else []


def _blank(value: Any) -> bool:
    return value is None or value == ""


async def find_device_for(
    db: AsyncSession,
    *,
    ip: str | None,
    mac: str | None,
    ieee: str | None,
) -> InventoryDevice | None:
    """Find the inventory row describing this host, or ``None``.

    Precedence is ieee > ip > mac, matching ``find_duplicate_node`` and the
    bulk-approve skip order so a device is identified the same way everywhere.
    Hidden rows are eligible: a hidden device is still that device, and silently
    minting a second row for it would resurrect the duplicate the user hid.
    """
    ip_toks = _ip_tokens(ip)
    conds = []
    if ieee:
        conds.append(InventoryDevice.ieee_address == ieee)
    for tok in ip_toks:
        # Narrow with a substring match, then confirm per token below — an exact
        # comparison misses rows holding several addresses.
        conds.append(InventoryDevice.ip.contains(tok))
    if mac:
        conds.append(InventoryDevice.mac == mac)
    if not conds:
        return None

    candidates = (
        await db.execute(select(InventoryDevice).where(or_(*conds)).order_by(InventoryDevice.discovered_at))
    ).scalars().all()

    for device in candidates:
        if ieee and device.ieee_address == ieee:
            return device
    for device in candidates:
        # "1.2.3.4" must not match "1.2.3.40" — confirm the token, don't trust
        # the SQL `contains`.
        if ip_toks and set(_ip_tokens(device.ip)) & set(ip_toks):
            return device
    for device in candidates:
        if mac and device.mac == mac:
            return device
    return None


def merge_properties(base: list[Any] | None, incoming: list[Any] | None) -> list[Any]:
    """Union two property lists on ``key`` (case-insensitive); incoming wins.

    Order-stable: existing keys keep their position, new ones are appended, so a
    user's arrangement survives a merge.
    """
    out: list[Any] = [dict(p) if isinstance(p, dict) else p for p in (base or [])]
    index: dict[str, int] = {}
    for i, prop in enumerate(out):
        if isinstance(prop, dict) and prop.get("key") is not None:
            index[str(prop["key"]).lower()] = i

    for prop in incoming or []:
        if not isinstance(prop, dict) or prop.get("key") is None:
            if prop not in out:
                out.append(prop)
            continue
        key = str(prop["key"]).lower()
        pos = index.get(key)
        if pos is None:
            out.append(dict(prop))
            index[key] = len(out) - 1
            continue
        current = out[pos]
        if not isinstance(current, dict):
            out[pos] = dict(prop)
            continue
        merged = {**current, **{k: v for k, v in prop.items() if not _blank(v)}}
        # Keys match case-insensitively but the display spelling is the user's —
        # "rack" arriving must not rewrite their "Rack".
        merged["key"] = current.get("key", prop["key"])
        # `visible` is a real False, not an empty value — carry it explicitly.
        if "visible" in prop:
            merged["visible"] = prop["visible"]
        out[pos] = merged
    return out


def _service_key(svc: Any) -> Any:
    if not isinstance(svc, dict):
        return repr(svc)
    return (svc.get("port"), svc.get("protocol"), (svc.get("service_name") or "").lower())


def merge_services(base: list[Any] | None, incoming: list[Any] | None) -> list[Any]:
    """Union two service lists on (port, protocol, name); incoming wins."""
    out: list[Any] = [dict(s) if isinstance(s, dict) else s for s in (base or [])]
    index = {_service_key(s): i for i, s in enumerate(out)}
    for svc in incoming or []:
        key = _service_key(svc)
        pos = index.get(key)
        if pos is None:
            out.append(dict(svc) if isinstance(svc, dict) else svc)
            index[key] = len(out) - 1
        elif isinstance(svc, dict) and isinstance(out[pos], dict):
            out[pos] = {**out[pos], **svc}
        else:
            out[pos] = svc
    return out


def merge_node_into_device(
    device: InventoryDevice,
    node: Node,
    *,
    overwrite_scalars: bool,
    replace_lists: bool,
) -> None:
    """Fold a node's device facts into its inventory row, in place.

    Two independent knobs, because the three callers need three combinations:

    * ``overwrite_scalars`` — a non-blank node value replaces the row's. True
      for the backfill (nodes are visited oldest-edit-first, so the most
      recently edited canvas is the last writer and wins) and for a user's save.
      False on approve, where the row was just discovered and the node is only a
      placement. A blank *never* clears an established value in either mode.
    * ``replace_lists`` — properties/services are taken wholesale rather than
      unioned. True only for a user's save: otherwise a property they deleted
      would come straight back on the next one. The backfill unions, so nothing
      any canvas recorded is lost.
    """
    for field in DEVICE_SCALARS:
        incoming = getattr(node, field, None)
        if _blank(incoming):
            continue
        if overwrite_scalars or _blank(getattr(device, field, None)):
            setattr(device, field, incoming)

    if not _blank(node.label) and (overwrite_scalars or _blank(device.label)):
        device.label = node.label
    if not _blank(node.type) and (overwrite_scalars or _blank(device.type)):
        device.type = node.type
    if not _blank(node.ieee_address) and _blank(device.ieee_address):
        # Identity, never overwritten — two IEEEs mean two devices.
        device.ieee_address = node.ieee_address
    if node.show_hardware and not device.show_hardware:
        device.show_hardware = True

    if replace_lists:
        device.properties = list(node.properties or [])
        device.services = list(node.services or [])
    else:
        device.properties = merge_properties(device.properties, node.properties)
        device.services = merge_services(device.services, node.services)

    # Live status: keep the freshest observation rather than the last writer.
    if node.last_seen and (device.last_seen is None or node.last_seen > device.last_seen):
        device.last_seen = node.last_seen
        device.status_live = node.status or device.status_live
        device.response_time_ms = node.response_time_ms
    elif device.status_live in (None, "", "unknown") and node.status:
        device.status_live = node.status
    if node.last_scan and (device.last_scan is None or node.last_scan > device.last_scan):
        device.last_scan = node.last_scan


def device_from_node(node: Node) -> InventoryDevice:
    """Mint the inventory row for a node that has none.

    Tagged ``canvas`` so the inventory filters can tell hand-drawn gear apart
    from anything a scan or import found.
    """
    device = InventoryDevice(
        label=node.label,
        type=node.type,
        hostname=node.hostname,
        ip=node.ip,
        mac=node.mac,
        os=node.os,
        ieee_address=node.ieee_address,
        services=list(node.services or []),
        properties=list(node.properties or []),
        notes=node.notes,
        cpu_count=node.cpu_count,
        cpu_model=node.cpu_model,
        ram_gb=node.ram_gb,
        disk_gb=node.disk_gb,
        show_hardware=bool(node.show_hardware),
        check_method=node.check_method,
        check_target=node.check_target,
        suggested_type=node.type,
        friendly_name=node.label,
        # On a canvas already, so it is past the pending queue.
        status="approved",
        status_live=node.status or "unknown",
        last_seen=node.last_seen,
        last_scan=node.last_scan,
        response_time_ms=node.response_time_ms,
        discovery_source=CANVAS_SOURCE,
        discovery_sources=[CANVAS_SOURCE],
    )
    return device


async def link_node(
    db: AsyncSession,
    node: Node,
    *,
    overwrite_scalars: bool = False,
    replace_lists: bool = False,
) -> InventoryDevice | None:
    """Point one node at its inventory row, creating or merging as needed.

    Returns the row, or ``None`` for canvas furniture. The two flags are handed
    to :func:`merge_node_into_device`; see it for when each applies. Flushes so
    a freshly minted row has an id to link to, but does not commit.
    """
    if is_furniture(node.type):
        node.device_id = None
        return None

    device = None
    if node.device_id:
        device = await db.get(InventoryDevice, node.device_id)
    if device is None:
        device = await find_device_for(db, ip=node.ip, mac=node.mac, ieee=node.ieee_address)

    if device is None:
        device = device_from_node(node)
        db.add(device)
        await db.flush()
    else:
        merge_node_into_device(
            device, node, overwrite_scalars=overwrite_scalars, replace_lists=replace_lists
        )
        device.discovery_sources = add_source(device.discovery_sources, CANVAS_SOURCE)

    node.device_id = device.id
    return device


async def load_devices_for(db: AsyncSession, nodes: list[Node]) -> dict[str, InventoryDevice]:
    """Fetch the inventory rows a batch of nodes points at, keyed by device id."""
    ids = {n.device_id for n in nodes if n.device_id}
    if not ids:
        return {}
    rows = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id.in_(ids)))
    ).scalars().all()
    return {d.id: d for d in rows}


def hydrated_node(node: Node, device: InventoryDevice | None) -> dict[str, Any]:
    """A node as the API reports it: presentation from the node, facts from the row.

    The device fields stay on the wire exactly where they have always been, so
    every reader — the canvas, the live view, the MCP server — is unaffected by
    the split. Falls back to the node's own columns when it has no row (canvas
    furniture, or a device row deleted out from under it).
    """
    payload: dict[str, Any] = {
        c.name: getattr(node, c.name) for c in node.__table__.columns
    }
    if device is None:
        return payload

    for field in DEVICE_SCALARS:
        payload[field] = getattr(device, field, None)
    payload["label"] = device.label or node.label
    payload["type"] = device.type or node.type
    payload["services"] = device.services or []
    payload["properties"] = device.properties or []
    payload["show_hardware"] = bool(device.show_hardware)
    payload["ieee_address"] = device.ieee_address or node.ieee_address
    # Live status still reaches the node while the status checker is node-scoped
    # (it moves to the row in the next step), so prefer whichever side has an
    # actual observation rather than blanking the canvas in between.
    if device.status_live and device.status_live != "unknown":
        payload["status"] = device.status_live
    payload["last_seen"] = device.last_seen or node.last_seen
    payload["last_scan"] = device.last_scan or node.last_scan
    payload["response_time_ms"] = (
        device.response_time_ms if device.response_time_ms is not None else node.response_time_ms
    )
    return payload


async def backfill_node_devices(db: AsyncSession) -> dict[str, int]:
    """Link every pre-3.3.0 canvas node to a Device Inventory row.

    Non-destructive: it writes ``nodes.device_id`` and fills blank inventory
    fields, and never deletes a node or a row. Two nodes on two canvases
    describing the same host converge on one row — that convergence is the point.

    Nodes are processed oldest-edit-first so that, where two canvases disagree
    on a scalar, the most recently edited node is the last writer and wins.
    Returns counts for the boot log. Does not commit.
    """
    nodes = (
        await db.execute(
            select(Node)
            .where(Node.device_id.is_(None), Node.type.not_in(tuple(FURNITURE_TYPES)))
            .order_by(Node.updated_at, Node.created_at, Node.id)
        )
    ).scalars().all()
    if not nodes:
        return {"linked": 0, "created": 0, "merged": 0}

    created = merged = 0
    for node in nodes:
        existing = await find_device_for(db, ip=node.ip, mac=node.mac, ieee=node.ieee_address)
        # Nodes arrive oldest-edit-first, so overwriting scalars leaves the most
        # recently edited canvas as the last writer. Lists stay unioned — nothing
        # any canvas recorded is dropped.
        device = await link_node(db, node, overwrite_scalars=True)
        if device is None:
            continue
        if existing is None:
            created += 1
            logger.info("Inventory backfill: node %s (%s) created device %s", node.id, node.label, device.id)
        else:
            merged += 1
            logger.info(
                "Inventory backfill: node %s (%s, design %s) merged into device %s",
                node.id, node.label, node.design_id, device.id,
            )

    await db.flush()
    return {"linked": len(nodes), "created": created, "merged": merged}
