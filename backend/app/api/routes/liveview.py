from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.db.models import CanvasState, Edge, Node
from app.schemas.canvas import CanvasStateResponse
from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse

router = APIRouter()


@router.get("", response_model=CanvasStateResponse)
async def liveview_canvas(
    key: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> CanvasStateResponse:
    """Read-only public canvas endpoint.

    Disabled by default — requires LIVEVIEW_KEY to be set in .env.
    Always returns 403 when disabled, regardless of the key provided.
    """
    if not settings.liveview_key:
        raise HTTPException(status_code=403, detail="Live view is disabled")
    if not key or key != settings.liveview_key:
        raise HTTPException(status_code=403, detail="Invalid live view key")

    nodes = (await db.execute(select(Node))).scalars().all()
    edges = (await db.execute(select(Edge))).scalars().all()
    state = await db.get(CanvasState, 1)
    viewport: dict[str, Any] = state.viewport if state else {"x": 0, "y": 0, "zoom": 1}
    return CanvasStateResponse(
        nodes=[NodeResponse.model_validate(n) for n in nodes],
        edges=[EdgeResponse.model_validate(e) for e in edges],
        viewport=viewport,
    )
