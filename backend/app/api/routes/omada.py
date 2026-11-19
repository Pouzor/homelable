"""FastAPI router for TP-Link Omada SDN Controller import + auto-sync config."""

import logging
from datetime import datetime, timezone
from typing import Any, NamedTuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_omada_sync, set_omada_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, ScanRun
from app.schemas.omada import (
    OmadaConfig,
    OmadaConnectionRequest,
    OmadaImportModes,
    OmadaImportResponse,
    OmadaSyncConfig,
    OmadaTestConnectionResponse,
)
from app.services.discovery_sources import add_source
from app.services.omada_service import (
    SOURCE_CLIENT,
    SOURCE_INFRA,
    fetch_omada_inventory,
    merge_omada_properties,
    omada_target,
    test_omada_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class _Credentials(NamedTuple):
    omada_id: str
    client_id: str
    client_secret: str


def _configured_modes() -> OmadaImportModes:
    """The import modes persisted in scan_config.json, used by the sync paths."""
    return OmadaImportModes(
        infrastructure=settings.omada_import_infrastructure,
        clients=settings.omada_import_clients,
    )


def _env_ready() -> bool:
    return bool(
        settings.omada_effective_url and settings.omada_client_id and settings.omada_client_secret
    )


def _resolve_credentials(payload: OmadaConnectionRequest) -> _Credentials:
    """The request's credentials, else the env ones for the configured controller.

    The env secret is only ever sent to OMADA_URL: a request naming any other
    address must bring its own, or the secret could be posted to a host of the
    caller's choosing.
    """
    for_env_controller = bool(settings.omada_effective_url) and payload.url == settings.omada_effective_url
    omada_id = payload.omada_id or (settings.omada_id if for_env_controller else "")
    if payload.client_secret:
        client_id = payload.client_id or (settings.omada_client_id if for_env_controller else "")
        client_secret = payload.client_secret
    elif for_env_controller:
        client_id = payload.client_id or settings.omada_client_id
        client_secret = settings.omada_client_secret
    else:
        raise HTTPException(
            status_code=400,
            detail="No Omada client secret provided, and the server's is only used for OMADA_URL.",
        )
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=400,
            detail="No Omada client ID/secret provided and none configured on the server.",
        )
    return _Credentials(omada_id or "", client_id, client_secret)


@router.post("/test-connection", response_model=OmadaTestConnectionResponse)
async def test_connection_endpoint(
    payload: OmadaConnectionRequest,
    _: str = Depends(get_current_user),
) -> OmadaTestConnectionResponse:
    creds = _resolve_credentials(payload)
    connected, message, counts = await test_omada_connection(
        url=payload.url,
        omada_id=creds.omada_id,
        client_id=creds.client_id,
        client_secret=creds.client_secret,
        site=payload.site,
        verify_tls=payload.verify_tls,
        clients=payload.modes.clients,
    )
    return OmadaTestConnectionResponse(connected=connected, message=message, counts=counts)


async def _record_run(
    db: AsyncSession,
    target: str,
    started_at: datetime,
    *,
    status: str,
    devices_found: int = 0,
    error: str | None = None,
) -> str:
    """Log a manual Omada import in Scan History.

    The manual import runs inline, like the UniFi one, so the run is written
    once, already terminal.
    """
    run = ScanRun(
        status=status,
        kind="omada",
        ranges=[target],
        devices_found=devices_found,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc),
        error=error,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run.id


@router.post("/import-pending", response_model=OmadaImportResponse)
async def import_omada_pending(
    payload: OmadaConnectionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> OmadaImportResponse:
    """Fetch the Omada inventory and upsert it into the pending device inventory."""
    creds = _resolve_credentials(payload)
    started_at = datetime.now(timezone.utc)
    target = omada_target(payload.url)
    try:
        devices = await fetch_omada_inventory(
            url=payload.url,
            omada_id=creds.omada_id,
            client_id=creds.client_id,
            client_secret=creds.client_secret,
            site=payload.site,
            verify_tls=payload.verify_tls,
            infrastructure=payload.modes.infrastructure,
            clients=payload.modes.clients,
        )
    except ConnectionError as exc:
        await _record_run(db, target, started_at, status="error", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Omada import")
        await _record_run(
            db, target, started_at, status="error", error="Unexpected error during Omada import"
        )
        raise HTTPException(status_code=500, detail="Unexpected error during Omada import") from exc

    result = await _persist_devices(db, devices)
    await _record_run(db, target, started_at, status="done", devices_found=result.device_count)
    return result


async def _fetch_configured() -> list[dict[str, Any]]:
    """The inventory of the env-configured controller, with the persisted modes."""
    return await fetch_omada_inventory(
        url=settings.omada_effective_url,
        omada_id=settings.omada_id,
        client_id=settings.omada_client_id,
        client_secret=settings.omada_client_secret,
        site=settings.omada_site,
        verify_tls=settings.omada_verify_tls,
        infrastructure=settings.omada_import_infrastructure,
        clients=settings.omada_import_clients,
    )


@router.post("/sync-now", response_model=OmadaImportResponse)
async def sync_omada_now(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> OmadaImportResponse:
    if not _env_ready():
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Omada URL/credentials configured on the server.",
        )
    started_at = datetime.now(timezone.utc)
    target = omada_target(settings.omada_effective_url)
    try:
        devices = await _fetch_configured()
    except Exception as exc:
        await _record_run(db, target, started_at, status="error", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    result = await _persist_devices(db, devices)
    await _record_run(db, target, started_at, status="done", devices_found=result.device_count)
    return result


@router.get("/config", response_model=OmadaConfig)
async def get_omada_config(_: str = Depends(get_current_user)) -> OmadaConfig:
    return OmadaConfig(
        url=settings.omada_effective_url,
        omada_id=settings.omada_id,
        site=settings.omada_site,
        verify_tls=settings.omada_verify_tls,
        sync_enabled=settings.omada_sync_enabled,
        sync_interval=settings.omada_sync_interval,
        credentials_configured=bool(settings.omada_client_id and settings.omada_client_secret),
        modes=_configured_modes(),
    )


@router.post("/config", response_model=OmadaConfig)
async def save_omada_config(
    payload: OmadaSyncConfig,
    _: str = Depends(get_current_user),
) -> OmadaConfig:
    if payload.sync_enabled and not _env_ready():
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Omada URL/credentials configured in the server env.",
        )
    try:
        settings.omada_sync_enabled = payload.sync_enabled
        settings.omada_sync_interval = payload.sync_interval
        settings.omada_import_infrastructure = payload.modes.infrastructure
        settings.omada_import_clients = payload.modes.clients
        settings.save_overrides()
        set_omada_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_omada_sync(payload.sync_interval)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_omada_config()


async def _find_existing(
    db: AsyncSession, ieee: str, mac: str | None
) -> InventoryDevice | None:
    """The inventory row this Omada record *is*: its ``omada-{mac}`` ieee, else its MAC.

    A MAC is an identity, as for the UniFi import: a machine an IP scan or the
    Proxmox import found first, then reported by the controller as a client, is
    one machine and stays one row. Oldest row wins, so a re-import is stable
    when two rows somehow share a MAC.
    """
    row = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
    ).scalars().first()
    if row is not None:
        return row
    if mac:
        row = (
            await db.execute(
                select(InventoryDevice)
                .where(InventoryDevice.mac == mac)
                .order_by(InventoryDevice.discovered_at, InventoryDevice.id)
            )
        ).scalars().first()
    return row


def _owns(row: InventoryDevice) -> bool:
    """True when Omada is the only source that has ever seen this row."""
    sources = {s for s in (row.discovery_sources or []) if s}
    return bool(sources) and sources <= {SOURCE_INFRA, SOURCE_CLIENT}


async def _persist_devices(
    db: AsyncSession,
    devices: list[dict[str, Any]],
) -> OmadaImportResponse:
    pending_created = 0
    pending_updated = 0
    infra_count = 0
    client_count = 0

    for dev in devices:
        ieee = dev.get("ieee_address")
        if not ieee:
            continue
        ip = dev.get("ip")
        mac = dev.get("mac")
        source = dev.get("source") or SOURCE_INFRA
        if source == SOURCE_CLIENT:
            client_count += 1
        else:
            infra_count += 1

        existing = await _find_existing(db, ieee, mac)

        if existing is None:
            db.add(InventoryDevice(
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
                discovery_source=source,
                discovery_sources=[source],
            ))
            pending_created += 1
            continue

        existing.discovery_sources = add_source(list(existing.discovery_sources or []), source)
        existing.ieee_address = existing.ieee_address or ieee
        existing.ip = ip or existing.ip
        existing.mac = existing.mac or mac
        # Refresh the values, keep the visibility the user chose and any
        # property they added by hand.
        existing.properties = merge_omada_properties(
            list(existing.properties or []),
            dev.get("properties", []),
        )
        # A row another source owns keeps its own description: the controller
        # knows a client only as a name and a MAC, so letting it win would
        # retype a Proxmox guest as a plain "computer". On a row Omada created,
        # a re-sync is meant to refresh those.
        if _owns(existing):
            existing.hostname = dev.get("hostname") or existing.hostname
            existing.friendly_name = dev.get("label") or existing.friendly_name
            existing.suggested_type = dev.get("type") or existing.suggested_type
            existing.vendor = dev.get("vendor") or existing.vendor
            existing.model = dev.get("model") or existing.model
        else:
            existing.hostname = existing.hostname or dev.get("hostname")
            existing.friendly_name = existing.friendly_name or dev.get("label")
            existing.suggested_type = existing.suggested_type or dev.get("type")
            existing.vendor = existing.vendor or dev.get("vendor")
            existing.model = existing.model or dev.get("model")
        # Status preserved — an approved device stays approved. Only a hidden
        # device comes back, since the controller still reports it.
        if existing.status == "hidden":
            existing.status = "pending"
        pending_updated += 1

    await db.commit()
    return OmadaImportResponse(
        device_count=len(devices),
        pending_created=pending_created,
        pending_updated=pending_updated,
        infra_count=infra_count,
        client_count=client_count,
    )


async def _background_omada_sync(run_id: str) -> None:
    async with AsyncSessionLocal() as db:
        try:
            devices = await _fetch_configured()
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
            logger.exception("Omada sync %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
