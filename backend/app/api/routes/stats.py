import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.db.models import Node, PendingDevice, ScanRun

router = APIRouter()


def _check_key(x_api_key: str | None) -> None:
    if not settings.homepage_api_key:
        raise HTTPException(status_code=403, detail="Stats endpoint is disabled")
    if not x_api_key or not hmac.compare_digest(x_api_key, settings.homepage_api_key):
        raise HTTPException(status_code=403, detail="Invalid API key")


@router.get("/summary")
async def summary(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    """Read-only stats payload for the gethomepage `customapi` widget.

    Disabled unless HOMEPAGE_API_KEY is set. Caller must send the same
    value in the `X-API-Key` header.
    """
    _check_key(x_api_key)

    status_rows = (
        await db.execute(select(Node.status, func.count()).group_by(Node.status))
    ).all()
    counts = {row[0]: row[1] for row in status_rows}

    pending = (
        await db.execute(
            select(func.count())
            .select_from(PendingDevice)
            .where(PendingDevice.status == "pending")
        )
    ).scalar_one()

    zigbee = (
        await db.execute(
            select(func.count()).select_from(Node).where(Node.ieee_address.isnot(None))
        )
    ).scalar_one()

    last_scan_at = (
        await db.execute(select(func.max(ScanRun.finished_at)))
    ).scalar_one()

    return {
        "nodes": sum(counts.values()),
        "online": counts.get("online", 0),
        "offline": counts.get("offline", 0),
        "unknown": counts.get("unknown", 0),
        "pending_devices": pending,
        "zigbee_devices": zigbee,
        "last_scan_at": last_scan_at.isoformat() if last_scan_at else None,
    }
