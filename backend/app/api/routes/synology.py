"""FastAPI router for Synology DSM import + auto-sync config.

Fetches the NAS from the DSM Web API and upserts it into the pending inventory
(same review→approve flow as scans and Proxmox imports).

Credentials: username/password come from the request body when provided, else
falls back to the server-configured env pair (``settings.synology_*``). Secrets
are never persisted by the app and never returned by any endpoint.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_synology_sync, set_synology_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, InventoryDeviceLink, Node, ScanRun
from app.schemas.scan import ScanRunResponse
from app.schemas.synology import (
    SynologyConfig,
    SynologyConnectionRequest,
    SynologyEdgeOut,
    SynologyImportPendingResponse,
    SynologyImportResponse,
    SynologyNodeOut,
    SynologySyncConfig,
    SynologyTestConnectionResponse,
)
from app.services.discovery_sources import add_source
from app.services.mac_utils import normalize_mac
from app.services.node_dedupe import dedupe_nodes_by_device
from app.services.synology_service import (
    build_synology_container_properties,
    build_synology_guest_edges,
    build_synology_properties,
    fetch_synology_inventory,
    merge_synology_properties,
    test_synology_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_SYNOLOGY_SOURCE = "synology"


def _resolve_credentials(payload: SynologyConnectionRequest) -> tuple[str, str]:
    """Pick username/password: request body first, else server env config.

    Raises HTTP 400 when neither carries a complete pair.
    """
    username = payload.username or settings.synology_username
    password = payload.password or settings.synology_password
    if not username or not password:
        raise HTTPException(
            status_code=400,
            detail="No Synology credentials provided and none configured on the server.",
        )
    return username, password


@router.post("/test-connection", response_model=SynologyTestConnectionResponse)
async def test_connection_endpoint(
    payload: SynologyConnectionRequest,
    _: str = Depends(get_current_user),
) -> SynologyTestConnectionResponse:
    """Validate host reachability + credentials before importing."""
    username, password = _resolve_credentials(payload)
    connected, message = await test_synology_connection(
        host=payload.host,
        port=payload.port,
        username=username,
        password=password,
        verify_tls=payload.verify_tls,
        otp_code=payload.otp_code,
    )
    return SynologyTestConnectionResponse(connected=connected, message=message)


@router.post("/import", response_model=SynologyImportResponse)
async def import_synology(
    payload: SynologyConnectionRequest,
    _: str = Depends(get_current_user),
) -> SynologyImportResponse:
    """Fetch the NAS and containers and return nodes + edges ready for canvas drop."""
    username, password = _resolve_credentials(payload)
    try:
        nodes_raw = await fetch_synology_inventory(
            host=payload.host,
            port=payload.port,
            username=username,
            password=password,
            verify_tls=payload.verify_tls,
            otp_code=payload.otp_code,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Synology import")
        raise HTTPException(status_code=500, detail="Unexpected error during Synology import") from exc

    nodes = [SynologyNodeOut.model_validate(n) for n in nodes_raw]
    edges = [SynologyEdgeOut.model_validate(e) for e in build_synology_guest_edges(nodes_raw)]
    return SynologyImportResponse(nodes=nodes, edges=edges, device_count=len(nodes))


@router.post("/import-pending", response_model=ScanRunResponse)
async def import_synology_to_pending(
    payload: SynologyConnectionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Queue a Synology pending import as a background scan run (kind=synology)."""
    username, password = _resolve_credentials(payload)
    run = ScanRun(
        status="running",
        kind="synology",
        ranges=[f"{payload.host}:{payload.port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_synology_import,
        run.id,
        payload.host,
        payload.port,
        username,
        password,
        payload.verify_tls,
        payload.otp_code,
    )
    return run


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_synology_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Trigger an immediate Synology inventory sync using the server env config.

    Same background flow as ``/import-pending`` but sources host + credentials
    from ``settings`` (env) rather than the request body. Requires the env
    credentials to be configured. OTP is not supported here — auto-sync needs
    a DSM user without 2FA.
    """
    if not (settings.synology_host and settings.synology_username and settings.synology_password):
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Synology host/credentials configured on the server.",
        )
    run = ScanRun(
        status="running",
        kind="synology",
        ranges=[f"{settings.synology_host}:{settings.synology_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_synology_import,
        run.id,
        settings.synology_host,
        settings.synology_port,
        settings.synology_username,
        settings.synology_password,
        settings.synology_verify_tls,
        None,
    )
    return run


async def _background_synology_import(
    run_id: str,
    host: str,
    port: int,
    username: str,
    password: str,
    verify_tls: bool,
    otp_code: str | None,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            nodes_raw = await fetch_synology_inventory(
                host=host,
                port=port,
                username=username,
                password=password,
                verify_tls=verify_tls,
                otp_code=otp_code,
            )
            result = await _persist_pending_import(db, nodes_raw)
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "done"
                run.devices_found = result.device_count
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
            from app.api.routes.status import broadcast_scan_update
            await broadcast_scan_update(run_id=run_id, devices_found=result.device_count)
        except Exception as exc:
            logger.exception("Synology import %s failed", run_id)
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
) -> SynologyImportPendingResponse:
    """Upsert Synology nodes into device_inventory.

    Two-tier identity for the NAS (order matters):
      1. Match an existing canvas Node or pending row by **IP** or **MAC**
         (merge into a device previously found by a scan) — never duplicate.
      2. Else match by synthetic ``ieee_address`` (``syno-...``).

    Docker containers match by ieee only so a host-network container is never
    merged into the NAS. Update-in-place only. Nothing is ever deleted.
    """
    await dedupe_nodes_by_device(db)

    pending_created = 0
    pending_updated = 0

    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        is_container = n.get("type") == "docker_container"
        ip = None if is_container else n.get("ip")
        mac = None if is_container else normalize_mac(n.get("mac"))
        props = (
            build_synology_container_properties(n)
            if is_container
            else build_synology_properties(n)
        )

        pending = await _find_pending(db, ieee, ip, mac, ieee_only=is_container)
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
            pending.ram_gb = pending.ram_gb or n.get("ram_gb")
            pending.disk_gb = pending.disk_gb or n.get("disk_gb")
            pending_updated += 1

    links_recorded = await _replace_guest_links(db, build_synology_guest_edges(nodes_raw))
    await db.commit()
    return SynologyImportPendingResponse(
        pending_created=pending_created,
        pending_updated=pending_updated,
        device_count=len(nodes_raw),
        links_recorded=links_recorded,
    )


async def _find_pending(
    db: AsyncSession,
    ieee: str,
    ip: str | None,
    mac: str | None,
    ieee_only: bool = False,
) -> InventoryDevice | None:
    if ieee_only:
        return (
            await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
        ).scalars().first()
    filters = [InventoryDevice.ieee_address == ieee]
    if ip:
        filters.append(InventoryDevice.ip == ip)
    if mac:
        filters.append(InventoryDevice.mac == mac)
    return (
        await db.execute(select(InventoryDevice).where(or_(*filters)))
    ).scalars().first()


async def _replace_guest_links(
    db: AsyncSession, edges_raw: list[dict[str, Any]]
) -> int:
    """Wipe NAS→container links and re-insert the freshly discovered set."""
    await db.execute(
        sa_delete(InventoryDeviceLink).where(InventoryDeviceLink.discovery_source == _SYNOLOGY_SOURCE)
    )
    recorded = 0
    seen: set[tuple[str, str]] = set()
    for edge in edges_raw:
        src = edge.get("source")
        tgt = edge.get("target")
        if not src or not tgt or (src, tgt) in seen:
            continue
        seen.add((src, tgt))
        db.add(InventoryDeviceLink(source_ieee=src, target_ieee=tgt, discovery_source=_SYNOLOGY_SOURCE))
        recorded += 1
    return recorded


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
        ram_gb=n.get("ram_gb"),
        disk_gb=n.get("disk_gb"),
        check_method=n.get("check_method") if n.get("type") != "docker_container" else None,
        check_target=n.get("check_target") if n.get("type") != "docker_container" else None,
        status=status,
        discovery_source=_SYNOLOGY_SOURCE,
        discovery_sources=[_SYNOLOGY_SOURCE],
    )


def _sources_after_merge(row: InventoryDevice) -> list[str]:
    """Discovery sources after a Synology import merges in.

    Must run BEFORE the ``syno-`` ieee is adopted onto the row, so it can tell
    whether the row was originally a scanned device. A row that carries an IP
    but was not itself a Synology device (no ``syno-`` ieee) was found by a
    scan; keep an IP-scan source.
    """
    sources = add_source(row.discovery_sources, row.discovery_source)
    was_scanned = not (row.ieee_address or "").startswith("syno-")
    if was_scanned and row.ip and not any(s in ("arp", "mdns") for s in sources):
        sources = add_source(sources, "arp")
    return add_source(sources, _SYNOLOGY_SOURCE)


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
    pending.properties = merge_synology_properties(list(pending.properties or []), props)
    if not pending.check_method and n.get("check_method"):
        pending.check_method = n.get("check_method")
        pending.check_target = n.get("check_target")
    if pending.status == "approved":
        pending.status = "pending"
    # hidden stays hidden.


async def _ensure_inventory_row(
    db: AsyncSession,
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
    approved: bool,
) -> None:
    """Ensure an inventory row exists for a device already on a canvas.

    Never changes status.
    """
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
        inv.vendor = n.get("vendor") or inv.vendor
        inv.model = n.get("model") or inv.model
        inv.properties = merge_synology_properties(list(inv.properties or []), props)
        if not inv.check_method and n.get("check_method"):
            inv.check_method = n.get("check_method")
            inv.check_target = n.get("check_target")


@router.get("/config", response_model=SynologyConfig)
async def get_synology_config(_: str = Depends(get_current_user)) -> SynologyConfig:
    """Return non-secret Synology config. Never includes the password — only
    whether credentials are configured on the server."""
    return SynologyConfig(
        host=settings.synology_host,
        port=settings.synology_port,
        verify_tls=settings.synology_verify_tls,
        sync_enabled=settings.synology_sync_enabled,
        sync_interval=settings.synology_sync_interval,
        credentials_configured=bool(settings.synology_username and settings.synology_password),
    )


@router.post("/config", response_model=SynologyConfig)
async def save_synology_config(
    payload: SynologySyncConfig,
    _: str = Depends(get_current_user),
) -> SynologyConfig:
    """Persist the auto-sync activation (enabled + interval) and apply it live.

    This is the ONLY Synology config the app writes. Connection settings
    (host, port, username, password, verify_tls) are env-only and are never
    accepted or persisted here.
    """
    if payload.sync_enabled and not (
        settings.synology_host and settings.synology_username and settings.synology_password
    ):
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Synology host/credentials configured in the server env.",
        )
    try:
        settings.synology_sync_enabled = payload.sync_enabled
        settings.synology_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_synology_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_synology_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_synology_config()
