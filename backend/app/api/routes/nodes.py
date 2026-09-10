from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Design, Edge, InventoryDevice, Node
from app.schemas.nodes import NodeCreate, NodeResponse, NodeUpdate
from app.schemas.utils import (
    SIDES,
    handle_count_field,
    handle_id,
    removed_handle_ids,
    side_default,
)
from app.services.doc_links import unlink_documents
from app.services.inventory_sync import (
    facts_from_payload,
    facts_from_update,
    hydrated_node,
    link_facts,
    load_devices_for,
    node_columns,
)
from app.services.node_dedupe import find_duplicate_node

router = APIRouter()

# ---------------------------------------------------------------------------
# Connection-point helpers
# ---------------------------------------------------------------------------


async def _remap_shrunk_handles(db: AsyncSession, node: Node, sent: dict[str, Any]) -> None:
    """Move this node's edges off the connection points a shrink just deleted.

    The canvas store does the same remap client-side (canvasStore.updateNode), so
    the UI never hits this; an API client — the MCP write tools — lowers a handle
    count without it, and React Flow silently drops an edge whose handle no longer
    exists. Removed handles fall back to the side's slot-0 ID, or to 'bottom' when
    the side went to zero and has no slot 0 left.

    Call before the new counts are written to the node.
    """
    fallbacks: dict[str, str] = {}
    for side in SIDES:
        field = handle_count_field(side)
        new_count = sent.get(field)
        if new_count is None:
            continue
        raw_old = getattr(node, field, None)
        old_count = raw_old if isinstance(raw_old, int) else side_default(side)
        if new_count >= old_count:
            continue
        fallback = 'bottom' if new_count == 0 else handle_id(side, 0)
        for hid in removed_handle_ids(side, old_count, new_count):
            fallbacks[hid] = fallback

    if not fallbacks:
        return

    result = await db.execute(select(Edge).where(or_(Edge.source == node.id, Edge.target == node.id)))
    for edge in result.scalars().all():
        if edge.source == node.id and edge.source_handle in fallbacks:
            edge.source_handle = fallbacks[edge.source_handle]
        if edge.target == node.id and edge.target_handle in fallbacks:
            edge.target_handle = fallbacks[edge.target_handle]


# ---------------------------------------------------------------------------
# Auto-positioning helpers
# ---------------------------------------------------------------------------

# Canvas grid used when placing nodes without explicit coordinates.
# Each slot is wide/tall enough that a normal node card fits without overlap.
_SLOT_W = 200.0
_SLOT_H = 100.0
_MAX_COLS = 7


async def _find_free_position(db: AsyncSession, design_id: str | None) -> tuple[float, float]:
    """Return (x, y) for a new root-level node that doesn't collide with existing ones.

    Snaps existing root nodes to a virtual grid and returns the first unoccupied
    cell, scanning left-to-right then top-to-bottom.
    """
    result = await db.execute(
        select(Node.pos_x, Node.pos_y).where(
            Node.design_id == design_id,
            Node.parent_id.is_(None),
        )
    )
    positions = list(result.all())
    if not positions:
        return 0.0, 0.0

    # Snap each existing node to its true grid cell (negatives kept as-is). The
    # search below only visits col >= 0 / row >= 0, so nodes parked in negative
    # space never falsely block — or falsely free — a positive slot.
    occupied: set[tuple[int, int]] = set()
    for (px, py) in positions:
        col = round(px / _SLOT_W)
        row = round(py / _SLOT_H)
        occupied.add((col, row))

    for row in range(10_000):
        for col in range(_MAX_COLS):
            if (col, row) not in occupied:
                return col * _SLOT_W, row * _SLOT_H

    return 0.0, 0.0  # unreachable in practice


@router.get("", response_model=list[NodeResponse])
async def list_nodes(
    label: str | None = Query(None, description="Case-insensitive substring filter on node label"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[Any]:
    query = select(Node)
    if label:
        query = query.where(Node.label.ilike(f"%{label}%"))
    nodes = list((await db.execute(query)).scalars().all())
    devices = await load_devices_for(db, nodes)
    return [hydrated_node(n, devices.get(n.device_id or "")) for n in nodes]


@router.post("", response_model=NodeResponse, status_code=status.HTTP_201_CREATED)
async def create_node(body: NodeCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Any:
    data = body.model_dump()
    # `force` bypasses the duplicate guard below; it is not a Node column.
    force = data.pop("force", False)
    # Attach to a design so the node lands on a canvas. Clients that don't send a
    # design_id (e.g. the MCP write tools) would otherwise create design_id=null
    # nodes that exist in the DB but never render in the UI until a container
    # restart reconciles them. Fall back to the first design, matching bulk-approve.
    if data.get("design_id") is None:
        first_design = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        data["design_id"] = first_design.id if first_design else None

    # Reject a silent duplicate: a node with the same ip OR mac already on the
    # target design. Scripts/MCP clients get a clear 409 (with the existing id)
    # instead of a second card for the same host. Pass force=True to override.
    if not force:
        dup = await find_duplicate_node(db, data["design_id"], data.get("ip"), data.get("mac"))
        if dup is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=dup)

    # Auto-position: when pos_x / pos_y are omitted (None), find a free canvas
    # slot so the new node doesn't land on top of an existing one.
    # Child nodes (parent_id set) use (0, 0) relative to their parent instead.
    if data["pos_x"] is None or data["pos_y"] is None:
        if data.get("parent_id") is None:
            auto_x, auto_y = await _find_free_position(db, data["design_id"])
            if data["pos_x"] is None:
                data["pos_x"] = auto_x
            if data["pos_y"] is None:
                data["pos_y"] = auto_y
        else:
            if data["pos_x"] is None:
                data["pos_x"] = 0.0
            if data["pos_y"] is None:
                data["pos_y"] = 0.0

    node = Node(**node_columns(data))
    db.add(node)
    await db.flush()
    # A new device node gets (or joins) its Device Inventory row — the canvas is
    # one more way to document hardware, not a parallel store.
    await link_facts(
        db, node, facts_from_payload(data, label=data["label"], node_type=data["type"])
    )
    await db.commit()
    await db.refresh(node)
    return await _hydrate(db, node)


async def _hydrate(db: AsyncSession, node: Node) -> dict[str, Any]:
    """Node as the API reports it, with the device facts read off its row."""
    device = await db.get(InventoryDevice, node.device_id) if node.device_id else None
    return hydrated_node(node, device)


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Any:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    return await _hydrate(db, node)


@router.patch("/{node_id}", response_model=NodeResponse)
async def update_node(
    node_id: str, body: NodeUpdate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> Any:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    sent = body.model_dump(exclude_unset=True)
    # A node can never be its own parent: the canvas' parent walks assume an
    # acyclic tree and a self-parent row freezes the node on screen (#370).
    # Dropped rather than rejected so the rest of the edit still lands.
    if sent.get("parent_id") == node_id:
        sent.pop("parent_id")
    # A `text` annotation is a caption, not a container. The canvas never nests
    # anything under one, but the API is reachable without it (MCP write tools,
    # scripts), and a device that lands there is read back as being *in* the
    # annotation — its content is printed as the device's zone in the generated
    # document (#446). Rejected rather than dropped: unlike a self-parent this is
    # a wrong argument, not a slip, and the caller should hear about it.
    if sent.get("parent_id"):
        parent = await db.get(Node, sent["parent_id"])
        if parent is not None and parent.type == "text":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A text annotation cannot be a parent node",
            )
    # Before the new counts land: the old ones are what says which handles go away.
    await _remap_shrunk_handles(db, node, sent)
    for field, value in node_columns(sent).items():
        setattr(node, field, value)
    # The user edited the device, not just its drawing: push the facts down.
    # Only what was sent counts — an omitted field must not clear the row, and
    # lists are replaced only when the client actually sent them.
    facts = facts_from_update(sent)
    await link_facts(
        db,
        node,
        facts,
        overwrite_scalars=True,
        replace_lists="properties" in sent or "services" in sent,
    )
    await db.commit()
    await db.refresh(node)
    return await _hydrate(db, node)


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> None:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    # Foreign keys are off, so the schema's ON DELETE SET NULL does not fire.
    await unlink_documents(db, node_ids=[node_id])
    await db.delete(node)
    await db.commit()
