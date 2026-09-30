"""FastAPI router for OPNsense import + auto-sync config."""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_opnsense_sync, set_opnsense_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, ScanRun
from app.schemas.opnsense import (
    OpnsenseConfig,
    OpnsenseImportResponse,
    OpnsenseSyncConfig,
    OpnsenseTestConnectionResponse,
)
from app.schemas.scan import ScanRunResponse
from app.services.discovery_sources import add_source
from app.services.opnsense_service import fetch_opnsense_inventory, test_opnsense_connection

logger = logging.getLogger(__name__)
router = APIRouter()

_SOURCE = "opnsense"


def _credentials_ok() -> bool:
    return bool(settings.opnsense_url and settings.opnsense_api_key and settings.opnsense_api_secret)


@router.post("/test-connection", response_model=OpnsenseTestConnectionResponse)
async def test_connection_endpoint(
    _: str = Depends(get_current_user),
) -> OpnsenseTestConnectionResponse:
    if not _credentials_ok():
        raise HTTPException(
            status_code=400,
            detail=(
                "No OPNsense URL/credentials configured."
                " Set OPNSENSE_URL, OPNSENSE_API_KEY, OPNSENSE_API_SECRET in the server .env."
            ),
        )
    connected, message = await test_opnsense_connection(
        base_url=settings.opnsense_url,
        api_key=settings.opnsense_api_key,
        api_secret=settings.opnsense_api_secret,
        verify_tls=settings.opnsense_verify_tls,
    )
    return OpnsenseTestConnectionResponse(connected=connected, message=message)


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_opnsense_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    if not _credentials_ok():
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no OPNsense URL/credentials configured in the server env.",
        )
    run = ScanRun(status="running", kind="opnsense", ranges=[settings.opnsense_url])
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_opnsense_sync, run.id)
    return run


@router.get("/config", response_model=OpnsenseConfig)
async def get_opnsense_config(_: str = Depends(get_current_user)) -> OpnsenseConfig:
    return OpnsenseConfig(
        url=settings.opnsense_url,
        verify_tls=settings.opnsense_verify_tls,
        sync_enabled=settings.opnsense_sync_enabled,
        sync_interval=settings.opnsense_sync_interval,
        credentials_configured=_credentials_ok(),
    )


@router.post("/config", response_model=OpnsenseConfig)
async def save_opnsense_config(
    payload: OpnsenseSyncConfig,
    _: str = Depends(get_current_user),
) -> OpnsenseConfig:
    if payload.sync_enabled and not _credentials_ok():
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no OPNsense URL/credentials configured in the server env.",
        )
    try:
        settings.opnsense_sync_enabled = payload.sync_enabled
        settings.opnsense_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_opnsense_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_opnsense_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_opnsense_config(_)


async def _find_existing(
    db: AsyncSession, ieee: str, mac: str | None
) -> InventoryDevice | None:
    # Primary: stable ieee_address (opnsense-{mac} or opnsense-{ip})
    row = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
    ).scalars().first()
    if row is not None:
        return row
    # Secondary: MAC match only for rows without ieee_address yet
    if mac:
        row = (
            await db.execute(
                select(InventoryDevice).where(
                    InventoryDevice.mac == mac,
                    InventoryDevice.ieee_address.is_(None),
                )
            )
        ).scalars().first()
    return row


async def _persist_devices(
    db: AsyncSession,
    devices: list[dict[str, Any]],
) -> OpnsenseImportResponse:
    pending_created = 0
    pending_updated = 0

    for dev in devices:
        ieee = dev.get("ieee_address")
        if not ieee:
            continue
        ip = dev.get("ip")
        mac = dev.get("mac")

        existing = await _find_existing(db, ieee, mac)

        if existing is None:
            row = InventoryDevice(
                ieee_address=ieee,
                ip=ip,
                mac=mac,
                hostname=dev.get("hostname"),
                friendly_name=dev.get("label"),
                suggested_type=dev.get("type"),
                vendor=dev.get("vendor"),
                model=dev.get("model"),
                properties=dev.get("properties", []),
                status="pending",
                discovery_source=_SOURCE,
                discovery_sources=[_SOURCE],
            )
            db.add(row)
            pending_created += 1
        else:
            existing.discovery_sources = add_source(
                list(existing.discovery_sources or []), _SOURCE
            )
            existing.ip = ip or existing.ip
            existing.mac = existing.mac or mac
            existing.hostname = dev.get("hostname") or existing.hostname
            existing.friendly_name = dev.get("label") or existing.friendly_name
            pending_updated += 1

    await db.commit()
    return OpnsenseImportResponse(
        device_count=len(devices),
        pending_created=pending_created,
        pending_updated=pending_updated,
    )


async def _background_opnsense_sync(run_id: str) -> None:
    async with AsyncSessionLocal() as db:
        try:
            devices = await fetch_opnsense_inventory(
                base_url=settings.opnsense_url,
                api_key=settings.opnsense_api_key,
                api_secret=settings.opnsense_api_secret,
                verify_tls=settings.opnsense_verify_tls,
            )
            result = await _persist_devices(db, devices)
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "done"
                run.devices_found = result.device_count
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
            from app.api.routes.status import broadcast_scan_update
            await broadcast_scan_update(run_id=run_id, devices_found=result.device_count)
        except Exception as exc:
            logger.exception("OPNsense sync %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
