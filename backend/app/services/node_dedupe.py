"""Collapse *true* duplicate canvas nodes: same ``ieee_address`` **and** same
``design_id`` (i.e. the same device placed twice on the *same* canvas).

The same device legitimately appears on multiple canvases — placing a device on
another design creates a second :class:`Node` for that IEEE by design (see the
per-design guard in ``bulk_approve_devices``). Those cross-design rows are NOT
duplicates and must be preserved. Only two rows sharing both the IEEE *and* the
design are corrupt, and only those are collapsed here.

This module provides an idempotent, **loss-free** repair: per ``(ieee,
design_id)`` group with >1 node it keeps the oldest as canonical, merges the
extras' data into it (properties, missing scalar fields, services), re-points
every edge and ``parent_id`` reference onto the canonical node, then deletes the
extras. Edges are de-duplicated and self-loops dropped after re-pointing so no
dangling or redundant links remain.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Edge, Node
from app.services.zigbee_service import merge_zigbee_properties

logger = logging.getLogger(__name__)

# Scalar Node fields worth carrying over from a duplicate when the canonical
# node has no value. Positions, design, parent and identity fields are left on
# the canonical node untouched (that's the row the user actually placed).
_FILLABLE_FIELDS = (
    "hostname",
    "ip",
    "mac",
    "os",
    "check_method",
    "check_target",
    "notes",
    "cpu_count",
    "cpu_model",
    "ram_gb",
    "disk_gb",
    "custom_icon",
    "last_seen",
    "last_scan",
)


def _merge_services(
    a: list[Any] | None, b: list[Any] | None
) -> list[Any]:
    """Union two service lists, de-duplicated, order-stable."""
    out: list[Any] = list(a or [])
    seen = {repr(s) for s in out}
    for s in b or []:
        if repr(s) not in seen:
            out.append(s)
            seen.add(repr(s))
    return out


def _merge_into_canonical(canonical: Node, dup: Node) -> None:
    """Fold ``dup``'s data into ``canonical`` in place (no field lost)."""
    canonical.properties = merge_zigbee_properties(
        canonical.properties, dup.properties or []
    )
    canonical.services = _merge_services(canonical.services, dup.services)
    for field in _FILLABLE_FIELDS:
        if getattr(canonical, field, None) in (None, "") and getattr(dup, field, None) not in (None, ""):
            setattr(canonical, field, getattr(dup, field))
    # Prefer a human label over a bare IEEE/hex fallback.
    if (not canonical.label or canonical.label == canonical.ieee_address) and dup.label:
        canonical.label = dup.label


async def dedupe_nodes_by_ieee(db: AsyncSession) -> int:
    """Merge duplicate nodes sharing an ``ieee_address`` AND ``design_id``.

    Returns the number of nodes removed. Idempotent: a no-op when every
    ``(ieee, design)`` pair maps to at most one node. Nodes with the same IEEE
    on *different* designs are left untouched (valid cross-canvas placement).
    Does not commit — the caller owns the transaction.
    """
    rows = (
        await db.execute(
            select(Node)
            .where(Node.ieee_address.is_not(None))
            .order_by(Node.ieee_address, Node.created_at, Node.id)
        )
    ).scalars().all()

    groups: dict[tuple[str, str | None], list[Node]] = {}
    for node in rows:
        groups.setdefault((node.ieee_address, node.design_id), []).append(node)  # type: ignore[arg-type]

    removed = 0
    for (ieee, _design), nodes in groups.items():
        if len(nodes) < 2:
            continue
        canonical, *dups = nodes  # oldest first (ordered above)
        dup_ids = {d.id for d in dups}

        for dup in dups:
            _merge_into_canonical(canonical, dup)

        # Re-point edges + parents, then drop self-loops / duplicates.
        edges = (
            await db.execute(
                select(Edge).where(
                    Edge.source.in_(dup_ids) | Edge.target.in_(dup_ids)
                )
            )
        ).scalars().all()
        for edge in edges:
            if edge.source in dup_ids:
                edge.source = canonical.id
            if edge.target in dup_ids:
                edge.target = canonical.id

        # Re-point children whose parent was a duplicate.
        children = (
            await db.execute(select(Node).where(Node.parent_id.in_(dup_ids)))
        ).scalars().all()
        for child in children:
            child.parent_id = canonical.id

        # Collapse self-loops and now-redundant parallel edges.
        all_edges = (
            await db.execute(
                select(Edge).where(
                    (Edge.source == canonical.id) | (Edge.target == canonical.id)
                )
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
            "Deduped IEEE %s: merged %d duplicate node(s) into %s",
            ieee, len(dups), canonical.id,
        )

    if removed:
        await db.flush()
    return removed
