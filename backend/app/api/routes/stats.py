import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import get_db
from app.db.models import InventoryDevice, Node, ScanRun

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

    # A node's reachability lives on the Device Inventory row it draws, so the
    # per-canvas counts come from the join. A node with no row (canvas
    # furniture) counts as unknown.
    status_rows = (
        await db.execute(
            select(InventoryDevice.status_live, func.count())
            .select_from(Node)
            .join(InventoryDevice, Node.device_id == InventoryDevice.id)
            .group_by(InventoryDevice.status_live)
        )
    ).all()
    counts = {(row[0] or "unknown"): row[1] for row in status_rows}
    unlinked = (
        await db.execute(select(func.count()).select_from(Node).where(Node.device_id.is_(None)))
    ).scalar_one()
    if unlinked:
        counts["unknown"] = counts.get("unknown", 0) + unlinked

    pending = (
        await db.execute(
            select(func.count())
            .select_from(InventoryDevice)
            .where(InventoryDevice.status == "pending")
        )
    ).scalar_one()

    zigbee = (
        await db.execute(
            select(func.count())
            .select_from(Node)
            .join(InventoryDevice, Node.device_id == InventoryDevice.id)
            .where(InventoryDevice.ieee_address.isnot(None))
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
        # Wire key kept from before the table was renamed to `device_inventory`:
        # the stats payload is a published contract, and the MCP server reads it.
        "pending_devices": pending,
        "zigbee_devices": zigbee,
        "last_scan_at": last_scan_at.isoformat() if last_scan_at else None,
    }
