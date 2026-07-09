from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Design, Node
from app.schemas.nodes import NodeCreate, NodeResponse, NodeUpdate
from app.services.node_dedupe import find_duplicate_node

router = APIRouter()

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
async def list_nodes(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[Node]:
    result = await db.execute(select(Node))
    return list(result.scalars().all())


@router.post("", response_model=NodeResponse, status_code=status.HTTP_201_CREATED)
async def create_node(body: NodeCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Node:
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

    node = Node(**data)
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return node


@router.get("/{node_id}", response_model=NodeResponse)
async def get_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Node:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    return node


@router.patch("/{node_id}", response_model=NodeResponse)
async def update_node(
    node_id: str, body: NodeUpdate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> Node:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    await db.commit()
    await db.refresh(node)
    return node


@router.delete("/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> None:
    node = await db.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    await db.delete(node)
    await db.commit()
