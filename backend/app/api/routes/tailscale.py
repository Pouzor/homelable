"""FastAPI router for the Tailscale import + auto-sync config.

Reads the tailnet's devices from the Tailscale API and upserts them into the
Device Inventory as pending, to approve onto a canvas like any other discovery.

Credentials: taken from the request when provided, else from the server env.
They are never persisted by the app and never returned by any endpoint.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_tailscale_sync, set_tailscale_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, Node, ScanRun
from app.schemas.tailscale import (
    TailscaleConfig,
    TailscaleConnectionRequest,
    TailscaleImportResponse,
    TailscaleSyncConfig,
    TailscaleTestConnectionResponse,
)
from app.services.discovery_sources import add_source
from app.services.inventory_sync import ip_tokens
from app.services.node_dedupe import dedupe_nodes_by_device
from app.services.tailscale_service import (
    IEEE_PREFIX,
    SOURCE,
    TAILNET_IP_KEY,
    fetch_tailscale_inventory,
    merge_tailscale_properties,
    test_tailscale_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@dataclass(frozen=True)
class _Credentials:
    api_key: str | None
    client_id: str | None
    client_secret: str | None


def _resolve_credentials(payload: TailscaleConnectionRequest) -> _Credentials:
    """The credential from the request, else the one configured in the server env."""
    if payload.api_key:
        return _Credentials(payload.api_key, None, None)
    if payload.oauth_client_id or payload.oauth_client_secret:
        if not (payload.oauth_client_id and payload.oauth_client_secret):
            raise HTTPException(
                status_code=400,
                detail="An OAuth client needs both the client id and the client secret.",
            )
        return _Credentials(None, payload.oauth_client_id, payload.oauth_client_secret)
    if not settings.tailscale_credentials_configured:
        raise HTTPException(
            status_code=400,
            detail="No Tailscale credential provided and none configured on the server.",
        )
    return _env_credentials()


def _env_credentials() -> _Credentials:
    if settings.tailscale_api_key:
        return _Credentials(settings.tailscale_api_key, None, None)
    return _Credentials(None, settings.tailscale_oauth_client_id, settings.tailscale_oauth_client_secret)


def _tailnet(payload: TailscaleConnectionRequest | None = None) -> str:
    requested = (payload.tailnet or "").strip() if payload else ""
    return requested or settings.tailscale_tailnet.strip() or "-"


@router.post("/test-connection", response_model=TailscaleTestConnectionResponse)
async def test_connection_endpoint(
    payload: TailscaleConnectionRequest,
    _: str = Depends(get_current_user),
) -> TailscaleTestConnectionResponse:
    creds = _resolve_credentials(payload)
    connected, message, count = await test_tailscale_connection(
        api_key=creds.api_key,
        client_id=creds.client_id,
        client_secret=creds.client_secret,
        tailnet=_tailnet(payload),
        include_shared=payload.include_shared,
        tags=payload.tags,
    )
    return TailscaleTestConnectionResponse(connected=connected, message=message, device_count=count)


async def _record_run(
    db: AsyncSession,
    tailnet: str,
    started_at: datetime,
    *,
    status: str,
    devices_found: int = 0,
    error: str | None = None,
) -> str:
    """Log a manual import in Scan History, written once and already terminal.

    The manual import runs inline (the API answers in about a second), so there
    is no ``running`` row for a background job to finish later.
    """
    run = ScanRun(
        status=status,
        kind="tailscale",
        ranges=[f"tailnet:{tailnet}"],
        devices_found=devices_found,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc),
        error=error,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run.id


@router.post("/import-pending", response_model=TailscaleImportResponse)
async def import_tailscale_pending(
    payload: TailscaleConnectionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> TailscaleImportResponse:
    """Fetch the tailnet's devices and upsert them into the pending inventory."""
    creds = _resolve_credentials(payload)
    tailnet = _tailnet(payload)
    started_at = datetime.now(timezone.utc)
    try:
        devices = await fetch_tailscale_inventory(
            api_key=creds.api_key,
            client_id=creds.client_id,
            client_secret=creds.client_secret,
            tailnet=tailnet,
            include_shared=payload.include_shared,
            tags=payload.tags,
        )
    except ConnectionError as exc:
        await _record_run(db, tailnet, started_at, status="error", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Tailscale import")
        await _record_run(db, tailnet, started_at, status="error", error="Unexpected error during Tailscale import")
        raise HTTPException(status_code=500, detail="Unexpected error during Tailscale import") from exc

    result = await _persist_devices(db, devices)
    await _record_run(db, tailnet, started_at, status="done", devices_found=result.device_count)
    return result


@router.post("/sync-now", response_model=TailscaleImportResponse)
async def sync_tailscale_now(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> TailscaleImportResponse:
    """Run the import now with the server env credential and the saved filters."""
    if not settings.tailscale_credentials_configured:
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Tailscale credential configured on the server.",
        )
    tailnet = _tailnet()
    started_at = datetime.now(timezone.utc)
    try:
        devices = await _fetch_with_env()
    except Exception as exc:
        await _record_run(db, tailnet, started_at, status="error", error=str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    result = await _persist_devices(db, devices)
    await _record_run(db, tailnet, started_at, status="done", devices_found=result.device_count)
    return result


async def _fetch_with_env() -> list[dict[str, Any]]:
    creds = _env_credentials()
    return await fetch_tailscale_inventory(
        api_key=creds.api_key,
        client_id=creds.client_id,
        client_secret=creds.client_secret,
        tailnet=_tailnet(),
        include_shared=settings.tailscale_include_shared,
        tags=settings.tailscale_tag_filter,
    )


@router.get("/config", response_model=TailscaleConfig)
async def get_tailscale_config(_: str = Depends(get_current_user)) -> TailscaleConfig:
    """Return the non-secret config. Never includes a credential."""
    return TailscaleConfig(
        tailnet=_tailnet(),
        sync_enabled=settings.tailscale_sync_enabled,
        sync_interval=settings.tailscale_sync_interval,
        include_shared=settings.tailscale_include_shared,
        tags=list(settings.tailscale_tag_filter),
        credentials_configured=settings.tailscale_credentials_configured,
    )


@router.post("/config", response_model=TailscaleConfig)
async def save_tailscale_config(
    payload: TailscaleSyncConfig,
    _: str = Depends(get_current_user),
) -> TailscaleConfig:
    """Persist the auto-sync activation and filters, and apply them live.

    Credentials and the tailnet are env-only and never accepted here.
    """
    if payload.sync_enabled and not settings.tailscale_credentials_configured:
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Tailscale credential configured in the server env.",
        )
    try:
        settings.tailscale_sync_enabled = payload.sync_enabled
        settings.tailscale_sync_interval = payload.sync_interval
        settings.tailscale_include_shared = payload.include_shared
        settings.tailscale_tag_filter = list(payload.tags)
        settings.save_overrides()
        set_tailscale_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_tailscale_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_tailscale_config()


async def _find_existing(db: AsyncSession, ieee: str, ip: str | None) -> InventoryDevice | None:
    """The inventory row this tailnet device *is*, in precedence order.

    1. The synthetic ``tailscale-{nodeId}`` ieee, for a row an earlier import
       created or a row the user merged a Tailscale device into.
    2. A row already holding the tailnet IPv4 among its addresses, unless that
       row belongs to another Tailscale node. A 100.x address is unique within
       a tailnet, so this finds a device the user merged by hand whose kept
       ieee is another platform's (``pve-…``, ``unraid-…``), instead of minting
       the duplicate again on every sync. A row keyed to another Tailscale
       node is left alone: Tailscale can hand a deleted node's address to a
       new one.

    No MAC (Tailscale reports none) and no hostname (same-name hosts would
    merge unrelated machines). Oldest row wins, so a re-import is stable.
    """
    exact = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
    ).scalars().first()
    if exact is not None:
        return exact
    if not ip:
        return None
    rows = (
        await db.execute(
            select(InventoryDevice)
            .where(InventoryDevice.ip.contains(ip))
            .order_by(InventoryDevice.discovered_at, InventoryDevice.id)
        )
    ).scalars().all()
    for row in rows:
        if ip not in ip_tokens(row.ip):
            continue
        if row.ieee_address and row.ieee_address.startswith(IEEE_PREFIX):
            continue
        return row
    return None


def _owns(row: InventoryDevice) -> bool:
    """True when Tailscale is the only source that has ever seen this row."""
    sources = {s for s in (row.discovery_sources or []) if s}
    return bool(sources) and sources <= {SOURCE}


def _previous_tailnet_ip(row: InventoryDevice) -> str | None:
    for prop in row.properties or []:
        if isinstance(prop, dict) and prop.get("key") == TAILNET_IP_KEY:
            value = prop.get("value")
            return str(value) if value else None
    return None


def _with_tailnet_ip(row: InventoryDevice, ip: str | None) -> str | None:
    """The row's address list with the tailnet IPv4 in it, the old one dropped.

    A merged row keeps its LAN address first, so the status checker (which
    probes the first address) keeps probing the LAN.
    """
    if not ip:
        return row.ip
    previous = _previous_tailnet_ip(row)
    tokens = [t for t in ip_tokens(row.ip) if t != previous or t == ip]
    if ip not in tokens:
        tokens.append(ip)
    return ", ".join(tokens) or None


def _new_row(dev: dict[str, Any]) -> InventoryDevice:
    return InventoryDevice(
        ieee_address=dev["ieee_address"],
        ip=dev.get("ip"),
        hostname=dev.get("hostname"),
        friendly_name=dev.get("label"),
        suggested_type=dev.get("type"),
        os=dev.get("os"),
        properties=list(dev.get("properties") or []),
        status="pending",
        discovery_source=SOURCE,
        discovery_sources=[SOURCE],
    )


def _refresh_row(row: InventoryDevice, dev: dict[str, Any]) -> None:
    owned = _owns(row)
    row.discovery_sources = add_source(add_source(row.discovery_sources, row.discovery_source), SOURCE)
    if not row.ieee_address or row.ieee_address.startswith(IEEE_PREFIX):
        row.ieee_address = dev["ieee_address"]
    # Before the properties are refreshed: the old tailnet address is read
    # from them.
    row.ip = _with_tailnet_ip(row, dev.get("ip"))
    row.properties = merge_tailscale_properties(list(row.properties or []), list(dev.get("properties") or []))
    if owned:
        # A row only Tailscale has seen: a re-sync refreshes its description.
        row.hostname = dev.get("hostname") or row.hostname
        row.friendly_name = dev.get("label") or row.friendly_name
        row.suggested_type = dev.get("type") or row.suggested_type
        row.os = dev.get("os") or row.os
    else:
        # Another source knows this machine better (a scan's hostname, a
        # Proxmox guest's type): Tailscale only fills what is missing.
        row.hostname = row.hostname or dev.get("hostname")
        row.friendly_name = row.friendly_name or dev.get("label")
        row.suggested_type = row.suggested_type or dev.get("type")
        row.os = row.os or dev.get("os")


async def _persist_devices(db: AsyncSession, devices: list[dict[str, Any]]) -> TailscaleImportResponse:
    """Upsert the devices into device_inventory.

    Update-in-place only: nothing is deleted, hidden rows stay hidden, and a row
    approved earlier but drawn on no canvas any more is revived to pending.
    """
    await dedupe_nodes_by_device(db)

    pending_created = 0
    pending_updated = 0
    online_count = 0
    for dev in devices:
        ieee = dev.get("ieee_address")
        if not ieee:
            continue
        if dev.get("online"):
            online_count += 1
        row = await _find_existing(db, ieee, dev.get("ip"))
        if row is None:
            db.add(_new_row(dev))
            # Flushed so a later device in the same batch sees this row.
            await db.flush()
            pending_created += 1
            continue
        drawn = (
            await db.execute(select(Node.id).where(Node.device_id == row.id).limit(1))
        ).scalar_one_or_none() is not None
        _refresh_row(row, dev)
        if row.status == "approved" and not drawn:
            row.status = "pending"
        pending_updated += 1

    await db.commit()
    return TailscaleImportResponse(
        device_count=len(devices),
        pending_created=pending_created,
        pending_updated=pending_updated,
        online_count=online_count,
    )


async def _background_tailscale_sync(run_id: str) -> None:
    """The scheduled sync: fetch, persist, and close the ``running`` scan run."""
    async with AsyncSessionLocal() as db:
        try:
            devices = await _fetch_with_env()
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
            logger.exception("Tailscale sync %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
