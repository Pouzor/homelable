"""App-level settings (status checker interval, etc.)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_auto_scan, reschedule_status_checks

router = APIRouter()


class AppSettings(BaseModel):
    interval_seconds: int
    scan_interval_seconds: int
    default_node_color: str | None = None
    default_edge_color: str | None = None
    node_type_colors: dict[str, str] = {}
    edge_type_colors: dict[str, str] = {}


@router.get("", response_model=AppSettings)
async def get_settings(_: str = Depends(get_current_user)) -> AppSettings:
    return AppSettings(
        interval_seconds=settings.status_checker_interval,
        scan_interval_seconds=settings.scan_interval_seconds,
        default_node_color=settings.default_node_color,
        default_edge_color=settings.default_edge_color,
        node_type_colors=settings.node_type_colors,
        edge_type_colors=settings.edge_type_colors,
    )


@router.post("", response_model=AppSettings)
async def update_settings(
    payload: AppSettings, _: str = Depends(get_current_user)
) -> AppSettings:
    try:
        settings.status_checker_interval = payload.interval_seconds
        settings.scan_interval_seconds = payload.scan_interval_seconds
        settings.default_node_color = payload.default_node_color
        settings.default_edge_color = payload.default_edge_color
        settings.node_type_colors = payload.node_type_colors
        settings.edge_type_colors = payload.edge_type_colors
        settings.save_overrides()
        reschedule_status_checks(payload.interval_seconds)
        reschedule_auto_scan(payload.scan_interval_seconds)
        return payload
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
