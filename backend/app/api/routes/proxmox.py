"""FastAPI router for Proxmox VE import + auto-sync config.

Fetches hosts/VMs/LXC from the Proxmox REST API and upserts them into the
pending inventory (same review→approve flow as scans and mesh imports).

Credentials: the API token comes from the request body when provided, else
falls back to the server-configured env token (``settings.proxmox_token_*``).
The token is never persisted by the app and never returned by any endpoint.
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
from app.core.scheduler import reschedule_proxmox_sync, set_proxmox_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import Node, PendingDevice, PendingDeviceLink, ScanRun
from app.schemas.proxmox import (
    ProxmoxConfig,
    ProxmoxConnectionRequest,
    ProxmoxEdgeOut,
    ProxmoxImportPendingResponse,
    ProxmoxImportResponse,
    ProxmoxNodeOut,
    ProxmoxTestConnectionResponse,
)
from app.schemas.scan import ScanRunResponse
from app.services.discovery_sources import add_source
from app.services.mac_utils import normalize_mac
from app.services.node_dedupe import dedupe_nodes_by_ieee
from app.services.proxmox_service import (
    build_proxmox_cluster_links,
    build_proxmox_properties,
    fetch_proxmox_inventory,
    merge_proxmox_properties,
    test_proxmox_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Discovery sources for the two proxmox link shapes. Host→guest links render as
# 'virtual' edges; host↔host cluster links render as 'cluster' edges.
_PROXMOX_GUEST_SOURCE = "proxmox"
_PROXMOX_CLUSTER_SOURCE = "proxmox_cluster"


def _resolve_credentials(payload: ProxmoxConnectionRequest) -> tuple[str, str]:
    """Pick the API token: request body first, else server env config.

    Raises HTTP 400 when neither carries a token.
    """
    token_id = payload.token_id or settings.proxmox_token_id
    token_secret = payload.token_secret or settings.proxmox_token_secret
    if not token_id or not token_secret:
        raise HTTPException(
            status_code=400,
            detail="No Proxmox API token provided and none configured on the server.",
        )
    return token_id, token_secret


@router.post("/test-connection", response_model=ProxmoxTestConnectionResponse)
async def test_connection_endpoint(
    payload: ProxmoxConnectionRequest,
    _: str = Depends(get_current_user),
) -> ProxmoxTestConnectionResponse:
    """Validate host reachability + token before importing."""
    token_id, token_secret = _resolve_credentials(payload)
    connected, message = await test_proxmox_connection(
        host=payload.host,
        port=payload.port,
        token_id=token_id,
        token_secret=token_secret,
        verify_tls=payload.verify_tls,
    )
    return ProxmoxTestConnectionResponse(connected=connected, message=message)


@router.post("/import", response_model=ProxmoxImportResponse)
async def import_proxmox(
    payload: ProxmoxConnectionRequest,
    _: str = Depends(get_current_user),
) -> ProxmoxImportResponse:
    """Fetch the inventory and return nodes + edges ready for canvas drop."""
    token_id, token_secret = _resolve_credentials(payload)
    try:
        nodes_raw, edges_raw = await fetch_proxmox_inventory(
            host=payload.host,
            port=payload.port,
            token_id=token_id,
            token_secret=token_secret,
            verify_tls=payload.verify_tls,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Proxmox import")
        raise HTTPException(status_code=500, detail="Unexpected error during Proxmox import") from exc

    nodes = [ProxmoxNodeOut(**n) for n in nodes_raw]
    edges = [ProxmoxEdgeOut(**e) for e in edges_raw]
    return ProxmoxImportResponse(nodes=nodes, edges=edges, device_count=len(nodes))


@router.post("/import-pending", response_model=ScanRunResponse)
async def import_proxmox_to_pending(
    payload: ProxmoxConnectionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Queue a Proxmox pending import as a background scan run (kind=proxmox)."""
    token_id, token_secret = _resolve_credentials(payload)
    run = ScanRun(
        status="running",
        kind="proxmox",
        ranges=[f"{payload.host}:{payload.port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_proxmox_import,
        run.id,
        payload.host,
        payload.port,
        token_id,
        token_secret,
        payload.verify_tls,
    )
    return run


async def _background_proxmox_import(
    run_id: str,
    host: str,
    port: int,
    token_id: str,
    token_secret: str,
    verify_tls: bool,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            nodes_raw, edges_raw = await fetch_proxmox_inventory(
                host=host,
                port=port,
                token_id=token_id,
                token_secret=token_secret,
                verify_tls=verify_tls,
            )
            result = await _persist_pending_import(db, nodes_raw, edges_raw)
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "done"
                run.devices_found = result.device_count
                run.finished_at = datetime.now(timezone.utc)
                run.error = _guest_visibility_advisory(nodes_raw)
                await db.commit()
            # Nudge the frontend to reload the inventory (same signal the IP scan
            # emits) so imported/merged devices appear without a manual refresh.
            from app.api.routes.status import broadcast_scan_update
            await broadcast_scan_update(run_id=run_id, devices_found=result.device_count)
        except Exception as exc:
            logger.exception("Proxmox import %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()


def _guest_visibility_advisory(nodes_raw: list[dict[str, Any]]) -> str | None:
    """Non-fatal advisory when hosts import but no VMs/LXC were visible.

    A Proxmox API token that lacks ``VM.Audit`` sees empty ``qemu``/``lxc`` lists
    (HTTP 200, no error), so only host nodes come through. The usual cause is a
    privilege-separated token whose effective rights are the *intersection* with
    the user's rights — granting PVEAuditor to the token alone is not enough when
    the user has none. Surface that instead of a silent success.
    """
    hosts = sum(1 for n in nodes_raw if n.get("type") == "proxmox")
    guests = len(nodes_raw) - hosts
    if hosts and not guests:
        return (
            f"Imported {hosts} host(s) but no VMs or LXC were visible to the API "
            "token. Grant the PVEAuditor role at path '/' to BOTH the token and "
            "the user (privilege-separated tokens get the intersection of token "
            "and user rights), then re-import."
        )
    return None


async def _persist_pending_import(
    db: AsyncSession,
    nodes_raw: list[dict[str, Any]],
    edges_raw: list[dict[str, Any]],
) -> ProxmoxImportPendingResponse:
    """Upsert Proxmox nodes/edges into pending_devices + pending_device_links.

    Two-tier identity (order matters):
      1. Match an existing canvas Node or pending row by **IP** (merge into a
         device previously found by a scan) — never duplicate.
      2. Else match by synthetic ``ieee_address`` (``pve-...``).

    Update-in-place only. Nothing is ever deleted; hidden rows stay hidden.
    """
    await dedupe_nodes_by_ieee(db)

    cluster_pairs = build_proxmox_cluster_links(nodes_raw)
    cluster_members = {ieee for pair in cluster_pairs for ieee in pair}

    pending_created = 0
    pending_updated = 0

    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        ip = n.get("ip")
        mac = normalize_mac(n.get("mac"))
        props = build_proxmox_properties(n)

        # 1) Already on a canvas? Match by ieee OR ip OR mac (the cross-source
        # dedup key — a stopped VM has no IP but its configured NIC MAC still
        # matches an ARP-scanned node). Refresh in place: merge properties, adopt
        # the pve identity onto a scanned node, backfill blank specs/hostname/mac.
        # Do NOT stomp user-set type/status.
        node_filter = [Node.ieee_address == ieee]
        if ip:
            node_filter.append(Node.ip == ip)
        if mac:
            node_filter.append(Node.mac == mac)
        existing_nodes = (
            await db.execute(select(Node).where(or_(*node_filter)).order_by(Node.id))
        ).scalars().all()

        if existing_nodes:
            for en in existing_nodes:
                en.properties = merge_proxmox_properties(en.properties, props)
                if not en.ieee_address:
                    en.ieee_address = ieee
                if ip and not en.ip:
                    en.ip = ip
                if mac and not en.mac:
                    en.mac = mac
                en.hostname = en.hostname or n.get("hostname")
                en.cpu_count = en.cpu_count or n.get("cpu_count")
                en.ram_gb = en.ram_gb or n.get("ram_gb")
                en.disk_gb = en.disk_gb or n.get("disk_gb")
                # A cluster host needs one left + one right handle for the
                # cluster edge endpoints (both default to 0).
                if ieee in cluster_members:
                    en.left_handles = max(en.left_handles or 0, 1)
                    en.right_handles = max(en.right_handles or 0, 1)
            await _ensure_inventory_row(db, ieee, ip, mac, n, props, approved=True)
            pending_updated += 1
            continue

        # 2) Not on canvas — upsert the pending inventory row.
        pending = await _find_pending(db, ieee, ip, mac)
        if pending is None:
            db.add(_new_pending(ieee, ip, mac, n, props, status="pending"))
            pending_created += 1
        else:
            _refresh_pending(pending, ieee, ip, mac, n, props)
            pending_updated += 1

    links_recorded = await _replace_links(db, edges_raw, cluster_pairs)
    await db.commit()

    return ProxmoxImportPendingResponse(
        pending_created=pending_created,
        pending_updated=pending_updated,
        links_recorded=links_recorded,
        device_count=len(nodes_raw),
    )


async def _find_pending(
    db: AsyncSession, ieee: str, ip: str | None, mac: str | None
) -> PendingDevice | None:
    filters = [PendingDevice.ieee_address == ieee]
    if ip:
        filters.append(PendingDevice.ip == ip)
    if mac:
        filters.append(PendingDevice.mac == mac)
    return (
        await db.execute(select(PendingDevice).where(or_(*filters)))
    ).scalars().first()


def _new_pending(
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
    status: str,
) -> PendingDevice:
    return PendingDevice(
        ieee_address=ieee,
        ip=ip,
        mac=mac,
        hostname=n.get("hostname"),
        friendly_name=n.get("label"),
        suggested_type=n.get("type"),
        vendor=n.get("vendor"),
        model=n.get("model"),
        properties=props,
        status=status,
        discovery_source=_PROXMOX_GUEST_SOURCE,
        discovery_sources=[_PROXMOX_GUEST_SOURCE],
    )


def _sources_after_merge(row: PendingDevice) -> list[str]:
    """Discovery sources for an inventory row after a Proxmox import merges in.

    Must run BEFORE the ``pve-`` ieee is adopted onto the row, so it can tell
    whether the row was originally a scanned device. Preserves the prior scan
    origin — including legacy rows created before ``discovery_sources`` existed
    (empty list) and possibly with a NULL ``discovery_source`` — so the IP tag
    survives the merge. A row that carries an IP but was not itself a Proxmox
    device (no ``pve-`` ieee) was found by a scan; keep an IP-scan source.
    """
    sources = add_source(row.discovery_sources, row.discovery_source)
    was_scanned = not (row.ieee_address or "").startswith("pve-")
    if was_scanned and row.ip and not any(s in ("arp", "mdns") for s in sources):
        sources = add_source(sources, "arp")
    return add_source(sources, _PROXMOX_GUEST_SOURCE)


def _refresh_pending(
    pending: PendingDevice,
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
) -> None:
    # Compute sources before adopting the pve ieee (needs the pre-merge origin).
    pending.discovery_sources = _sources_after_merge(pending)
    pending.ieee_address = pending.ieee_address or ieee
    pending.ip = ip or pending.ip
    pending.mac = pending.mac or mac
    pending.hostname = n.get("hostname") or pending.hostname
    pending.friendly_name = n.get("label") or pending.friendly_name
    pending.suggested_type = n.get("type") or pending.suggested_type
    pending.vendor = n.get("vendor") or pending.vendor
    pending.model = n.get("model") or pending.model
    pending.properties = merge_proxmox_properties(list(pending.properties or []), props)
    if pending.status == "approved":
        # Approved earlier but the canvas Node is gone — revive so it reappears.
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
    """Ensure an inventory row exists for a device already on a canvas, so it
    shows in the inventory with an 'In N canvas' badge. Never changes status."""
    inv = await _find_pending(db, ieee, ip, mac)
    if inv is None:
        db.add(_new_pending(ieee, ip, mac, n, props, status="approved" if approved else "pending"))
    else:
        # Compute sources before adopting the pve ieee (needs the pre-merge origin).
        inv.discovery_sources = _sources_after_merge(inv)
        inv.ieee_address = inv.ieee_address or ieee
        inv.ip = ip or inv.ip
        inv.mac = inv.mac or mac
        inv.hostname = n.get("hostname") or inv.hostname
        inv.suggested_type = n.get("type") or inv.suggested_type
        inv.properties = merge_proxmox_properties(list(inv.properties or []), props)


async def _replace_links(
    db: AsyncSession,
    edges_raw: list[dict[str, Any]],
    cluster_pairs: list[tuple[str, str]],
) -> int:
    """Wipe all proxmox-source links and re-insert the freshly discovered set.

    Two link shapes: host→guest (``proxmox`` → 'virtual' edges) and host↔host
    (``proxmox_cluster`` → 'cluster' edges).
    """
    await db.execute(
        sa_delete(PendingDeviceLink).where(
            PendingDeviceLink.discovery_source.in_([_PROXMOX_GUEST_SOURCE, _PROXMOX_CLUSTER_SOURCE])
        )
    )
    recorded = 0
    seen: set[tuple[str, str]] = set()

    def _add(src: str | None, tgt: str | None, source: str) -> None:
        nonlocal recorded
        if not src or not tgt or (src, tgt) in seen:
            return
        seen.add((src, tgt))
        db.add(PendingDeviceLink(source_ieee=src, target_ieee=tgt, discovery_source=source))
        recorded += 1

    for e in edges_raw:
        _add(e.get("source"), e.get("target"), _PROXMOX_GUEST_SOURCE)
    for src, tgt in cluster_pairs:
        _add(src, tgt, _PROXMOX_CLUSTER_SOURCE)

    return recorded


@router.get("/config", response_model=ProxmoxConfig)
async def get_proxmox_config(_: str = Depends(get_current_user)) -> ProxmoxConfig:
    """Return non-secret Proxmox config. Never includes the token — only whether
    one is configured on the server."""
    return ProxmoxConfig(
        host=settings.proxmox_host,
        port=settings.proxmox_port,
        verify_tls=settings.proxmox_verify_tls,
        sync_enabled=settings.proxmox_sync_enabled,
        sync_interval=settings.proxmox_sync_interval,
        token_configured=bool(settings.proxmox_token_id and settings.proxmox_token_secret),
    )


@router.post("/config", response_model=ProxmoxConfig)
async def save_proxmox_config(
    payload: ProxmoxConfig,
    _: str = Depends(get_current_user),
) -> ProxmoxConfig:
    """Persist non-secret Proxmox config and apply the auto-sync schedule live.

    The token is NOT accepted here — it is env-only by design.
    """
    if payload.sync_enabled and not (settings.proxmox_token_id and settings.proxmox_token_secret):
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Proxmox API token configured on the server.",
        )
    try:
        settings.proxmox_host = payload.host
        settings.proxmox_port = payload.port
        settings.proxmox_verify_tls = payload.verify_tls
        settings.proxmox_sync_enabled = payload.sync_enabled
        settings.proxmox_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_proxmox_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_proxmox_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_proxmox_config()
