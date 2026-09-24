"""FastAPI router for XCP-ng XAPI import + auto-sync config.

Fetches hosts/VMs from the XAPI XML-RPC interface and upserts them into the
pending inventory (same review→approve flow as Proxmox / scans).

Credentials: from the request body when provided, else from server env
(XCPNG_USERNAME / XCPNG_PASSWORD). Never persisted, never returned.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_xcpng_sync, set_xcpng_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, InventoryDeviceLink, Node, ScanRun
from app.schemas.scan import ScanRunResponse
from app.schemas.xcpng import (
    XcpngConfig,
    XcpngConnectionRequest,
    XcpngEdgeOut,
    XcpngImportPendingResponse,
    XcpngImportResponse,
    XcpngNodeOut,
    XcpngSyncConfig,
    XcpngTestConnectionResponse,
)
from app.services.discovery_sources import add_source
from app.services.inventory_sync import attach_device_ids
from app.services.mac_utils import normalize_mac
from app.services.node_dedupe import dedupe_nodes_by_device
from app.services.xcpng_service import (
    build_xcpng_properties,
    fetch_xcpng_inventory,
    merge_xcpng_properties,
    test_xcpng_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_XCPNG_SOURCE = "xcpng"
_XCPNG_VIRTUAL_SOURCE = "xcpng_virtual"


def _resolve_credentials(payload: XcpngConnectionRequest) -> tuple[str, str]:
    username = payload.username or settings.xcpng_username
    password = payload.password or settings.xcpng_password
    if not username or not password:
        raise HTTPException(
            status_code=400,
            detail="No XCP-ng credentials provided and none configured on the server.",
        )
    return username, password


@router.post("/test-connection", response_model=XcpngTestConnectionResponse)
async def test_connection_endpoint(
    payload: XcpngConnectionRequest,
    _: str = Depends(get_current_user),
) -> XcpngTestConnectionResponse:
    username, password = _resolve_credentials(payload)
    connected, message = await test_xcpng_connection(
        host=payload.host,
        username=username,
        password=password,
        verify_tls=payload.verify_tls,
    )
    return XcpngTestConnectionResponse(connected=connected, message=message)


@router.post("/import", response_model=XcpngImportResponse)
async def import_xcpng(
    payload: XcpngConnectionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> XcpngImportResponse:
    username, password = _resolve_credentials(payload)
    try:
        nodes_raw, edges_raw = await fetch_xcpng_inventory(
            host=payload.host,
            username=username,
            password=password,
            verify_tls=payload.verify_tls,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during XCP-ng import")
        raise HTTPException(status_code=500, detail="Unexpected error during XCP-ng import") from exc

    await _persist_pending_import(db, nodes_raw, edges_raw)
    nodes_raw = await attach_device_ids(db, nodes_raw)

    nodes = [XcpngNodeOut(**n) for n in nodes_raw]
    edges = [XcpngEdgeOut(**e) for e in edges_raw]
    return XcpngImportResponse(nodes=nodes, edges=edges, device_count=len(nodes))


@router.post("/import-pending", response_model=ScanRunResponse)
async def import_xcpng_to_pending(
    payload: XcpngConnectionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    username, password = _resolve_credentials(payload)
    run = ScanRun(status="running", kind="xcpng", ranges=[payload.host])
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_xcpng_import,
        run.id,
        payload.host,
        username,
        password,
        payload.verify_tls,
    )
    return run


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_xcpng_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    if not (settings.xcpng_host and settings.xcpng_username and settings.xcpng_password):
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no XCP-ng host/credentials configured on the server.",
        )
    run = ScanRun(status="running", kind="xcpng", ranges=[settings.xcpng_host])
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_xcpng_import,
        run.id,
        settings.xcpng_host,
        settings.xcpng_username,
        settings.xcpng_password,
        settings.xcpng_verify_tls,
    )
    return run


async def _background_xcpng_import(
    run_id: str,
    host: str,
    username: str,
    password: str,
    verify_tls: bool,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            nodes_raw, edges_raw = await fetch_xcpng_inventory(
                host=host,
                username=username,
                password=password,
                verify_tls=verify_tls,
            )
            result = await _persist_pending_import(db, nodes_raw, edges_raw)
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "done"
                run.devices_found = result.device_count
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
            from app.api.routes.status import broadcast_scan_update
            await broadcast_scan_update(run_id=run_id, devices_found=result.device_count)
        except Exception as exc:
            logger.exception("XCP-ng import %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()


async def _persist_pending_import(
    db: AsyncSession,
    nodes_raw: list[dict[str, Any]],
    edges_raw: list[dict[str, Any]],
) -> XcpngImportPendingResponse:
    await dedupe_nodes_by_device(db)

    pending_created = 0
    pending_updated = 0

    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        ip = n.get("ip")
        mac = normalize_mac(n.get("mac"))
        props = build_xcpng_properties(n)

        pending = await _find_pending(db, ieee, ip, mac)
        drawn = bool(
            pending
            and (
                await db.execute(select(Node.id).where(Node.device_id == pending.id).limit(1))
            ).scalar_one_or_none()
        )

        if pending is None:
            db.add(_new_pending(ieee, ip, mac, n, props, status="pending"))
            pending_created += 1
        else:
            if drawn:
                await _ensure_inventory_row(db, ieee, ip, mac, n, props, approved=True)
            else:
                _refresh_pending(pending, ieee, ip, mac, n, props)
            pending.cpu_count = pending.cpu_count or n.get("cpu_count")
            pending.ram_gb = pending.ram_gb or n.get("ram_gb")
            pending_updated += 1

    links_recorded = await _replace_links(db, edges_raw)
    await db.commit()

    return XcpngImportPendingResponse(
        pending_created=pending_created,
        pending_updated=pending_updated,
        links_recorded=links_recorded,
        device_count=len(nodes_raw),
    )


async def _find_pending(
    db: AsyncSession, ieee: str, ip: str | None, mac: str | None
) -> InventoryDevice | None:
    # Primary match: stable XO UUID (ieee_address). Never fall back to IP
    # alone — DHCP reassignment would silently overwrite an unrelated device.
    row = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
    ).scalars().first()
    if row is not None:
        return row
    # Secondary: MAC match, only when no ieee_address is set on the candidate
    # (avoids merging into a scanner-discovered device that happens to share a MAC).
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


def _new_pending(
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
    status: str,
) -> InventoryDevice:
    return InventoryDevice(
        ieee_address=ieee,
        ip=ip,
        mac=mac,
        hostname=n.get("hostname"),
        friendly_name=n.get("label"),
        suggested_type=n.get("type"),
        vendor=n.get("vendor"),
        model=n.get("model"),
        properties=props,
        cpu_count=n.get("cpu_count"),
        ram_gb=n.get("ram_gb"),
        status=status,
        discovery_source=_XCPNG_SOURCE,
        discovery_sources=[_XCPNG_SOURCE],
    )


def _sources_after_merge(row: InventoryDevice) -> list[str]:
    sources = add_source(row.discovery_sources, row.discovery_source)
    was_scanned = not (row.ieee_address or "").startswith("xcpng-")
    if was_scanned and row.ip and not any(s in ("arp", "mdns") for s in sources):
        sources = add_source(sources, "arp")
    return add_source(sources, _XCPNG_SOURCE)


def _refresh_pending(
    pending: InventoryDevice,
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
) -> None:
    pending.discovery_sources = _sources_after_merge(pending)
    pending.ieee_address = pending.ieee_address or ieee
    pending.ip = ip or pending.ip
    pending.mac = pending.mac or mac
    pending.hostname = n.get("hostname") or pending.hostname
    pending.friendly_name = n.get("label") or pending.friendly_name
    pending.suggested_type = n.get("type") or pending.suggested_type
    pending.vendor = n.get("vendor") or pending.vendor
    pending.model = n.get("model") or pending.model
    pending.properties = merge_xcpng_properties(list(pending.properties or []), props)


async def _ensure_inventory_row(
    db: AsyncSession,
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
    approved: bool,
) -> None:
    inv = await _find_pending(db, ieee, ip, mac)
    if inv is None:
        db.add(_new_pending(ieee, ip, mac, n, props, status="approved" if approved else "pending"))
    else:
        inv.discovery_sources = _sources_after_merge(inv)
        inv.ieee_address = inv.ieee_address or ieee
        inv.ip = ip or inv.ip
        inv.mac = inv.mac or mac
        inv.hostname = n.get("hostname") or inv.hostname
        inv.suggested_type = n.get("type") or inv.suggested_type
        inv.properties = merge_xcpng_properties(list(inv.properties or []), props)


async def _replace_links(
    db: AsyncSession,
    edges_raw: list[dict[str, Any]],
) -> int:
    await db.execute(
        sa_delete(InventoryDeviceLink).where(
            InventoryDeviceLink.discovery_source.in_([_XCPNG_SOURCE, _XCPNG_VIRTUAL_SOURCE])
        )
    )
    recorded = 0
    seen: set[tuple[str, str]] = set()

    for e in edges_raw:
        src = e.get("source")
        tgt = e.get("target")
        if not src or not tgt or (src, tgt) in seen:
            continue
        seen.add((src, tgt))
        db.add(InventoryDeviceLink(source_ieee=src, target_ieee=tgt, discovery_source=_XCPNG_VIRTUAL_SOURCE))
        recorded += 1

    return recorded


@router.get("/config", response_model=XcpngConfig)
async def get_xcpng_config(_: str = Depends(get_current_user)) -> XcpngConfig:
    return XcpngConfig(
        host=settings.xcpng_host,
        verify_tls=settings.xcpng_verify_tls,
        sync_enabled=settings.xcpng_sync_enabled,
        sync_interval=settings.xcpng_sync_interval,
        credentials_configured=bool(settings.xcpng_username and settings.xcpng_password),
    )


@router.post("/config", response_model=XcpngConfig)
async def save_xcpng_config(
    payload: XcpngSyncConfig,
    _: str = Depends(get_current_user),
) -> XcpngConfig:
    if payload.sync_enabled and not (
        settings.xcpng_host and settings.xcpng_username and settings.xcpng_password
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot enable auto-sync: XCPNG_HOST, XCPNG_USERNAME, and XCPNG_PASSWORD"
                " must be set in the server env."
            ),
        )
    try:
        settings.xcpng_sync_enabled = payload.sync_enabled
        settings.xcpng_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_xcpng_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_xcpng_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_xcpng_config()
