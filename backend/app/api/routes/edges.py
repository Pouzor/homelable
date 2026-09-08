from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Design, Edge, Node
from app.schemas.edges import EdgeCreate, EdgeResponse, EdgeUpdate
from app.schemas.utils import SIDES, clamp_handles, handle_count_field, parse_side_handle

router = APIRouter()

# ---------------------------------------------------------------------------
# Auto-handle helpers
# ---------------------------------------------------------------------------


async def _abs_y(db: AsyncSession, node_id: str) -> float | None:
    """Resolve the approximate absolute canvas Y of a node.

    Walks up the parent chain (up to 8 levels) and accumulates pos_y offsets so
    that children inside containers are compared correctly against top-level nodes.
    Returns None when the node is not found.
    """
    node = await db.get(Node, node_id)
    if node is None:
        return None
    y = node.pos_y
    current = node
    for _ in range(8):
        if current.parent_id is None:
            break
        parent = await db.get(Node, current.parent_id)
        if parent is None:
            break
        y += parent.pos_y
        current = parent
    return y


async def _auto_handles(
    db: AsyncSession, source_id: str, target_id: str
) -> tuple[str, str]:
    """Return (source_handle, target_handle) that reflect the upstream/downstream
    relationship between two nodes.

    - Source above target (lower Y value) → downstream flow: exit bottom, enter top
    - Source below target → upstream flow: exit top, enter bottom
    - Equal or unknown → default to bottom/top-t (most common topology direction)
    """
    src_y = await _abs_y(db, source_id)
    tgt_y = await _abs_y(db, target_id)

    if src_y is None or tgt_y is None or src_y <= tgt_y:
        return "bottom", "top-t"
    return "top", "bottom-t"


# ---------------------------------------------------------------------------
# Connection-point guards
# ---------------------------------------------------------------------------


def _side_count(node: Node, side: str) -> int:
    """A node's clamped connection-point count for one side."""
    return clamp_handles(side, getattr(node, handle_count_field(side), None))


async def _reject_missing_handle(db: AsyncSession, node_id: str, handle: str | None, role: str) -> None:
    """422 when an endpoint names a connection point its node does not have.

    React Flow draws nothing for an edge whose handle ID resolves to no element,
    so such an edge would persist and be invisible on the canvas with no error
    anywhere — the same failure `_remap_shrunk_handles` prevents when a count is
    lowered. Callers that supply no handle are auto-assigned one instead and
    never reach this.
    """
    if handle is None:
        return
    parsed = parse_side_handle(handle)
    if parsed is None:
        # Not a per-side handle ('cluster-right' and friends): its own renderer
        # owns it, and no count here describes it.
        return
    side, idx = parsed
    node = await db.get(Node, node_id)
    if node is None:
        # An unknown node is not this guard's error to report; the edge routes
        # have never checked that either endpoint exists.
        return
    count = _side_count(node, side)
    if 0 <= idx < count:
        return
    raise HTTPException(
        status_code=422,
        detail=(
            f"{role}_handle '{handle}' does not exist: node {node_id} has {count} "
            f"connection point(s) on its {side} side."
        ),
    )


async def _existing_handle(db: AsyncSession, node_id: str, handle: str) -> str:
    """Keep an auto-assigned handle, or swap it for one the node actually has.

    The auto-assignment below always names a top/bottom slot 0, which a node that
    opted out of those sides no longer draws. The server picked it, not the
    caller, so this corrects it silently rather than raising. A node with no
    connection point at all keeps the original: there is nothing better to use,
    and refusing to create the edge would lose more than it saves.
    """
    node = await db.get(Node, node_id)
    if node is None:
        return handle
    parsed = parse_side_handle(handle)
    if parsed is not None:
        side, idx = parsed
        if 0 <= idx < _side_count(node, side):
            return handle
    suffix = "-t" if handle.endswith("-t") else ""
    for side in SIDES:
        if _side_count(node, side) > 0:
            return f"{side}{suffix}"
    return handle


@router.get("", response_model=list[EdgeResponse])
async def list_edges(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[Edge]:
    result = await db.execute(select(Edge))
    return list(result.scalars().all())


@router.post("", response_model=EdgeResponse, status_code=status.HTTP_201_CREATED)
async def create_edge(body: EdgeCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> Edge:
    data = body.model_dump()
    # Same reconciliation as nodes: clients omitting design_id (MCP write tools)
    # would create design_id=null edges that never render until a restart.
    # Fall back to the first design so the edge attaches to a canvas.
    if data.get("design_id") is None:
        first_design = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        data["design_id"] = first_design.id if first_design else None

    # Auto-assign source/target handles when the caller omits them.
    # Compares the canvas Y positions of both nodes so that the edge always exits
    # the upstream node's bottom and enters the downstream node's top (or vice versa
    # for reverse flows), matching the UI convention for top-to-bottom topologies.
    await _reject_missing_handle(db, data["source"], data.get("source_handle"), "source")
    await _reject_missing_handle(db, data["target"], data.get("target_handle"), "target")

    if data.get("source_handle") is None or data.get("target_handle") is None:
        auto_src, auto_tgt = await _auto_handles(db, data["source"], data["target"])
        if data.get("source_handle") is None:
            data["source_handle"] = await _existing_handle(db, data["source"], auto_src)
        if data.get("target_handle") is None:
            data["target_handle"] = await _existing_handle(db, data["target"], auto_tgt)

    edge = Edge(**data)
    db.add(edge)
    await db.commit()
    await db.refresh(edge)
    return edge


@router.delete("/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_edge(edge_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> None:
    edge = await db.get(Edge, edge_id)
    if not edge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    await db.delete(edge)
    await db.commit()


@router.patch("/{edge_id}", response_model=EdgeResponse)
async def update_edge(
    edge_id: str, body: EdgeUpdate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> Edge:
    edge = await db.get(Edge, edge_id)
    if not edge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    sent = body.model_dump(exclude_unset=True)
    await _reject_missing_handle(db, edge.source, sent.get("source_handle"), "source")
    await _reject_missing_handle(db, edge.target, sent.get("target_handle"), "target")
    for field, value in sent.items():
        setattr(edge, field, value)
    await db.commit()
    await db.refresh(edge)
    return edge
