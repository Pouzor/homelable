import ipaddress
import logging
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import Node, PendingDevice, ScanRun
from app.schemas.nodes import NodeCreate
from app.schemas.scan import PendingDeviceResponse, ScanRunResponse
from app.services.scanner import request_cancel, run_scan


class BulkActionRequest(BaseModel):
    device_ids: list[str]


class ScanConfig(BaseModel):
    ranges: list[str]

    @field_validator("ranges")
    @classmethod
    def validate_cidr(cls, v: list[str]) -> list[str]:
        for r in v:
            try:
                ipaddress.ip_network(r, strict=False)
            except ValueError as exc:
                raise ValueError(f"Invalid CIDR range: {r!r}") from exc
        return v


logger = logging.getLogger(__name__)
router = APIRouter()


async def _background_scan(run_id: str, ranges: list[str]) -> None:
    async with AsyncSessionLocal() as db:
        await run_scan(ranges, db, run_id)


@router.post("/trigger", response_model=ScanRunResponse)
async def trigger_scan(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    ranges = settings.scanner_ranges
    run = ScanRun(status="running", ranges=ranges)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_scan, run.id, ranges)
    return run


@router.post("/{run_id}/stop", response_model=dict)
async def stop_scan(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, bool]:
    try:
        uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run_id format") from None
    run = await db.get(ScanRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Scan run not found")
    if run.status != "running":
        raise HTTPException(status_code=409, detail="Scan is not running")
    request_cancel(run_id)
    return {"stopping": True}


@router.get("/pending", response_model=list[PendingDeviceResponse])
async def list_pending(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[PendingDevice]:
    result = await db.execute(select(PendingDevice).where(PendingDevice.status == "pending"))
    return list(result.scalars().all())


@router.delete("/pending", response_model=dict)
async def clear_pending(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, int]:
    result = await db.execute(select(PendingDevice).where(PendingDevice.status == "pending"))
    devices = result.scalars().all()
    for device in devices:
        await db.delete(device)
    await db.commit()
    return {"deleted": len(devices)}


@router.get("/hidden", response_model=list[PendingDeviceResponse])
async def list_hidden(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[PendingDevice]:
    result = await db.execute(select(PendingDevice).where(PendingDevice.status == "hidden"))
    return list(result.scalars().all())


@router.post("/pending/bulk-approve", response_model=dict)
async def bulk_approve_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(PendingDevice).where(
            PendingDevice.id.in_(payload.device_ids),
            PendingDevice.status == "pending",
        )
    )
    devices = result.scalars().all()
    node_ids: list[str] = []
    for device in devices:
        device.status = "approved"
        node = Node(
            label=device.hostname or device.ip,
            type=device.suggested_type or "generic",
            ip=device.ip,
            hostname=device.hostname,
            status="unknown",
            services=device.services or [],
        )
        db.add(node)
        node_ids.append(node.id)
    await db.commit()
    approved_device_ids = [d.id for d in devices]
    return {
        "approved": len(node_ids),
        "node_ids": node_ids,
        "device_ids": approved_device_ids,
        "skipped": len(payload.device_ids) - len(node_ids),
    }


@router.post("/pending/bulk-hide", response_model=dict)
async def bulk_hide_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(PendingDevice).where(
            PendingDevice.id.in_(payload.device_ids),
            PendingDevice.status == "pending",
        )
    )
    devices = result.scalars().all()
    for device in devices:
        device.status = "hidden"
    await db.commit()
    return {"hidden": len(devices), "skipped": len(payload.device_ids) - len(devices)}


@router.post("/pending/{device_id}/approve", response_model=dict)
async def approve_device(
    device_id: str,
    node_data: NodeCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    device = await db.get(PendingDevice, device_id)
    if device:
        device.status = "approved"
        node = Node(**node_data.model_dump())
        db.add(node)
        await db.commit()
        return {"approved": True, "node_id": node.id}
    return {"approved": False}


@router.post("/pending/{device_id}/hide")
async def hide_device(
    device_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    device = await db.get(PendingDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.status = "hidden"
    await db.commit()
    return {"hidden": True}


@router.post("/pending/{device_id}/ignore")
async def ignore_device(
    device_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    device = await db.get(PendingDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()
    return {"ignored": True}


@router.get("/runs", response_model=list[ScanRunResponse])
async def list_runs(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[ScanRun]:
    result = await db.execute(select(ScanRun).order_by(ScanRun.started_at.desc()).limit(20))
    return list(result.scalars().all())


@router.get("/config", response_model=ScanConfig)
async def get_scan_config(_: str = Depends(get_current_user)) -> ScanConfig:
    return ScanConfig(ranges=settings.scanner_ranges)


@router.post("/config", response_model=ScanConfig)
async def update_scan_config(payload: ScanConfig, _: str = Depends(get_current_user)) -> ScanConfig:
    try:
        settings.scanner_ranges = payload.ranges
        settings.save_overrides()
        return payload
    except Exception as exc:
        logger.error("Failed to save scan config: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save scan config") from exc
