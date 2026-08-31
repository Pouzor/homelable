"""Duplicate canvas nodes: the same device drawn twice on the *same* canvas.

A device legitimately appears on several canvases — one :class:`Node` per
design, all pointing at one ``device_inventory`` row. Two nodes drawing that row
on the *same* design are the corrupt case, and the only one collapsed here.

Identity is the device link, not the addresses: a node names the row it draws,
so "same device" is an id comparison rather than a guess across ieee/ip/mac.
The repair is idempotent — the oldest node stays, edges and ``parent_id``
references are re-pointed onto it, then the extras go. No device data is lost in
the process because none of it lives on the node any more.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Edge, Node
from app.services.inventory_sync import find_device_for

logger = logging.getLogger(__name__)


async def find_duplicate_node(
    db: AsyncSession,
    design_id: str | None,
    ip: str | None,
    mac: str | None,
    ieee: str | None = None,
) -> dict[str, Any] | None:
    """Return conflict details if this device is already drawn on ``design_id``.

    Identity is resolved once, by the inventory row the addresses point at
    (``find_device_for``: ieee > ip > mac), and a duplicate is simply a second
    node on the same design drawing that row. Scoped to one design on purpose:
    the same device may legitimately appear on several canvases.

    The create/approve endpoints turn this into a 409 so the UI can offer "go to
    existing" vs "add duplicate anyway".
    """
    device = await find_device_for(db, ip=ip, mac=mac, ieee=ieee)
    if device is None:
        return None
    existing = (
        await db.execute(
            select(Node)
            .where(Node.design_id == design_id, Node.device_id == device.id)
            .order_by(Node.created_at, Node.id)
        )
    ).scalars().first()
    if existing is None:
        return None

    # Report which address identified the device, as the UI prints it, in the
    # same precedence find_device_for used: ieee > ip > mac.
    match: str
    value: str | None
    device_ips = {t.strip() for t in (device.ip or "").split(",") if t.strip()}
    shared_ip = next((t.strip() for t in (ip or "").split(",") if t.strip() in device_ips), None)
    if ieee and device.ieee_address == ieee:
        match, value = "ieee", ieee
    elif shared_ip:
        match, value = "ip", shared_ip
    elif mac and device.mac == mac:
        match, value = "mac", mac
    else:
        match, value = "ip", ip
    return {
        "duplicate": True,
        "existing_node_id": existing.id,
        "existing_label": device.label or existing.label,
        "match": match,
        "value": value,
    }


async def dedupe_nodes_by_device(db: AsyncSession) -> int:
    """Merge duplicate nodes drawing the same device on the same canvas.

    Returns the number of nodes removed. Idempotent. Nodes drawing one device on
    *different* designs are left alone — that is valid cross-canvas placement.
    The device facts live on the inventory row, so nothing has to be merged out
    of the extras: only edges and parent links are re-pointed before they go.
    Does not commit — the caller owns the transaction.
    """
    rows = (
        await db.execute(
            select(Node)
            .where(Node.device_id.is_not(None))
            .order_by(Node.device_id, Node.created_at, Node.id)
        )
    ).scalars().all()

    groups: dict[tuple[str, str | None], list[Node]] = {}
    for node in rows:
        groups.setdefault((node.device_id, node.design_id), []).append(node)  # type: ignore[arg-type]

    removed = 0
    for (device_id, _design), nodes in groups.items():
        if len(nodes) < 2:
            continue
        canonical, *dups = nodes  # oldest first (ordered above)
        dup_ids = {d.id for d in dups}

        # Re-point edges + parents, then drop self-loops / duplicates.
        edges = (
            await db.execute(
                select(Edge).where(Edge.source.in_(dup_ids) | Edge.target.in_(dup_ids))
            )
        ).scalars().all()
        for edge in edges:
            if edge.source in dup_ids:
                edge.source = canonical.id
            if edge.target in dup_ids:
                edge.target = canonical.id

        children = (
            await db.execute(select(Node).where(Node.parent_id.in_(dup_ids)))
        ).scalars().all()
        for child in children:
            # The canonical node may itself have been nested under one of its
            # own duplicates. Re-pointing it here would make it its own parent,
            # which freezes it on the canvas (#370) — detach it instead. Mirrors
            # the self-loop edge deletion below.
            child.parent_id = None if child.id == canonical.id else canonical.id

        all_edges = (
            await db.execute(
                select(Edge).where((Edge.source == canonical.id) | (Edge.target == canonical.id))
            )
        ).scalars().all()
        seen_pairs: set[tuple[str, str, str]] = set()
        for edge in all_edges:
            if edge.source == edge.target:
                await db.delete(edge)
                continue
            key = (edge.source, edge.target, edge.type)
            if key in seen_pairs:
                await db.delete(edge)
                continue
            seen_pairs.add(key)

        await db.flush()
        for dup in dups:
            await db.delete(dup)
            removed += 1

        logger.info(
            "Deduped device %s: merged %d duplicate node(s) into %s",
            device_id, len(dups), canonical.id,
        )

    if removed:
        await db.flush()
    return removed
