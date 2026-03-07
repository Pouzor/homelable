from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Edge, Node
from app.schemas.canvas import CanvasSaveRequest, CanvasStateResponse

router = APIRouter()


@router.get("", response_model=CanvasStateResponse)
async def load_canvas(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    nodes = (await db.execute(select(Node))).scalars().all()
    edges = (await db.execute(select(Edge))).scalars().all()
    state = await db.get(CanvasState, 1)
    viewport = state.viewport if state else {"x": 0, "y": 0, "zoom": 1}
    return CanvasStateResponse(nodes=list(nodes), edges=list(edges), viewport=viewport)


@router.post("/save")
async def save_canvas(body: CanvasSaveRequest, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    # Update node positions from canvas
    for node_pos in body.node_positions:
        node = await db.get(Node, node_pos.id)
        if node:
            node.pos_x = node_pos.x
            node.pos_y = node_pos.y

    # Upsert viewport
    state = await db.get(CanvasState, 1)
    if state:
        state.viewport = body.viewport
        state.saved_at = datetime.now(UTC)
    else:
        db.add(CanvasState(id=1, viewport=body.viewport))

    await db.commit()
    return {"saved": True}
