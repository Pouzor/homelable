import hmac
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.database import get_db
from app.db.models import CanvasState, Design, Edge, Node
from app.schemas.canvas import CanvasStateResponse
from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse

router = APIRouter()


class LiveViewConfigResponse(BaseModel):
    """Whether live view is enabled, plus the key (admin-only) to build share links."""

    enabled: bool
    key: str | None = None


@router.get("/config", response_model=LiveViewConfigResponse)
async def liveview_config(
    _: str = Depends(get_current_user),
) -> LiveViewConfigResponse:
    """Authenticated: expose the configured live view key so the UI can build a
    ready-to-use share link (e.g. /view?key=...&design=<id>).

    Only reachable by a logged-in user — the key is never exposed publicly.
    """
    key = settings.liveview_key or None
    return LiveViewConfigResponse(enabled=bool(key), key=key)


@router.get("", response_model=CanvasStateResponse)
async def liveview_canvas(
    key: str | None = Query(default=None),
    design_id: str | None = Query(default=None, description="Design to show; uses first if omitted"),
    db: AsyncSession = Depends(get_db),
) -> CanvasStateResponse:
    """Read-only public canvas endpoint.

    Disabled by default — requires LIVEVIEW_KEY to be set in .env.
    Always returns 403 when disabled, regardless of the key provided.
    """
    if not settings.liveview_key:
        raise HTTPException(status_code=403, detail="Live view is disabled")
    if not key or not hmac.compare_digest(key, settings.liveview_key):
        raise HTTPException(status_code=403, detail="Invalid live view key")

    if design_id is None:
        first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        design_id = first.id if first else None
    if design_id is None:
        return CanvasStateResponse(nodes=[], edges=[], viewport={"x": 0, "y": 0, "zoom": 1}, custom_style=None)

    nodes = (await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all()
    edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    state = await db.get(CanvasState, design_id)
    viewport: dict[str, Any] = state.viewport if state else {"x": 0, "y": 0, "zoom": 1}
    custom_style: dict[str, Any] | None = state.custom_style if state else None
    return CanvasStateResponse(
        nodes=[NodeResponse.model_validate(n) for n in nodes],
        edges=[EdgeResponse.model_validate(e) for e in edges],
        viewport=viewport,
        custom_style=custom_style,
    )
