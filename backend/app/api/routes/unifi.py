"""FastAPI router for UniFi Network Controller import + auto-sync config."""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_unifi_sync, set_unifi_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, ScanRun
from app.schemas.unifi import (
    UnifiConfig,
    UnifiConnectionRequest,
    UnifiImportResponse,
    UnifiSyncConfig,
    UnifiTestConnectionResponse,
)
from app.services.discovery_sources import add_source
from app.services.unifi_service import fetch_unifi_inventory, test_unifi_connection

logger = logging.getLogger(__name__)
router = APIRouter()

_UNIFI_SOURCE = "unifi"


def _resolve_credentials(payload: UnifiConnectionRequest) -> tuple[str, str]:
    username = payload.username or settings.unifi_username
    password = payload.password or settings.unifi_password
    if not username or not password:
        raise HTTPException(
            status_code=400,
            detail="No UniFi credentials provided and none configured on the server.",
        )
    return username, password


@router.post("/test-connection", response_model=UnifiTestConnectionResponse)
async def test_connection_endpoint(
    payload: UnifiConnectionRequest,
    _: str = Depends(get_current_user),
) -> UnifiTestConnectionResponse:
    username, password = _resolve_credentials(payload)
    connected, message = await test_unifi_connection(
        host=payload.host,
        port=payload.port,
        site=payload.site,
        username=username,
        password=password,
        verify_tls=payload.verify_tls,
    )
    return UnifiTestConnectionResponse(connected=connected, message=message)


@router.post("/import-pending", response_model=UnifiImportResponse)
async def import_unifi_pending(
    payload: UnifiConnectionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> UnifiImportResponse:
    """Fetch UniFi inventory and upsert into pending device inventory."""
    username, password = _resolve_credentials(payload)
    try:
        devices = await fetch_unifi_inventory(
            host=payload.host,
            port=payload.port,
            site=payload.site,
            username=username,
            password=password,
            verify_tls=payload.verify_tls,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during UniFi import")
        raise HTTPException(status_code=500, detail="Unexpected error during UniFi import") from exc

    result = await _persist_devices(db, devices)
    return result


@router.post("/sync-now", response_model=UnifiImportResponse)
async def sync_unifi_now(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> UnifiImportResponse:
    if not (settings.unifi_effective_host and settings.unifi_username and settings.unifi_password):
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no UniFi host/credentials configured on the server.",
        )
    try:
        devices = await fetch_unifi_inventory(
            host=settings.unifi_effective_host,
            port=settings.unifi_effective_port,
            site=settings.unifi_site,
            username=settings.unifi_username,
            password=settings.unifi_password,
            verify_tls=settings.unifi_verify_tls,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return await _persist_devices(db, devices)


@router.get("/config", response_model=UnifiConfig)
async def get_unifi_config(_: str = Depends(get_current_user)) -> UnifiConfig:
    return UnifiConfig(
        host=settings.unifi_effective_host,
        port=settings.unifi_effective_port,
        site=settings.unifi_site,
        verify_tls=settings.unifi_verify_tls,
        sync_enabled=settings.unifi_sync_enabled,
        sync_interval=settings.unifi_sync_interval,
        credentials_configured=bool(settings.unifi_username and settings.unifi_password),
    )


@router.post("/config", response_model=UnifiConfig)
async def save_unifi_config(
    payload: UnifiSyncConfig,
    _: str = Depends(get_current_user),
) -> UnifiConfig:
    if payload.sync_enabled and not (
        settings.unifi_effective_host and settings.unifi_username and settings.unifi_password
    ):
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no UniFi host/credentials configured in the server env.",
        )
    try:
        settings.unifi_sync_enabled = payload.sync_enabled
        settings.unifi_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_unifi_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_unifi_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_unifi_config()


async def _find_existing(
    db: AsyncSession, ieee: str, mac: str | None
) -> InventoryDevice | None:
    row = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
    ).scalars().first()
    if row is not None:
        return row
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
) -> UnifiImportResponse:
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
                discovery_source=_UNIFI_SOURCE,
                discovery_sources=[_UNIFI_SOURCE],
            )
            db.add(row)
            pending_created += 1
        else:
            existing.discovery_sources = add_source(
                list(existing.discovery_sources or []),
                _UNIFI_SOURCE,
            )
            existing.ieee_address = existing.ieee_address or ieee
            existing.ip = ip or existing.ip
            existing.mac = existing.mac or mac
            existing.hostname = dev.get("hostname") or existing.hostname
            existing.friendly_name = dev.get("label") or existing.friendly_name
            existing.suggested_type = dev.get("type") or existing.suggested_type
            existing.vendor = dev.get("vendor") or existing.vendor
            existing.model = dev.get("model") or existing.model
            # Status preserved — an approved device stays approved.
            # Only reset hidden devices (they came back visible in UniFi).
            if existing.status == "hidden":
                existing.status = "pending"
            pending_updated += 1

    await db.commit()
    return UnifiImportResponse(
        device_count=len(devices),
        pending_created=pending_created,
        pending_updated=pending_updated,
    )


async def _background_unifi_sync(run_id: str) -> None:
    async with AsyncSessionLocal() as db:
        try:
            devices = await fetch_unifi_inventory(
                host=settings.unifi_effective_host,
                port=settings.unifi_effective_port,
                site=settings.unifi_site,
                username=settings.unifi_username,
                password=settings.unifi_password,
                verify_tls=settings.unifi_verify_tls,
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
            logger.exception("UniFi sync %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
