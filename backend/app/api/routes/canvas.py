from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Edge, Node
from app.schemas.canvas import CanvasSaveRequest, CanvasStateResponse
from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse

router = APIRouter()


@router.get("", response_model=CanvasStateResponse)
async def load_canvas(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> CanvasStateResponse:
    nodes = (await db.execute(select(Node))).scalars().all()
    edges = (await db.execute(select(Edge))).scalars().all()
    state = await db.get(CanvasState, 1)
    viewport: dict[str, Any] = state.viewport if state else {"x": 0, "y": 0, "zoom": 1}
    return CanvasStateResponse(
        nodes=[NodeResponse.model_validate(n) for n in nodes],
        edges=[EdgeResponse.model_validate(e) for e in edges],
        viewport=viewport,
    )


@router.post("/save")
async def save_canvas(
    body: CanvasSaveRequest, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    incoming_node_ids = {n.id for n in body.nodes}
    incoming_edge_ids = {e.id for e in body.edges}

    # Delete nodes removed from canvas
    existing_nodes = (await db.execute(select(Node))).scalars().all()
    for node in existing_nodes:
        if node.id not in incoming_node_ids:
            await db.delete(node)

    # Delete edges removed from canvas
    existing_edges = (await db.execute(select(Edge))).scalars().all()
    for edge in existing_edges:
        if edge.id not in incoming_edge_ids:
            await db.delete(edge)

    await db.flush()

    # Upsert nodes
    for node_data in body.nodes:
        # Ensure we dump using internal field names (not aliases) so setattr maps correctly
        node_payload = node_data.model_dump(by_alias=False)
        db_node = await db.get(Node, node_data.id)
        if db_node:
            for field, value in node_payload.items():
                setattr(db_node, field, value)
        else:
            db.add(Node(**node_payload))

    # Upsert edges
    for edge_data in body.edges:
        edge_payload = edge_data.model_dump(by_alias=False)
        db_edge = await db.get(Edge, edge_data.id)
        if db_edge:
            for field, value in edge_payload.items():
                setattr(db_edge, field, value)
        else:
            db.add(Edge(**edge_payload))

    # Upsert viewport
    state = await db.get(CanvasState, 1)
    if state:
        state.viewport = body.viewport
        state.saved_at = datetime.now(timezone.utc)
    else:
        db.add(CanvasState(id=1, viewport=body.viewport))

    await db.commit()
    return {"saved": True}
