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

import json
import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select, text
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


def _same_ieee(left: str | None, right: str | None) -> bool:
    """IEEE addresses compare case-insensitively — the same radio either way."""
    if _blank(left) or _blank(right):
        return False
    return str(left).lower() == str(right).lower()


async def _ieee_owner(db: AsyncSession, ieee: str, *, other_than: str | None) -> InventoryDevice | None:
    """The row already holding ``ieee``, if it is not ``other_than``.

    ``device_inventory.ieee_address`` is UNIQUE, so writing an address a second
    row owns raises. Callers ask first and leave the address where it is.
    """
    stmt = select(InventoryDevice).where(func.lower(InventoryDevice.ieee_address) == ieee.lower())
    if other_than is not None:
        # `id != NULL` is NULL in SQL and would match nothing — only narrow when
        # there is a row to exclude.
        stmt = stmt.where(InventoryDevice.id != other_than)
    return (await db.execute(stmt)).scalars().first()


async def _drop_taken_ieee(
    db: AsyncSession, facts: Mapping[str, Any], device: InventoryDevice | None
) -> Mapping[str, Any]:
    """``facts`` without an ``ieee_address`` another inventory row already owns.

    Returned unchanged in the common case. The column is UNIQUE, so writing a
    duplicate raises mid-merge — and during the backfill that would cost the node
    its link. The address belongs to whichever row holds it; identity for *this*
    device was established by ip or mac.
    """
    ieee = facts.get("ieee_address")
    if _blank(ieee) or (device is not None and _same_ieee(device.ieee_address, ieee)):
        return facts
    owner = await _ieee_owner(db, str(ieee), other_than=device.id if device else None)
    if owner is None:
        return facts
    logger.warning(
        "IEEE %s is already held by device %s — leaving it off %s",
        ieee, owner.id, device.id if device else "the new row",
    )
    return {k: v for k, v in facts.items() if k != "ieee_address"}


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
        # Case-insensitive: `0x00124B00…` and `0x00124b00…` are the same radio,
        # and an exact comparison here would mint a second row for it — one the
        # UNIQUE index then refuses.
        conds.append(func.lower(InventoryDevice.ieee_address) == ieee.lower())
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
        if ieee and _same_ieee(device.ieee_address, ieee):
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


# Observations rather than edits: the checker and the scanner write these, so a
# client never lists them as changed and they survive a `changed_fields` filter.
_LIVE_FACT_FIELDS = frozenset({"status", "last_seen", "last_scan", "response_time_ms"})


def changed_facts(device: InventoryDevice, facts: Mapping[str, Any]) -> dict[str, Any]:
    """The subset of ``facts`` that actually differs from the row.

    A canvas save sends a *full* copy of the device — the facts were hydrated
    into the node when the canvas loaded — so a save triggered by nothing but a
    node being dragged would otherwise rewrite the row from a snapshot that may
    be minutes or hours old, silently reverting an edit made meanwhile in the
    inventory modal, on another canvas, or by the scanner. Narrowing to what the
    sender changed turns the write-through from "push my whole snapshot" into
    "push my edit", so two writers only collide on the same field.

    The comparison mirrors :func:`merge_facts_into_device`: a blank incoming
    value is not a change (it never clears an established one), and a list
    counts as changed only when it would actually be replaced by a different
    one. Ambiguity is resolved toward reporting a change — a false positive is
    the old behaviour for that field, a false negative would drop a real edit.
    """
    out: dict[str, Any] = {}
    for field in (*DEVICE_SCALARS, "label", "type"):
        incoming = facts.get(field)
        if _blank(incoming) or incoming == getattr(device, field, None):
            continue
        out[field] = incoming

    if not _blank(facts.get("ieee_address")) and _blank(device.ieee_address):
        out["ieee_address"] = facts["ieee_address"]
    if facts.get("show_hardware") and not device.show_hardware:
        out["show_hardware"] = facts["show_hardware"]

    if "properties" in facts and list(facts["properties"] or []) != list(device.properties or []):
        out["properties"] = facts["properties"]
    if "services" in facts and list(facts["services"] or []) != list(device.services or []):
        out["services"] = facts["services"]

    # Live observations, not edits: carried through only where the merge would
    # have used them — filling a row that has never been checked.
    if facts.get("status") and device.status_live in (None, "", "unknown"):
        out["status"] = facts["status"]
    for field in ("last_seen", "last_scan", "response_time_ms"):
        if facts.get(field) is not None:
            out[field] = facts[field]
    return out


def merge_facts_into_device(
    device: InventoryDevice,
    facts: Mapping[str, Any],
    *,
    overwrite_scalars: bool,
    replace_lists: bool,
) -> None:
    """Fold one view of a device into its inventory row, in place.

    ``facts`` is a plain mapping — what a canvas save sent, or what a legacy
    node's columns held — so this rule lives in one place regardless of where
    the view came from.

    Two independent knobs, because the callers need three combinations:

    * ``overwrite_scalars`` — a non-blank incoming value replaces the row's.
      True for the backfill (nodes are visited oldest-edit-first, so the most
      recently edited canvas is the last writer and wins) and for a user's save.
      False on approve, where the row was just discovered and the node is only a
      placement. A blank *never* clears an established value in either mode.
    * ``replace_lists`` — properties/services are taken wholesale rather than
      unioned. True only for a user's save: otherwise a property they deleted
      would come straight back on the next one. The backfill unions, so nothing
      any canvas recorded is lost. It applies list by list: a list absent from
      ``facts`` is left alone even in replace mode, so a partial update never
      clears the one it did not send.
    """
    for field in (*DEVICE_SCALARS, "label", "type"):
        incoming = facts.get(field)
        if _blank(incoming):
            continue
        if overwrite_scalars or _blank(getattr(device, field, None)):
            setattr(device, field, incoming)

    if not _blank(facts.get("ieee_address")) and _blank(device.ieee_address):
        # Identity, never overwritten — two IEEEs mean two devices.
        device.ieee_address = facts["ieee_address"]
    if facts.get("show_hardware") and not device.show_hardware:
        device.show_hardware = True

    # Per list, and only for one the caller actually sent: a partial update
    # carrying properties alone must leave services as they were, not blank them.
    if replace_lists and "properties" in facts:
        device.properties = list(facts["properties"] or [])
    else:
        device.properties = merge_properties(device.properties, facts.get("properties"))
    if replace_lists and "services" in facts:
        device.services = list(facts["services"] or [])
    else:
        device.services = merge_services(device.services, facts.get("services"))

    # Live status: keep the freshest observation rather than the last writer.
    last_seen, status, last_scan = facts.get("last_seen"), facts.get("status"), facts.get("last_scan")
    if last_seen and (device.last_seen is None or last_seen > device.last_seen):
        device.last_seen = last_seen
        device.status_live = status or device.status_live
        device.response_time_ms = facts.get("response_time_ms")
    elif device.status_live in (None, "", "unknown") and status:
        device.status_live = status
    if last_scan and (device.last_scan is None or last_scan > device.last_scan):
        device.last_scan = last_scan


def device_from_facts(facts: Mapping[str, Any]) -> InventoryDevice:
    """Mint the inventory row for a device that has none.

    Tagged ``canvas`` so the inventory filters can tell hand-drawn gear apart
    from anything a scan or import found.
    """
    return InventoryDevice(
        label=facts.get("label"),
        type=facts.get("type"),
        hostname=facts.get("hostname"),
        ip=facts.get("ip"),
        mac=facts.get("mac"),
        os=facts.get("os"),
        ieee_address=facts.get("ieee_address"),
        services=list(facts.get("services") or []),
        properties=list(facts.get("properties") or []),
        notes=facts.get("notes"),
        cpu_count=facts.get("cpu_count"),
        cpu_model=facts.get("cpu_model"),
        ram_gb=facts.get("ram_gb"),
        disk_gb=facts.get("disk_gb"),
        show_hardware=bool(facts.get("show_hardware")),
        check_method=facts.get("check_method"),
        check_target=facts.get("check_target"),
        suggested_type=facts.get("type"),
        friendly_name=facts.get("label"),
        # On a canvas already, so it is past the pending queue.
        status="approved",
        status_live=facts.get("status") or "unknown",
        last_seen=facts.get("last_seen"),
        last_scan=facts.get("last_scan"),
        response_time_ms=facts.get("response_time_ms"),
        discovery_source=CANVAS_SOURCE,
        discovery_sources=[CANVAS_SOURCE],
    )


async def link_facts(
    db: AsyncSession,
    node: Node,
    facts: Mapping[str, Any],
    *,
    overwrite_scalars: bool = False,
    replace_lists: bool = False,
    only_changed: bool = False,
    changed_fields: list[str] | None = None,
) -> InventoryDevice | None:
    """Point one node at its inventory row, creating or merging as needed.

    ``facts`` is this node's view of the device — the fields a canvas save sent,
    or a legacy node's columns during the backfill. Returns the row, or ``None``
    for canvas furniture. Flushes so a freshly minted row has an id to link to,
    but does not commit.

    Two narrowings turn a save from "push my whole snapshot" into "push my edit",
    and they compose. Identity matching always uses the full ``facts`` — the row
    has to be found before it can be narrowed against.

    * ``changed_fields`` — what the sender says it edited since it loaded the
      device. Authoritative: a fact absent from the list is not written even when
      it differs, because the difference means the *row* moved on, not the sender.
    * ``only_changed`` — drop facts already equal to the row (see
      :func:`changed_facts`), so a no-op save writes nothing at all.
    """
    if is_furniture(node.type):
        node.device_id = None
        return None

    device = None
    if node.device_id:
        device = await db.get(InventoryDevice, node.device_id)
    if device is None:
        device = await find_device_for(
            db, ip=facts.get("ip"), mac=facts.get("mac"), ieee=facts.get("ieee_address")
        )

    # The IEEE is UNIQUE across the inventory. Where another row already owns the
    # one these facts carry, drop it rather than write a duplicate: identity has
    # been resolved to *this* device by ip or mac, and the address stays with the
    # row holding it.
    facts = await _drop_taken_ieee(db, facts, device)

    if device is None:
        device = device_from_facts(facts)
        db.add(device)
        await db.flush()
    else:
        merged = dict(facts)
        if changed_fields is not None:
            keep = set(changed_fields) | _LIVE_FACT_FIELDS
            merged = {k: v for k, v in merged.items() if k in keep}
        if only_changed:
            merged = changed_facts(device, merged)
        merge_facts_into_device(
            device,
            merged,
            overwrite_scalars=overwrite_scalars,
            replace_lists=replace_lists,
        )
        device.discovery_sources = add_source(device.discovery_sources, CANVAS_SOURCE)

    node.device_id = device.id
    return device


def node_columns(payload: Mapping[str, Any]) -> dict[str, Any]:
    """The subset of a node payload that is still a `nodes` column.

    The wire shape carries the device facts flat on the node; they belong to the
    inventory row now, so they are dropped here and applied through
    :func:`link_facts` instead.
    """
    allowed = {c.name for c in Node.__table__.columns}
    return {k: v for k, v in payload.items() if k in allowed}


# Fields that are both a node column and a device fact: the node keeps a copy so
# a half-migrated database still renders, but the row is the truth.
_SHARED_FIELDS = ("label", "type")

# Everything the inventory row owns, as it appears in a node payload.
DEVICE_FACT_FIELDS = (
    *DEVICE_SCALARS, "services", "properties", "show_hardware", "status", *_SHARED_FIELDS,
)


def facts_from_update(sent: Mapping[str, Any]) -> dict[str, Any]:
    """The device facts inside a partial node update — only what was sent.

    An omitted field must not clear the row, so unsent keys are simply absent.
    """
    return {k: v for k, v in sent.items() if k in DEVICE_FACT_FIELDS}


def facts_from_payload(payload: Mapping[str, Any], *, label: str, node_type: str) -> dict[str, Any]:
    """The device facts inside a node save/create payload.

    The wire shape still carries them flat on the node, so this is where they
    are separated from the presentation fields the node itself keeps.
    """
    facts: dict[str, Any] = {
        field: payload.get(field)
        for field in (*DEVICE_SCALARS, "services", "properties", "show_hardware", "status")
    }
    facts["label"] = label
    facts["type"] = node_type
    return facts


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
    the split. Canvas furniture has no row and simply reports the defaults.
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
    payload["ieee_address"] = device.ieee_address
    payload["status"] = device.status_live or "unknown"
    payload["last_seen"] = device.last_seen
    payload["last_scan"] = device.last_scan
    payload["response_time_ms"] = device.response_time_ms
    return payload


# The device columns `nodes` carried before 3.3.0. They are read once, by the
# backfill, and then dropped — so they are named here as raw SQL rather than as
# model attributes that no longer exist.
_LEGACY_NODE_COLUMNS = (
    "hostname", "ip", "mac", "os", "status", "check_method", "check_target",
    "services", "notes", "cpu_count", "cpu_model", "ram_gb", "disk_gb",
    "show_hardware", "properties", "ieee_address", "last_seen", "last_scan",
    "response_time_ms",
)


async def _legacy_columns_present(db: AsyncSession) -> list[str]:
    """Which pre-3.3.0 device columns still exist on `nodes`."""
    rows = (await db.execute(text("PRAGMA table_info(nodes)"))).all()
    present = {r[1] for r in rows}
    return [c for c in _LEGACY_NODE_COLUMNS if c in present]


def _decode_json(value: Any) -> Any:
    """Raw SQL hands back JSON columns as text; the ORM would have decoded them."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return []
    return value


# Legacy `nodes` columns SQLite stores as DATETIME. Read through raw SQL they come
# back as text, and writing text into a DateTime column raises
# ``TypeError: SQLite DateTime type only accepts Python datetime and date objects``.
_LEGACY_DATETIME_COLUMNS = ("last_seen", "last_scan")


def _decode_dt(value: Any) -> datetime | None:
    """Raw SQL hands back DATETIME columns as text; the ORM would have parsed them.

    An unparseable stamp becomes ``None`` rather than an error: `last_seen` and
    `last_scan` are observations the status checker refreshes within a minute,
    and losing one must not cost a node its inventory row.
    """
    if value is None or isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.strip())
    except ValueError:
        logger.debug("Ignoring an unparseable legacy timestamp: %r", value)
        return None


async def _row_is_missing_facts(db: AsyncSession, device_id: str, facts: Mapping[str, Any]) -> bool:
    """Does the linked row lack a fact the node's legacy columns still hold?

    True only where the node has something to give and the row has nothing in
    that field, so a node whose facts already made it across is left alone and
    the backfill stays a no-op on later boots.
    """
    device = await db.get(InventoryDevice, device_id)
    if device is None:
        return True  # The row is gone; the node needs a new one.
    for field in (*DEVICE_SCALARS, "label", "type", "ieee_address"):
        if not _blank(facts.get(field)) and _blank(getattr(device, field, None)):
            return True
    return any(
        facts.get(field) and not getattr(device, field, None)
        for field in ("services", "properties")
    )


async def backfill_node_devices(db: AsyncSession) -> dict[str, int]:
    """Link every pre-3.3.0 canvas node to a Device Inventory row.

    Non-destructive: it writes ``nodes.device_id`` and fills the inventory row,
    and never deletes a node or a row. Two nodes on two canvases describing the
    same host converge on one row — that convergence is the point.

    Nodes are processed oldest-edit-first so that, where two canvases disagree
    on a scalar, the most recently edited node is the last writer and wins;
    properties and services are unioned, so nothing any canvas recorded is lost.

    Reads the legacy columns with raw SQL because the model no longer declares
    them — this runs on the boot that drops them, once. Returns counts for the
    boot log, ``skipped`` among them: a node whose merge violates a constraint is
    left unlinked instead of aborting the run. Does not commit.
    """
    legacy = await _legacy_columns_present(db)
    if not legacy:
        # Already migrated: the columns are gone, so nothing can be left to read.
        return {"linked": 0, "created": 0, "merged": 0, "skipped": 0}

    placeholders = ", ".join(legacy)
    furniture = ", ".join(f"'{t}'" for t in sorted(FURNITURE_TYPES))
    # Linked nodes are read too, not just unlinked ones. A canvas saved while an
    # earlier migration was stuck minted a *blank* inventory row from a UI that
    # had no facts to show, and linked the node to it. Skipping those would count
    # them as migrated and drop the columns that still hold their only copy of
    # the ip, services and notes. A linked node is filled, never overwritten.
    rows = (
        await db.execute(
            text(
                f"SELECT id, label, type, design_id, device_id, {placeholders} FROM nodes "
                f"WHERE type NOT IN ({furniture}) "
                "ORDER BY updated_at, created_at, id"
            )
        )
    ).mappings().all()
    if not rows:
        return {"linked": 0, "created": 0, "merged": 0, "skipped": 0}

    linked = created = merged = skipped = 0
    for row in rows:
        facts: dict[str, Any] = {c: row[c] for c in legacy}
        facts["services"] = _decode_json(facts.get("services")) or []
        facts["properties"] = _decode_json(facts.get("properties")) or []
        for field in _LEGACY_DATETIME_COLUMNS:
            if field in facts:
                facts[field] = _decode_dt(facts[field])
        facts["label"] = row["label"]
        facts["type"] = row["type"]

        # One savepoint per node: a row the merge cannot write is dropped on its
        # own rather than taking the whole backfill with it. Every node it does
        # not link keeps its legacy columns, so nothing is lost and the next boot
        # retries. The catch is deliberately broad — a node that cannot be read
        # or written for *any* reason must not cost the others their link.
        try:
            async with db.begin_nested():
                node = await db.get(Node, row["id"])
                if node is None:  # pragma: no cover - the row was just read
                    continue
                if node.device_id and not await _row_is_missing_facts(db, node.device_id, facts):
                    continue  # Already migrated, and its row holds the facts.
                existing = await find_device_for(
                    db, ip=facts.get("ip"), mac=facts.get("mac"), ieee=facts.get("ieee_address")
                )
                # A node that is already linked only has its gaps filled: whatever
                # is on the row was written after the migration and is newer.
                device = await link_facts(
                    db, node, facts, overwrite_scalars=node.device_id is None
                )
                if device is None:
                    continue
                await db.flush()
        except Exception as exc:
            skipped += 1
            logger.warning(
                "Inventory backfill: node %s (%s) skipped — %s", row["id"], row["label"], exc
            )
            continue

        linked += 1
        if existing is None:
            created += 1
            logger.info(
                "Inventory backfill: node %s (%s) created device %s", node.id, row["label"], device.id
            )
        else:
            merged += 1
            logger.info(
                "Inventory backfill: node %s (%s, design %s) merged into device %s",
                node.id, row["label"], row["design_id"], device.id,
            )

    await db.flush()
    return {"linked": linked, "created": created, "merged": merged, "skipped": skipped}
