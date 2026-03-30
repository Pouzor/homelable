"""App-level settings (status checker interval, etc.)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.core.config import settings

router = APIRouter()


class AppSettings(BaseModel):
    interval_seconds: int


@router.get("", response_model=AppSettings)
async def get_settings(_: str = Depends(get_current_user)) -> AppSettings:
    return AppSettings(interval_seconds=settings.status_checker_interval)


@router.post("", response_model=AppSettings)
async def update_settings(
    payload: AppSettings, _: str = Depends(get_current_user)
) -> AppSettings:
    try:
        settings.status_checker_interval = payload.interval_seconds
        settings.save_overrides()
        return payload
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
