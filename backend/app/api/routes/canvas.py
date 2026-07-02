import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Design, Edge, Node
from app.schemas.canvas import CanvasSaveRequest, CanvasStateResponse
from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse

router = APIRouter()


@router.get("", response_model=CanvasStateResponse)
async def load_canvas(
    design_id: str | None = Query(None, description="Design ID to load; uses first design if omitted"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> CanvasStateResponse:
    if design_id is None:
        first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        design_id = first.id if first else None
    if design_id is None:
        return CanvasStateResponse(nodes=[], edges=[], viewport={"x": 0, "y": 0, "zoom": 1}, custom_style=None)

    nodes = (await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all()
    edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    state = await db.get(CanvasState, design_id)
    viewport: dict[str, Any] = state.viewport if state else {"x": 0, "y": 0, "zoom": 1}
    return CanvasStateResponse(
        nodes=[NodeResponse.model_validate(n) for n in nodes],
        edges=[EdgeResponse.model_validate(e) for e in edges],
        viewport=viewport,
        custom_style=state.custom_style if state else None,
    )


@router.post("/save")
async def save_canvas(
    body: CanvasSaveRequest, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool | str]:
    design_id = body.design_id
    if design_id is None:
        first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        design_id = first.id if first else None
    if design_id is None:
        new_design = Design(id=str(uuid.uuid4()), name="Network Topology", design_type="network")
        db.add(new_design)
        await db.flush()
        design_id = new_design.id

    incoming_node_ids = {n.id for n in body.nodes}
    incoming_edge_ids = {e.id for e in body.edges}

    # Delete nodes removed from canvas (only within this design)
    existing_nodes = (await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all()
    for node in existing_nodes:
        if node.id not in incoming_node_ids:
            await db.delete(node)

    # Delete edges removed from canvas (only within this design)
    existing_edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    for edge in existing_edges:
        if edge.id not in incoming_edge_ids:
            await db.delete(edge)

    await db.flush()

    # Upsert nodes
    for node_data in body.nodes:
        db_node = await db.get(Node, node_data.id)
        payload = node_data.model_dump()
        payload["design_id"] = design_id
        if db_node:
            for field, value in payload.items():
                setattr(db_node, field, value)
        else:
            db.add(Node(**payload))

    # Upsert edges
    for edge_data in body.edges:
        db_edge = await db.get(Edge, edge_data.id)
        payload = edge_data.model_dump()
        payload["design_id"] = design_id
        if db_edge:
            for field, value in payload.items():
                setattr(db_edge, field, value)
        else:
            db.add(Edge(**payload))

    # Upsert viewport + custom style
    state = await db.get(CanvasState, design_id)
    if state:
        state.viewport = body.viewport
        state.custom_style = body.custom_style
        state.saved_at = datetime.now(timezone.utc)
    else:
        db.add(CanvasState(design_id=design_id, viewport=body.viewport, custom_style=body.custom_style))

    await db.commit()
    return {"saved": True}
