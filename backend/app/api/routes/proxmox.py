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
from app.db.models import InventoryDevice, InventoryDeviceLink, Node, ScanRun
from app.schemas.proxmox import (
    ProxmoxConfig,
    ProxmoxConnectionRequest,
    ProxmoxEdgeOut,
    ProxmoxImportPendingResponse,
    ProxmoxImportResponse,
    ProxmoxNodeOut,
    ProxmoxSyncConfig,
    ProxmoxTestConnectionResponse,
)
from app.schemas.scan import ScanRunResponse
from app.services.discovery_sources import add_source
from app.services.inventory_sync import attach_device_ids
from app.services.mac_utils import normalize_mac
from app.services.node_dedupe import dedupe_nodes_by_device
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
# Every imported guest/host carries a synthetic ieee under this prefix
# (``pve-node-{host}`` / ``pve-{host}-{vmid}``), built in proxmox_service.
_PVE_IEEE_PREFIX = "pve-"


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
    db: AsyncSession = Depends(get_db),
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

    # A canvas import is an import: the guests land in the Device Inventory too,
    # and each node carries the id of the row it draws so the canvas save links
    # to it instead of minting a second row for the same guest.
    await _persist_pending_import(db, nodes_raw, edges_raw)
    nodes_raw = await attach_device_ids(db, nodes_raw)

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


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_proxmox_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Trigger an immediate Proxmox inventory sync using the server env config.

    Same background flow as ``/import-pending`` but sources host + token from
    ``settings`` (env) rather than the request body — the manual counterpart to
    the scheduled auto-sync job. Requires the env token to be configured.
    """
    if not (settings.proxmox_host and settings.proxmox_token_id and settings.proxmox_token_secret):
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Proxmox host/token configured on the server.",
        )
    run = ScanRun(
        status="running",
        kind="proxmox",
        ranges=[f"{settings.proxmox_host}:{settings.proxmox_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_proxmox_import,
        run.id,
        settings.proxmox_host,
        settings.proxmox_port,
        settings.proxmox_token_id,
        settings.proxmox_token_secret,
        settings.proxmox_verify_tls,
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
    """Upsert Proxmox nodes/edges into device_inventory + device_inventory_links.

    Two-tier identity (order matters) — see ``_find_pending``:
      1. Match by the synthetic ``ieee_address`` (``pve-{host}-{vmid}``), the
         only key that identifies a guest.
      2. Else match an existing pending row by MAC, then IP, to merge into a
         device a scan found first — never duplicate. Rows already claimed by
         another Proxmox guest are excluded.

    Update-in-place only. Nothing is ever deleted; hidden rows stay hidden.
    """
    await dedupe_nodes_by_device(db)

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

        # Match by ieee OR ip OR mac (the cross-source dedup key — a stopped VM
        # has no IP but its configured NIC MAC still matches an ARP-scanned
        # device). The inventory row owns the facts, so the import merges into
        # it whether or not the device is drawn anywhere; a node only needs its
        # cluster handles adjusted. Do NOT stomp user-set type/status.
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
                # Already on a canvas: refresh the facts but leave the lifecycle
                # alone (_refresh_pending would revive it as pending).
                await _ensure_inventory_row(db, ieee, ip, mac, n, props, approved=True)
            else:
                _refresh_pending(pending, ieee, ip, mac, n, props)
            pending.cpu_count = pending.cpu_count or n.get("cpu_count")
            pending.ram_gb = pending.ram_gb or n.get("ram_gb")
            pending.disk_gb = pending.disk_gb or n.get("disk_gb")
            pending_updated += 1

            # A cluster host needs one left + one right handle for the cluster
            # edge endpoints (both default to 0) — the one piece of this that is
            # genuinely about how the node is drawn.
            if ieee in cluster_members:
                for en in (
                    await db.execute(select(Node).where(Node.device_id == pending.id))
                ).scalars().all():
                    en.left_handles = max(en.left_handles or 0, 1)
                    en.right_handles = max(en.right_handles or 0, 1)

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
) -> InventoryDevice | None:
    """The inventory row this guest *is*, in strict precedence order.

    1. The synthetic ``ieee_address`` (``pve-{host}-{vmid}``). Unique per guest
       and the only key that identifies one.
    2. Else the NIC MAC, else the IP — merging into a row an IP/ARP scan found
       first, or into this same guest under its previous host name.

    An IP is not an identity: a duplicated static lease, a re-used DHCP address,
    two guests behind one NAT, or a container-bridge address several guests
    report to the agent all make one address describe several machines. So the
    IP fallback skips any row already claimed by a Proxmox guest — matching one
    used to overwrite that guest's hostname, VMID and specs, and
    non-deterministically, since one flat OR with no ordering returned whichever
    row the database yielded first. Oldest row wins, so a re-import is stable.

    A MAC *is* an identity, so its fallback matches a claimed row too. It has to:
    the synthetic ieee embeds the host name, and a live migration or a node
    rename changes it for what is the same guest (``pve-pve1-802`` →
    ``pve-pve2-802``). Excluding claimed rows there would file the migrated
    guest as a new device and orphan its old row. See ``_adopted_ieee``.
    """
    exact = (
        await db.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == ieee)
        )
    ).scalars().first()
    if exact is not None:
        return exact

    unclaimed = or_(
        InventoryDevice.ieee_address.is_(None),
        ~InventoryDevice.ieee_address.startswith(_PVE_IEEE_PREFIX),
    )
    for column, value, claimed_ok in (
        (InventoryDevice.mac, mac, True),
        (InventoryDevice.ip, ip, False),
    ):
        if not value:
            continue
        where = [column == value] if claimed_ok else [column == value, unclaimed]
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


def _adopted_ieee(current: str | None, ieee: str) -> str:
    """The ``ieee_address`` a row should carry once this guest merges into it.

    Re-point a row that already belongs to a Proxmox guest: matched by NIC MAC,
    it is this same guest under a stale host name (migrated, or the node was
    renamed). Links are rebuilt keyed on the ieee, so a row left on the old one
    stops resolving as a host→guest endpoint. A mesh ieee is a real hardware
    address and is never overwritten.
    """
    if not current or current.startswith(_PVE_IEEE_PREFIX):
        return ieee
    return current


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
        # Specs the guest reports. They used to land only on the canvas node;
        # the inventory row owns them now.
        cpu_count=n.get("cpu_count"),
        ram_gb=n.get("ram_gb"),
        disk_gb=n.get("disk_gb"),
        status=status,
        discovery_source=_PROXMOX_GUEST_SOURCE,
        discovery_sources=[_PROXMOX_GUEST_SOURCE],
    )


def _sources_after_merge(row: InventoryDevice) -> list[str]:
    """Discovery sources for an inventory row after a Proxmox import merges in.

    Must run BEFORE the ``pve-`` ieee is adopted onto the row, so it can tell
    whether the row was originally a scanned device. Preserves the prior scan
    origin — including legacy rows created before ``discovery_sources`` existed
    (empty list) and possibly with a NULL ``discovery_source`` — so the IP tag
    survives the merge. A row that carries an IP but was not itself a Proxmox
    device (no ``pve-`` ieee) was found by a scan; keep an IP-scan source.
    """
    sources = add_source(row.discovery_sources, row.discovery_source)
    was_scanned = not (row.ieee_address or "").startswith(_PVE_IEEE_PREFIX)
    if was_scanned and row.ip and not any(s in ("arp", "mdns") for s in sources):
        sources = add_source(sources, "arp")
    return add_source(sources, _PROXMOX_GUEST_SOURCE)


def _refresh_pending(
    pending: InventoryDevice,
    ieee: str,
    ip: str | None,
    mac: str | None,
    n: dict[str, Any],
    props: list[dict[str, Any]],
) -> None:
    # Compute sources before adopting the pve ieee (needs the pre-merge origin).
    pending.discovery_sources = _sources_after_merge(pending)
    pending.ieee_address = _adopted_ieee(pending.ieee_address, ieee)
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
        inv.ieee_address = _adopted_ieee(inv.ieee_address, ieee)
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
        sa_delete(InventoryDeviceLink).where(
            InventoryDeviceLink.discovery_source.in_([_PROXMOX_GUEST_SOURCE, _PROXMOX_CLUSTER_SOURCE])
        )
    )
    recorded = 0
    seen: set[tuple[str, str]] = set()

    def _add(src: str | None, tgt: str | None, source: str) -> None:
        nonlocal recorded
        if not src or not tgt or (src, tgt) in seen:
            return
        seen.add((src, tgt))
        db.add(InventoryDeviceLink(source_ieee=src, target_ieee=tgt, discovery_source=source))
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
    payload: ProxmoxSyncConfig,
    _: str = Depends(get_current_user),
) -> ProxmoxConfig:
    """Persist the auto-sync activation (enabled + interval) and apply it live.

    This is the ONLY Proxmox config the app writes. Connection settings
    (host, port, token, verify_tls) are env-only and are never accepted or
    persisted here — enabling auto-sync requires host + token already set in the
    server env, since the scheduled job reads them from there.
    """
    if payload.sync_enabled and not (
        settings.proxmox_host and settings.proxmox_token_id and settings.proxmox_token_secret
    ):
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Proxmox host/token configured in the server env.",
        )
    try:
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
