"""FastAPI router for the Unraid import (containers and VMs) + auto-sync config.

Fetches the server, its containers and VMs from the Unraid GraphQL API and upserts
them into the Device Inventory (same review->approve flow as the Proxmox import).

Credentials: the API key comes from the request body when provided, else falls
back to the server-configured env key - only for the configured host and port,
and never with TLS verification off when the server keeps it on. The key is
never persisted by the app and never returned by any endpoint.
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
from app.core.scheduler import reschedule_unraid_sync, set_unraid_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, InventoryDeviceLink, Node, ScanRun
from app.schemas.scan import ScanRunResponse
from app.schemas.unraid import (
    OfflineContainers,
    UnraidConfig,
    UnraidConnectionRequest,
    UnraidEdgeOut,
    UnraidImportPendingResponse,
    UnraidImportResponse,
    UnraidNodeOut,
    UnraidSyncConfig,
    UnraidTestConnectionResponse,
)
from app.services.discovery_sources import add_source
from app.services.inventory_sync import attach_device_ids, merge_services
from app.services.node_dedupe import dedupe_nodes_by_device
from app.services.unraid_service import (
    build_unraid_properties,
    fetch_unraid_inventory,
    merge_unraid_properties,
    test_unraid_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_UNRAID_SOURCE = "unraid"
_UNRAID_IEEE_PREFIX = "unraid-"
# Synthetic ieee prefixes an Unraid import may take over on a row it matched by
# MAC: its own (a renamed container) and UniFi's, which re-finds rows by MAC.
_ADOPTABLE_PREFIXES = (_UNRAID_IEEE_PREFIX, "unifi-")


def _resolve_api_key(payload: UnraidConnectionRequest) -> str:
    """The key from the request, else the env key for the configured endpoint only."""
    if payload.api_key:
        return payload.api_key

    configured_host = settings.unraid_host.strip().rstrip(".").lower()
    request_host = payload.host.strip().rstrip(".").lower()
    if (
        not configured_host
        or request_host != configured_host
        or payload.port != settings.unraid_port
    ):
        raise HTTPException(
            status_code=400,
            detail="Custom Unraid hosts require an explicit API key",
        )
    if settings.unraid_verify_tls and not payload.verify_tls:
        raise HTTPException(
            status_code=400,
            detail="The server-configured Unraid API key requires TLS verification",
        )
    if not settings.unraid_api_key:
        raise HTTPException(
            status_code=400,
            detail="No Unraid API key provided and none configured on the server.",
        )
    return settings.unraid_api_key


def _keep(nodes_raw: list[dict[str, Any]], offline: OfflineContainers, *, canvas: bool) -> list[dict[str, Any]]:
    """Drop stopped containers and VMs the offline policy excludes. The host always stays."""
    if offline == "canvas" or (offline == "inventory" and not canvas):
        return nodes_raw
    return [n for n in nodes_raw if n.get("type") == "docker_host" or n.get("status") == "online"]


def _edges_between(edges_raw: list[dict[str, Any]], nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = {n["id"] for n in nodes}
    return [e for e in edges_raw if e.get("source") in ids and e.get("target") in ids]


@router.post("/test-connection", response_model=UnraidTestConnectionResponse)
async def test_connection_endpoint(
    payload: UnraidConnectionRequest,
    _: str = Depends(get_current_user),
) -> UnraidTestConnectionResponse:
    """Validate host reachability + API key before importing."""
    api_key = _resolve_api_key(payload)
    connected, message = await test_unraid_connection(
        host=payload.host,
        port=payload.port,
        api_key=api_key,
        verify_tls=payload.verify_tls,
    )
    return UnraidTestConnectionResponse(connected=connected, message=message)


@router.post("/import", response_model=UnraidImportResponse)
async def import_unraid(
    payload: UnraidConnectionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> UnraidImportResponse:
    """Fetch the containers and VMs and return nodes + edges ready for canvas drop.

    Everything the offline policy keeps lands in the Device Inventory; with
    ``offline_containers="inventory"`` stopped containers and VMs stop there and
    are left out of the returned canvas payload.
    """
    api_key = _resolve_api_key(payload)
    try:
        nodes_raw, edges_raw, notice = await fetch_unraid_inventory(
            host=payload.host,
            port=payload.port,
            api_key=api_key,
            verify_tls=payload.verify_tls,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Unraid import")
        raise HTTPException(status_code=500, detail="Unexpected error during Unraid import") from exc

    stored = _keep(nodes_raw, payload.offline_containers, canvas=False)
    await _persist_pending_import(db, stored, _edges_between(edges_raw, stored))

    offered = _keep(stored, payload.offline_containers, canvas=True)
    # Stopped devices the policy kept to the inventory: the dialog lists none of
    # them, so it says how many there were rather than look like it lost them.
    offered_ids = {n["id"] for n in offered}
    held = [n for n in stored if n["id"] not in offered_ids]

    drawn = await attach_device_ids(db, offered)
    drawn = await _with_row_lists(db, drawn)
    nodes = [UnraidNodeOut(**n) for n in drawn]
    edges = [UnraidEdgeOut(**e) for e in _edges_between(edges_raw, drawn)]
    return UnraidImportResponse(
        nodes=nodes,
        edges=edges,
        device_count=len(nodes),
        notice=notice,
        inventory_only_containers=sum(1 for n in held if n.get("type") == "docker_container"),
        inventory_only_vms=sum(1 for n in held if n.get("type") == "vm"),
    )


async def _with_row_lists(db: AsyncSession, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Carry each row's services and properties on the node drawing it.

    A freshly dropped node has no baseline to diff against, so its first canvas
    save sends every list as an edit and replaces the row's. Without these the
    save would erase the web UI service and the properties the import just wrote.
    """
    out: list[dict[str, Any]] = []
    for n in nodes:
        row = await db.get(InventoryDevice, n["device_id"]) if n.get("device_id") else None
        if row is None:
            out.append(n)
            continue
        out.append({**n, "services": list(row.services or []), "properties": list(row.properties or [])})
    return out


@router.post("/import-pending", response_model=ScanRunResponse)
async def import_unraid_to_pending(
    payload: UnraidConnectionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Queue an Unraid inventory import as a background scan run (kind=unraid)."""
    api_key = _resolve_api_key(payload)
    run = ScanRun(
        status="running",
        kind="unraid",
        ranges=[f"{payload.host}:{payload.port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_unraid_import,
        run.id,
        payload.host,
        payload.port,
        api_key,
        payload.verify_tls,
        payload.offline_containers != "skip",
    )
    return run


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_unraid_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Trigger an immediate Unraid sync using the server env config."""
    if not (settings.unraid_host and settings.unraid_api_key):
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Unraid host/API key configured on the server.",
        )
    run = ScanRun(
        status="running",
        kind="unraid",
        ranges=[f"{settings.unraid_host}:{settings.unraid_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_unraid_import,
        run.id,
        settings.unraid_host,
        settings.unraid_port,
        settings.unraid_api_key,
        settings.unraid_verify_tls,
        settings.unraid_sync_include_offline,
    )
    return run


async def _background_unraid_import(
    run_id: str,
    host: str,
    port: int,
    api_key: str,
    verify_tls: bool,
    include_offline: bool,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            nodes_raw, edges_raw, notice = await fetch_unraid_inventory(
                host=host,
                port=port,
                api_key=api_key,
                verify_tls=verify_tls,
            )
            stored = _keep(nodes_raw, "inventory" if include_offline else "skip", canvas=False)
            result = await _persist_pending_import(db, stored, _edges_between(edges_raw, stored))
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "done"
                run.devices_found = result.device_count
                run.finished_at = datetime.now(timezone.utc)
                # Non-fatal, like the Proxmox guest-visibility advisory: the run
                # is done, the UI shows it as a warning.
                run.error = notice
                await db.commit()
            from app.api.routes.status import broadcast_scan_update
            await broadcast_scan_update(run_id=run_id, devices_found=result.device_count)
        except Exception as exc:
            logger.exception("Unraid import %s failed", run_id)
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
) -> UnraidImportPendingResponse:
    """Upsert the host, containers and VMs into device_inventory, replace the host's links.

    Update-in-place only: nothing is deleted, hidden rows stay hidden, and a row
    approved earlier but drawn on no canvas any more is revived to pending.
    """
    await dedupe_nodes_by_device(db)

    pending_created = 0
    pending_updated = 0
    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        props = build_unraid_properties(n)
        row = await _find_existing(db, ieee, n.get("ip"), n.get("mac"))
        if row is None:
            db.add(_new_row(ieee, n, props))
            pending_created += 1
            continue
        drawn = (
            await db.execute(select(Node.id).where(Node.device_id == row.id).limit(1))
        ).scalar_one_or_none() is not None
        _refresh_row(row, ieee, n, props)
        if row.status == "approved" and not drawn:
            row.status = "pending"
        pending_updated += 1

    links_recorded = await _replace_links(db, nodes_raw, edges_raw)
    await db.commit()
    return UnraidImportPendingResponse(
        pending_created=pending_created,
        pending_updated=pending_updated,
        links_recorded=links_recorded,
        device_count=len(nodes_raw),
    )


async def _find_existing(
    db: AsyncSession, ieee: str, ip: str | None, mac: str | None
) -> InventoryDevice | None:
    """The inventory row this host/container *is*, in precedence order.

    1. The synthetic ``ieee_address``.
    2. A row holding both the IP and the MAC.
    3. An unclaimed row (no ieee) holding the IP - a device an IP scan found.
    4. A row holding the MAC.

    IP+MAC goes before either alone because an ipvlan container answers ARP
    with the host's MAC: a scan files it as its own IP with the host's MAC, and
    a MAC-only match would merge the host into that container's row.
    Oldest row wins at each step, so a re-import is stable.
    """
    exact = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.ieee_address == ieee))
    ).scalars().first()
    if exact is not None:
        return exact

    candidates: list[list[Any]] = []
    if ip and mac:
        candidates.append([InventoryDevice.ip == ip, InventoryDevice.mac == mac])
    if ip:
        candidates.append([InventoryDevice.ip == ip, InventoryDevice.ieee_address.is_(None)])
    if mac:
        candidates.append([InventoryDevice.mac == mac])
    for where in candidates:
        row = (
            await db.execute(
                select(InventoryDevice)
                .where(*where)
                .order_by(InventoryDevice.discovered_at, InventoryDevice.id)
            )
        ).scalars().first()
        if row is not None:
            return row
    return None


def _new_row(ieee: str, n: dict[str, Any], props: list[dict[str, Any]]) -> InventoryDevice:
    return InventoryDevice(
        ieee_address=ieee,
        ip=n.get("ip"),
        mac=n.get("mac"),
        hostname=n.get("hostname"),
        friendly_name=n.get("label"),
        suggested_type=n.get("type"),
        vendor=n.get("vendor"),
        model=n.get("model"),
        os=n.get("os_version"),
        cpu_count=n.get("cpu_count"),
        cpu_model=n.get("cpu_model"),
        services=list(n.get("services") or []),
        properties=props,
        status="pending",
        discovery_source=_UNRAID_SOURCE,
        discovery_sources=[_UNRAID_SOURCE],
    )


def _refresh_row(row: InventoryDevice, ieee: str, n: dict[str, Any], props: list[dict[str, Any]]) -> None:
    row.discovery_sources = add_source(
        add_source(row.discovery_sources, row.discovery_source), _UNRAID_SOURCE
    )
    if not row.ieee_address or row.ieee_address.startswith(_ADOPTABLE_PREFIXES):
        row.ieee_address = ieee
    row.ip = n.get("ip") or row.ip
    row.mac = row.mac or n.get("mac")
    row.hostname = n.get("hostname") or row.hostname
    row.friendly_name = n.get("label") or row.friendly_name
    row.suggested_type = n.get("type") or row.suggested_type
    row.vendor = n.get("vendor") or row.vendor
    row.model = n.get("model") or row.model
    row.os = n.get("os_version") or row.os
    row.cpu_count = row.cpu_count or n.get("cpu_count")
    row.cpu_model = row.cpu_model or n.get("cpu_model")
    row.properties = merge_unraid_properties(list(row.properties or []), props)
    # discovered=True: refresh the address, keep a name or icon the user set.
    row.services = merge_services(row.services, n.get("services"), discovered=True)


async def _replace_links(
    db: AsyncSession,
    nodes_raw: list[dict[str, Any]],
    edges_raw: list[dict[str, Any]],
) -> int:
    """Replace this host's host->container links with the fresh set.

    Scoped to the imported host so a second Unraid server keeps its own links.
    """
    hosts = [n["ieee_address"] for n in nodes_raw if n.get("type") == "docker_host"]
    if hosts:
        await db.execute(
            sa_delete(InventoryDeviceLink).where(
                InventoryDeviceLink.discovery_source == _UNRAID_SOURCE,
                InventoryDeviceLink.source_ieee.in_(hosts),
            )
        )
    recorded = 0
    seen: set[tuple[str, str]] = set()
    for e in edges_raw:
        src, tgt = e.get("source"), e.get("target")
        if not src or not tgt or (src, tgt) in seen:
            continue
        seen.add((src, tgt))
        db.add(InventoryDeviceLink(source_ieee=src, target_ieee=tgt, discovery_source=_UNRAID_SOURCE))
        recorded += 1
    return recorded


@router.get("/config", response_model=UnraidConfig)
async def get_unraid_config(_: str = Depends(get_current_user)) -> UnraidConfig:
    """Return non-secret Unraid config. Never includes the API key."""
    return UnraidConfig(
        host=settings.unraid_host,
        port=settings.unraid_port,
        verify_tls=settings.unraid_verify_tls,
        sync_enabled=settings.unraid_sync_enabled,
        sync_interval=settings.unraid_sync_interval,
        include_offline=settings.unraid_sync_include_offline,
        api_key_configured=bool(settings.unraid_api_key),
    )


@router.post("/config", response_model=UnraidConfig)
async def save_unraid_config(
    payload: UnraidSyncConfig,
    _: str = Depends(get_current_user),
) -> UnraidConfig:
    """Persist the auto-sync activation and apply it live.

    Connection settings (host, port, API key, verify_tls) are env-only and are
    never accepted or persisted here.
    """
    if payload.sync_enabled and not (settings.unraid_host and settings.unraid_api_key):
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Unraid host/API key configured in the server env.",
        )
    try:
        settings.unraid_sync_enabled = payload.sync_enabled
        settings.unraid_sync_interval = payload.sync_interval
        settings.unraid_sync_include_offline = payload.include_offline
        settings.save_overrides()
        set_unraid_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_unraid_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_unraid_config()
