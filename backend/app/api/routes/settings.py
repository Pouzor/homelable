"""App-level settings (status checker interval, etc.)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_service_checks, set_service_checks_enabled

router = APIRouter()


class AppSettings(BaseModel):
    interval_seconds: int
    service_check_enabled: bool = False
    service_check_interval: int = Field(default=300, ge=30)


@router.get("", response_model=AppSettings)
async def get_settings(_: str = Depends(get_current_user)) -> AppSettings:
    return AppSettings(
        interval_seconds=settings.status_checker_interval,
        service_check_enabled=settings.service_check_enabled,
        service_check_interval=settings.service_check_interval,
    )


@router.post("", response_model=AppSettings)
async def update_settings(
    payload: AppSettings, _: str = Depends(get_current_user)
) -> AppSettings:
    try:
        settings.status_checker_interval = payload.interval_seconds
        settings.service_check_enabled = payload.service_check_enabled
        settings.service_check_interval = payload.service_check_interval
        settings.save_overrides()
        # Apply the service-check schedule live.
        set_service_checks_enabled(payload.service_check_enabled)
        if payload.service_check_enabled:
            reschedule_service_checks(payload.service_check_interval)
        return payload
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
