import ipaddress
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import (
    Design,
    Edge,
    InventoryDevice,
    InventoryDeviceLink,
    Node,
    RackDevice,
    ScanRun,
)
from app.schemas.nodes import NodeCreate
from app.schemas.scan import (
    InventoryDeviceCreate,
    InventoryDeviceResponse,
    InventoryDeviceUpdate,
    ScanRunResponse,
)
from app.services.discovery_sources import add_source
from app.services.inventory_sync import find_device_for, merge_properties, merge_services
from app.services.mac_utils import normalize_mac
from app.services.node_dedupe import dedupe_nodes_by_device, find_duplicate_node
from app.services.scanner import (
    DeepScanOptions,
    _valid_port_range,
    _valid_port_spec,
    request_cancel,
    run_device_scan,
    run_scan,
)
from app.services.zigbee_service import (
    build_zigbee_properties,
    merge_zigbee_properties,
)
from app.services.zwave_service import build_zwave_properties

_ZIGBEE_TYPES = {"zigbee_coordinator", "zigbee_router", "zigbee_enddevice"}
_ZWAVE_TYPES = {"zwave_coordinator", "zwave_router", "zwave_enddevice"}


def _ip_tokens(ip: str | None) -> list[str]:
    """Split a Node/device ``ip`` field into individual addresses.

    The canvas stores multiple addresses in one comma-separated string (e.g.
    ``"fe80::1, 192.168.1.5"`` once a user adds an IPv6 address). Matching a
    scanned device against that field must compare per-address, not against the
    whole string, or the device looks absent from the canvas (issue #258).
    """
    return [t.strip() for t in ip.split(",") if t.strip()] if ip else []


def _is_rack_only(device: InventoryDevice) -> bool:
    """True for inventory entries created from a rack canvas.

    They describe a mount — a patch panel, a shelf, a chassis — not a host to
    document on a logical canvas, so they are never approved onto one.
    """
    return device.discovery_source == "rack" or "rack" in (device.discovery_sources or [])


def _is_wireless(node_type: str | None) -> bool:
    """Zigbee + Z-Wave mesh devices share online status / no ICMP check."""
    return node_type in _ZIGBEE_TYPES or node_type in _ZWAVE_TYPES


def _wireless_properties(
    node_type: str | None,
    ieee: str | None,
    vendor: str | None,
    model: str | None,
    lqi: int | None,
) -> list[dict[str, Any]]:
    """Build the right property rows for a mesh device (Z-Wave has no LQI)."""
    if node_type in _ZWAVE_TYPES:
        return build_zwave_properties(ieee, vendor, model)
    return build_zigbee_properties(ieee, vendor, model, lqi)


def build_mac_property(mac: str | None) -> list[dict[str, Any]]:
    """Build a NodeProperty list carrying a device MAC address.

    Shape matches the frontend ``NodeProperty`` type
    (``{key, value, icon, visible}``). Hidden by default — the user opts in to
    showing it on the canvas card from the right panel. Returns an empty list
    when no MAC is known.
    """
    if not mac:
        return []
    return [{"key": "MAC", "value": mac, "icon": None, "visible": False}]


def merge_mac_property(
    props: list[dict[str, Any]] | None, mac: str | None
) -> list[dict[str, Any]]:
    """Append a MAC NodeProperty to ``props`` unless one is already present.

    Preserves any user-supplied properties (and an existing MAC row's
    visibility) untouched. Used on approve so the scanned MAC is not lost.
    """
    out = [dict(p) for p in (props or [])]
    if not mac or any(p.get("key") == "MAC" for p in out):
        return out
    out.append({"key": "MAC", "value": mac, "icon": None, "visible": False})
    return out


class BulkActionRequest(BaseModel):
    device_ids: list[str]
    # Target design for approved nodes. Falls back to the first design when
    # omitted (keeps older clients working), but the UI should send the active
    # design so approved devices land on the canvas the user is looking at.
    design_id: str | None = None


def _check_port_ranges(v: list[str]) -> list[str]:
    for r in v:
        if not _valid_port_range(r.strip()):
            raise ValueError(f"Invalid port range: {r!r}")
    return v


class ScanConfig(BaseModel):
    """Persisted scan defaults (Options page). Deep-scan fields are optional."""

    ranges: list[str]
    http_ranges: list[str] = []
    http_probe_enabled: bool = False
    verify_tls: bool = False

    @field_validator("ranges")
    @classmethod
    def validate_cidr(cls, v: list[str]) -> list[str]:
        for r in v:
            try:
                ipaddress.ip_network(r, strict=False)
            except ValueError as exc:
                raise ValueError(f"Invalid CIDR range: {r!r}") from exc
        return v

    @field_validator("http_ranges")
    @classmethod
    def validate_http_ranges(cls, v: list[str]) -> list[str]:
        return _check_port_ranges(v)


class TriggerScanRequest(BaseModel):
    """Per-scan deep-scan overrides (scan dialog). None → use persisted default."""

    http_ranges: list[str] | None = None
    http_probe_enabled: bool | None = None
    verify_tls: bool | None = None

    @field_validator("http_ranges")
    @classmethod
    def validate_http_ranges(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _check_port_ranges(v)


logger = logging.getLogger(__name__)
router = APIRouter()


async def _background_scan(
    run_id: str, ranges: list[str], deep_scan: DeepScanOptions | None = None
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            await run_scan(ranges, db, run_id, deep_scan=deep_scan or DeepScanOptions())
        except Exception:
            logger.exception("Scan run %s failed unexpectedly", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run and run.status == "running":
                run.status = "failed"
                await db.commit()


async def _background_device_scan(
    run_id: str,
    device_id: str,
    deep_scan: DeepScanOptions | None = None,
    full_ports: bool = True,
    ports: str | None = None,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            await run_device_scan(
                device_id,
                db,
                run_id,
                deep_scan=deep_scan or DeepScanOptions(),
                full_ports=full_ports,
                ports=ports,
            )
        except Exception:
            logger.exception("Device scan run %s failed unexpectedly", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run and run.status == "running":
                run.status = "failed"
                await db.commit()


def _resolve_deep_scan(payload: TriggerScanRequest | None) -> DeepScanOptions:
    """Merge per-scan overrides over persisted settings defaults."""
    p = payload or TriggerScanRequest()
    return DeepScanOptions(
        http_ranges=(
            p.http_ranges if p.http_ranges is not None else settings.scanner_http_ranges
        ),
        http_probe_enabled=(
            p.http_probe_enabled
            if p.http_probe_enabled is not None
            else settings.scanner_http_probe_enabled
        ),
        verify_tls=(
            p.verify_tls if p.verify_tls is not None else settings.scanner_http_verify_tls
        ),
    )


@router.post("/trigger", response_model=ScanRunResponse)
async def trigger_scan(
    background_tasks: BackgroundTasks,
    payload: TriggerScanRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    ranges = settings.scanner_ranges
    deep_scan = _resolve_deep_scan(payload)
    run = ScanRun(status="running", ranges=ranges)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_scan, run.id, ranges, deep_scan)
    return run


class RescanDeviceRequest(BaseModel):
    """Per-device deep rescan. Defaults to every TCP port — that is the point.

    ``ports`` narrows the sweep to what the user typed in the deep-scan dialog
    (``80,443``, ``1-1024``); it wins over ``full_ports``.
    """

    full_ports: bool = True
    ports: str | None = None
    http_probe_enabled: bool | None = None
    verify_tls: bool | None = None

    @field_validator("ports")
    @classmethod
    def _check_ports(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        spec = v.strip()
        if not _valid_port_spec(spec):
            raise ValueError("Invalid port range")
        return spec


@router.post("/pending/{device_id}/rescan", response_model=ScanRunResponse)
async def rescan_device(
    device_id: str,
    background_tasks: BackgroundTasks,
    payload: RescanDeviceRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Deep-rescan one known device to refresh its services (issue #350).

    Recorded as a ScanRun like any other scan, so progress, stop and history
    work unchanged. One run per device at a time — a second request while the
    first is still scanning is a 409, not a duplicate nmap over 65535 ports.
    """
    device = await db.get(InventoryDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.ip:
        raise HTTPException(
            status_code=409, detail="Device has no IP address to scan"
        )
    if device.status == "hidden":
        raise HTTPException(status_code=409, detail="Device is hidden")

    target = f"{device.ip}/32"
    running = (await db.execute(
        select(ScanRun).where(ScanRun.status == "running", ScanRun.kind == "device")
    )).scalars().all()
    if any(target in (r.ranges or []) for r in running):
        raise HTTPException(
            status_code=409, detail="A scan is already running for this device"
        )

    p = payload or RescanDeviceRequest()
    deep_scan = _resolve_deep_scan(
        TriggerScanRequest(
            http_probe_enabled=p.http_probe_enabled, verify_tls=p.verify_tls
        )
    )
    run = ScanRun(status="running", kind="device", ranges=[target])
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(
        _background_device_scan, run.id, device_id, deep_scan, p.full_ports, p.ports
    )
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
    # Flip status eagerly so the UI reflects the stop immediately, instead of
    # waiting for run_scan to reach its next cancellation checkpoint (which may
    # be blocked inside a long nmap call). run_scan converges to the same state.
    run.status = "cancelled"
    run.finished_at = datetime.now(timezone.utc)
    await db.commit()
    return {"stopping": True}


def _agg(values: list[datetime], *, newest: bool) -> datetime | None:
    """Pick the newest (max) or oldest (min) of a list of timestamps, or None."""
    present = [v for v in values if v is not None]
    if not present:
        return None
    return max(present) if newest else min(present)


async def _canvas_correlation(
    db: AsyncSession, devices: list[InventoryDevice]
) -> dict[str, dict[str, Any]]:
    """Correlate each device to the canvas nodes drawing it.

    Returns, per device id: the number of distinct canvases (designs) it appears
    on, plus aggregated node timestamps — created_at (oldest) and updated_at
    (newest). A node names the inventory row it draws, so this is a group-by on
    ``device_id`` rather than the ieee/mac/ip guesswork it used to be.

    ``last_scan`` and ``last_seen`` come off the device row itself now: they are
    observations of the device, not of any one drawing of it.
    """
    if not devices:
        return {}
    rows = (
        await db.execute(
            select(Node.device_id, Node.design_id, Node.created_at, Node.updated_at)
            .where(Node.design_id.isnot(None), Node.device_id.isnot(None))
        )
    ).all()
    by_device: dict[str, list[Any]] = {}
    for row in rows:
        by_device.setdefault(row.device_id, []).append(row)

    info: dict[str, dict[str, Any]] = {}
    for d in devices:
        matched = by_device.get(d.id, [])
        designs = {m.design_id for m in matched}
        info[d.id] = {
            "canvas_count": len(designs),
            "node_created_at": _agg([m.created_at for m in matched], newest=False),
            "node_last_scan": d.last_scan,
            "node_last_modified": _agg([m.updated_at for m in matched], newest=True),
            "node_last_seen": d.last_seen,
        }
    return info


async def _with_canvas_counts(
    db: AsyncSession, devices: list[InventoryDevice]
) -> list[InventoryDevice]:
    """Attach transient canvas count + linked-node timestamps for the response."""
    info = await _canvas_correlation(db, devices)
    for d in devices:
        meta = info.get(d.id, {})
        d.canvas_count = meta.get("canvas_count", 0)
        d.node_created_at = meta.get("node_created_at")
        d.node_last_scan = meta.get("node_last_scan")
        d.node_last_modified = meta.get("node_last_modified")
        d.node_last_seen = meta.get("node_last_seen")
    return devices


@router.get("/pending", response_model=list[InventoryDeviceResponse])
async def list_pending(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[InventoryDevice]:
    # Inventory: every scanned device except the user-hidden ones. Approved devices
    # stay listed so they keep showing with a canvas-presence badge.
    result = await db.execute(select(InventoryDevice).where(InventoryDevice.status != "hidden"))
    return await _with_canvas_counts(db, list(result.scalars().all()))


@router.post("/pending", response_model=InventoryDeviceResponse, status_code=201)
async def create_pending(
    body: InventoryDeviceCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> InventoryDevice:
    """Add an inventory entry by hand, for hardware no scan can discover.

    Lands as ``status="pending"`` like a discovery would, so the existing approve
    / hide / restore flows apply unchanged.
    """
    # One device is one row. If this host is already known — by ieee, ip or mac —
    # the user is documenting the device they already have, so fill in what the
    # row is missing rather than splitting it in two.
    mac = normalize_mac(body.mac)
    existing = await find_device_for(db, ip=body.ip, mac=mac, ieee=None)
    if existing is not None:
        for field in (
            "hostname", "ip", "os", "suggested_type", "model", "vendor", "label", "type",
            "notes", "cpu_count", "cpu_model", "ram_gb", "disk_gb", "check_method",
            "check_target", "friendly_name", "device_subtype",
        ):
            value = getattr(body, field, None)
            if value not in (None, "") and getattr(existing, field, None) in (None, ""):
                setattr(existing, field, value)
        existing.mac = existing.mac or mac
        existing.properties = merge_properties(existing.properties, body.properties)
        existing.services = merge_services(existing.services, body.services)
        existing.discovery_sources = add_source(existing.discovery_sources, body.discovery_source)
        # A hidden row is still that device, so it is the one to fill in — but
        # adding a device by hand is asking for it, and returning it still hidden
        # would leave the user with a 201 and nothing in the inventory. The
        # explicit add outranks the earlier hide, exactly like restore.
        if existing.status == "hidden":
            existing.status = "pending"
        await db.commit()
        await db.refresh(existing)
        return (await _with_canvas_counts(db, [existing]))[0]

    device = InventoryDevice(
        hostname=body.hostname,
        ip=body.ip,
        # Canonical form, like every other write path: dedup compares MACs by
        # equality, so a hand-typed "AA-BB-CC-11-22-33" would never match the
        # scanned "aa:bb:cc:11:22:33" and approve would build a duplicate node.
        mac=mac,
        suggested_type=body.suggested_type,
        model=body.model,
        vendor=body.vendor,
        properties=body.properties,
        status="pending",
        discovery_source=body.discovery_source,
        discovery_sources=[body.discovery_source],
        os=body.os,
        services=body.services,
        friendly_name=body.friendly_name,
        device_subtype=body.device_subtype,
        label=body.label,
        type=body.type,
        notes=body.notes,
        cpu_count=body.cpu_count,
        cpu_model=body.cpu_model,
        ram_gb=body.ram_gb,
        disk_gb=body.disk_gb,
        show_hardware=body.show_hardware,
        check_method=body.check_method,
        check_target=body.check_target,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return (await _with_canvas_counts(db, [device]))[0]


@router.patch("/pending/{device_id}", response_model=InventoryDeviceResponse)
async def update_pending(
    device_id: str,
    body: InventoryDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> InventoryDevice:
    """Edit an inventory row — the device facts, not its lifecycle.

    The inventory row owns what a device *is*; a canvas node only owns how it is
    drawn. This is the write path behind the device detail modal, and applies
    only the fields the client actually sent.
    """
    device = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id == device_id))
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    data = body.model_dump(exclude_unset=True)
    if "mac" in data:
        # Same reason as create_pending: dedup matches MACs by equality.
        data["mac"] = normalize_mac(data["mac"])
    for field, value in data.items():
        setattr(device, field, value)

    await db.commit()
    await db.refresh(device)
    return (await _with_canvas_counts(db, [device]))[0]


@router.delete("/pending", response_model=dict)
async def clear_pending(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, int]:
    from sqlalchemy import delete as sa_delete
    result = await db.execute(sa_delete(InventoryDevice).where(InventoryDevice.status == "pending"))
    await db.commit()
    return {"deleted": result.rowcount}


@router.delete("/pending/{device_id}", response_model=dict)
async def delete_pending(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, bool]:
    """Remove one inventory entry.

    Used by the rack canvas to drop the placeholder it created for a plate once
    that plate is pointed at a real inventory row. Refuses while a rack still
    mounts the device: SQLite runs with foreign keys off here, so the mount's
    ``device_id`` would be left naming a row that no longer exists rather than
    being cleared by the ``ON DELETE SET NULL`` the schema declares.
    """
    device = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id == device_id))
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    mounted = (
        await db.execute(select(RackDevice.id).where(RackDevice.device_id == device_id).limit(1))
    ).scalar_one_or_none()
    if mounted:
        raise HTTPException(status_code=409, detail="Device is mounted in a rack")

    await db.delete(device)
    await db.commit()
    return {"deleted": True}


@router.get("/hidden", response_model=list[InventoryDeviceResponse])
async def list_hidden(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[InventoryDevice]:
    result = await db.execute(select(InventoryDevice).where(InventoryDevice.status == "hidden"))
    return await _with_canvas_counts(db, list(result.scalars().all()))


@router.post("/pending/bulk-approve", response_model=dict)
async def bulk_approve_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    # Repair any legacy same-canvas duplicate nodes before placing more.
    await dedupe_nodes_by_device(db)

    # Target the design the user is on; fall back to the first design.
    default_design_id = payload.design_id
    if default_design_id is None:
        first_design = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        default_design_id = first_design.id if first_design else None

    # Accept every selected device that isn't user-hidden. We intentionally do NOT
    # filter on status == "pending": a device's status is global, but canvas
    # membership is per-design. A device approved onto another canvas (or whose
    # node was later deleted) must still be placeable on THIS design. Duplicates
    # are guarded per-design below, not by the global status flag.
    result = await db.execute(
        select(InventoryDevice).where(
            InventoryDevice.id.in_(payload.device_ids),
            InventoryDevice.status != "hidden",
        )
    )
    devices = result.scalars().all()

    # What already sits on the target canvas. A node names the inventory row it
    # draws, so "already placed" is now a device-id lookup rather than a guess
    # across ip/mac/ieee. The value may be a Node still pending flush (in-batch
    # duplicate) — resolved to its id after the flush below.
    existing = (
        await db.execute(
            select(Node.id, Node.device_id).where(
                Node.design_id == default_design_id, Node.device_id.isnot(None)
            )
        )
    ).all()
    placed: dict[str, Any] = {device_id: nid for nid, device_id in existing}

    created_nodes: list[Node] = []
    approved_devices: list[InventoryDevice] = []
    skipped_devices: list[dict[str, Any]] = []
    for device in devices:
        # Rack-only gear belongs to a rack canvas, never to a logical one.
        if _is_rack_only(device):
            skipped_devices.append({
                "device_id": device.id,
                "label": device.hostname or device.friendly_name or "device",
                "match": "rack", "value": "rack device", "_ref": None,
            })
            continue
        # Report which identifier names the device, so the caller can explain
        # the skip and link to the node already drawing it.
        if device.id in placed:
            match, value = (
                ("ip", device.ip) if device.ip
                else ("ieee", device.ieee_address) if device.ieee_address
                else ("mac", device.mac)
            )
            skipped_devices.append({
                "device_id": device.id,
                "label": device.hostname or device.friendly_name or value or "device",
                "match": match, "value": value, "_ref": placed[device.id],
            })
            continue
        device.status = "approved"
        node_type = device.suggested_type or "generic"
        is_wireless = _is_wireless(node_type)
        cluster_host = await _is_proxmox_cluster_member(db, device.ieee_address)
        # Enrich the row, not the node: a mesh device's radio properties and the
        # default check method describe the device itself.
        device.type = device.type or node_type
        device.label = device.label or device.hostname or device.friendly_name or device.ip or "device"
        device.properties = (
            _wireless_properties(node_type, device.ieee_address, device.vendor, device.model, device.lqi)
            if is_wireless
            else merge_mac_property(list(device.properties or []), device.mac)
        )
        if is_wireless:
            # A mesh device answers no ICMP; being in the mesh is the liveness.
            device.check_method = "none"
            device.status_live = "online"
        elif not device.check_method:
            # Default to ping so the status checker actually polls it. Without
            # this the scheduler skips it (check_method NULL -> no check).
            device.check_method = "ping" if device.ip else None
        node = Node(
            label=device.label,
            type=device.type,
            # Cluster hosts get side handles for their host<->host cluster edge.
            left_handles=1 if cluster_host else 0,
            right_handles=1 if cluster_host else 0,
            design_id=default_design_id,
            # The node draws this inventory row; the row owns the facts.
            device_id=device.id,
        )
        db.add(node)
        created_nodes.append(node)
        approved_devices.append(device)
        # Track within this batch so a duplicate selection is not placed twice
        # on the same canvas. Stores the Node so a later in-batch skip can
        # resolve to its id after flush.
        placed[device.id] = node
    await db.flush()  # populates node.id from Python-side default before reading
    # node_ids and approved_device_ids stay index-aligned for the client's mapping.
    node_ids = [n.id for n in created_nodes]
    approved_device_ids = [d.id for d in approved_devices]

    # Resolve each skip's existing-node reference to a concrete id now that any
    # in-batch nodes have been flushed, and expose it under a clean key.
    for entry in skipped_devices:
        ref = entry.pop("_ref")
        entry["existing_node_id"] = ref.id if isinstance(ref, Node) else ref

    all_edges: list[dict[str, str]] = []
    for device in approved_devices:
        all_edges.extend(
            await _resolve_pending_links_for_ieee(db, device.ieee_address, default_design_id)
        )

    await db.commit()
    return {
        "approved": len(node_ids),
        "node_ids": node_ids,
        "device_ids": approved_device_ids,
        "edges_created": len(all_edges),
        "edges": all_edges,
        "skipped": len(payload.device_ids) - len(node_ids),
        "skipped_devices": skipped_devices,
    }


@router.post("/pending/bulk-hide", response_model=dict)
async def bulk_hide_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(InventoryDevice).where(
            InventoryDevice.id.in_(payload.device_ids),
            InventoryDevice.status == "pending",
        )
    )
    devices = result.scalars().all()
    for device in devices:
        device.status = "hidden"
    await db.commit()
    return {"hidden": len(devices), "skipped": len(payload.device_ids) - len(devices)}


@router.post("/pending/{device_id}/restore", response_model=dict)
async def restore_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    device = await db.get(InventoryDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.status != "hidden":
        raise HTTPException(status_code=409, detail="Device is not hidden")
    device.status = "pending"
    await db.commit()
    return {"restored": True, "device_id": device_id}


@router.post("/pending/bulk-restore", response_model=dict)
async def bulk_restore_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(InventoryDevice).where(
            InventoryDevice.id.in_(payload.device_ids),
            InventoryDevice.status == "hidden",
        )
    )
    devices = result.scalars().all()
    for device in devices:
        device.status = "pending"
    await db.commit()
    return {"restored": len(devices), "skipped": len(payload.device_ids) - len(devices)}


@router.post("/pending/{device_id}/approve", response_model=dict)
async def approve_device(
    device_id: str,
    node_data: NodeCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    # Determine target design
    node_design_id = node_data.design_id
    if node_design_id is None:
        first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        node_design_id = first.id if first else None

    device = await db.get(InventoryDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    # A device's status is GLOBAL — it flips to "approved" the moment it lands on
    # ANY canvas — but canvas membership is per-design. Approving onto a NEW
    # design must therefore work even when the device already sits on another
    # one (mirroring bulk_approve_devices, which deliberately does not filter on
    # status == "pending"). Same-design duplicates are caught by the per-design
    # IEEE/ip/mac guards below, not by this global flag. Only a user-hidden
    # device is off-limits here.
    if device.status == "hidden":
        raise HTTPException(status_code=409, detail="Device is hidden")
    if _is_rack_only(device):
        raise HTTPException(
            status_code=409,
            detail="Rack devices cannot be placed on a logical canvas",
        )
    wireless = _is_wireless(node_data.type)

    # A device already on THIS design (matched by ieee, ip OR mac) is NOT placed
    # again automatically: the user might genuinely want a second card, or might
    # be re-approving by mistake. Reject with 409 + the existing node so the UI
    # can ask — identical handling for IEEE (Zigbee/Z-Wave) and plain IP/ARP
    # hosts. force=True (set after the user confirms) skips this and creates it.
    # The same device on a *different* design is valid (one Node per canvas), so
    # this is scoped to node_design_id.
    if not node_data.force:
        conflict = await find_duplicate_node(
            db, node_design_id,
            node_data.ip or device.ip,
            node_data.mac or device.mac,
            ieee=device.ieee_address,
        )
        if conflict is not None:
            raise HTTPException(status_code=409, detail=conflict)

    device.status = "approved"
    # Prefer the MAC discovered during the scan (stored on the inventory row);
    # fall back to whatever the approve payload carried.
    _mac = device.mac or node_data.mac
    cluster_host = await _is_proxmox_cluster_member(db, device.ieee_address)

    # The approve dialog is an edit of the device, so its values land on the row
    # — the node that follows only says where it is drawn. A blank field in the
    # payload never clears what discovery already found.
    device.label = node_data.label or device.label
    device.type = node_data.type or device.type
    device.ip = node_data.ip or device.ip
    device.mac = _mac
    device.hostname = node_data.hostname or device.hostname
    device.services = merge_services(device.services, node_data.services)
    device.properties = (
        _wireless_properties(
            node_data.type, device.ieee_address, device.vendor, device.model, device.lqi
        )
        if wireless
        else merge_mac_property(
            merge_zigbee_properties(list(device.properties or []), node_data.properties or []),
            _mac,
        )
    )
    if wireless:
        # A mesh device answers no ICMP; being in the mesh is the liveness.
        device.check_method = "none"
        device.check_target = None
        device.status_live = "online"
    else:
        device.check_method = node_data.check_method or device.check_method or (
            "ping" if device.ip else None
        )
        device.check_target = node_data.check_target or device.check_target
        if node_data.status:
            device.status_live = node_data.status

    node = Node(
        label=device.label or node_data.label,
        type=device.type or node_data.type,
        # Cluster hosts get side handles for their host<->host cluster edge.
        left_handles=1 if cluster_host else 0,
        right_handles=1 if cluster_host else 0,
        design_id=node_design_id,
        # The node draws this inventory row; the row owns the facts.
        device_id=device.id,
    )
    db.add(node)
    await db.flush()
    node_id = node.id

    edges = await _resolve_pending_links_for_ieee(db, device.ieee_address, node_design_id)

    await db.commit()
    return {
        "approved": True,
        "node_id": node_id,
        "edges_created": len(edges),
        "edges": edges,
    }


async def _is_proxmox_cluster_member(db: AsyncSession, ieee: str | None) -> bool:
    """True if ``ieee`` participates in a proxmox_cluster link (host↔host).

    Such a host needs one left + one right handle for the cluster edge endpoints
    (both default to 0). Checked at approve time, before the link is consumed by
    ``_resolve_pending_links_for_ieee``.
    """
    if not ieee:
        return False
    found = (
        await db.execute(
            select(InventoryDeviceLink.id)
            .where(
                InventoryDeviceLink.discovery_source == "proxmox_cluster",
                (InventoryDeviceLink.source_ieee == ieee) | (InventoryDeviceLink.target_ieee == ieee),
            )
            .limit(1)
        )
    ).scalar()
    return found is not None


async def _resolve_pending_links_for_ieee(
    db: AsyncSession, ieee: str | None, design_id: str | None
) -> list[dict[str, str]]:
    """Materialize edges for any device_inventory_links involving ``ieee`` on the
    canvas identified by ``design_id``.

    For each link where the other endpoint already exists as a Node *on this
    design* (matched by ``Node.ieee_address`` + ``Node.design_id``), create the
    Edge. Links are **never** deleted here: they describe the discovered mesh /
    cluster topology and are wiped+reinserted wholesale on the next import
    (zigbee/zwave/proxmox). Keeping them lets the same devices be re-approved
    onto a second canvas with their edges intact.
    """
    if not ieee:
        return []

    links_q = await db.execute(
        select(InventoryDeviceLink).where(
            (InventoryDeviceLink.source_ieee == ieee)
            | (InventoryDeviceLink.target_ieee == ieee)
        )
    )
    links = list(links_q.scalars().all())
    if not links:
        return []

    # Map every relevant ieee → Node *on the target design* (single query).
    # Scoping by design is what makes a re-approve onto a second canvas link the
    # nodes of THAT canvas, not stale nodes left on another one.
    other_ieees = {
        link.target_ieee if link.source_ieee == ieee else link.source_ieee
        for link in links
    }
    other_ieees.add(ieee)
    # A node reaches its ieee through the inventory row it draws.
    nodes_q = await db.execute(
        select(InventoryDevice.ieee_address, Node)
        .join(Node, Node.device_id == InventoryDevice.id)
        .where(
            InventoryDevice.ieee_address.in_(other_ieees),
            Node.design_id == design_id,
        )
    )
    by_ieee = {row_ieee: node for row_ieee, node in nodes_q.all() if row_ieee}

    self_node = by_ieee.get(ieee)
    if self_node is None:
        return []

    # Pre-fetch existing edges between these node ids so we don't create dups
    # if the user re-approves a device or had drawn the link manually.
    candidate_node_ids = [n.id for n in by_ieee.values()]
    existing_q = await db.execute(
        select(Edge).where(
            Edge.source.in_(candidate_node_ids),
            Edge.target.in_(candidate_node_ids),
        )
    )
    existing_pairs = {(e.source, e.target) for e in existing_q.scalars().all()}

    created: list[dict[str, str]] = []
    for link in links:
        other_ieee = (
            link.target_ieee if link.source_ieee == ieee else link.source_ieee
        )
        other_node = by_ieee.get(other_ieee)
        if other_node is None:
            continue
        if link.source_ieee == ieee:
            src_id, tgt_id = self_node.id, other_node.id
        else:
            src_id, tgt_id = other_node.id, self_node.id
        # Skip if either direction already exists on this design (re-approve or
        # a manually drawn link). The link row is kept for other designs.
        if (src_id, tgt_id) in existing_pairs or (tgt_id, src_id) in existing_pairs:
            continue
        # Edge lands on the design we're approving into (the nodes above are
        # already scoped to it).
        edge_design_id = design_id or (self_node.design_id if self_node else None)
        # Edge shape by link source. Handle IDs are the *bare* slot-0 side names
        # (the canonical stored form — the save path normalizes '<side>-t' → the
        # bare source id, and React Flow resolves the bare id to that side). A
        # '-t' target id does not resolve here and RF falls back to the top
        # handle, so never emit one.
        #   proxmox         → 'virtual' host→guest, vertical (bottom → top)
        #   proxmox_cluster → 'cluster' host↔host, horizontal (right → left)
        #   anything else   → 'iot' mesh link, vertical
        if link.discovery_source == "proxmox":
            edge_type, src_handle, tgt_handle = "virtual", "bottom", "top"
        elif link.discovery_source == "proxmox_cluster":
            edge_type, src_handle, tgt_handle = "cluster", "right", "left"
        else:
            edge_type, src_handle, tgt_handle = "iot", "bottom", "top"
        edge = Edge(
            source=src_id,
            target=tgt_id,
            type=edge_type,
            source_handle=src_handle,
            target_handle=tgt_handle,
            design_id=edge_design_id,
        )
        db.add(edge)
        await db.flush()
        existing_pairs.add((src_id, tgt_id))
        # Return the edge's type + handles so the client injects it faithfully
        # (a cluster edge must keep its right→left handles, not the iot default).
        created.append({
            "id": edge.id,
            "source": src_id,
            "target": tgt_id,
            "type": edge_type,
            "source_handle": src_handle,
            "target_handle": tgt_handle,
        })

    return created


@router.post("/pending/{device_id}/hide")
async def hide_device(
    device_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    device = await db.get(InventoryDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.status = "hidden"
    await db.commit()
    return {"hidden": True}


@router.post("/pending/{device_id}/ignore")
async def ignore_device(
    device_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    device = await db.get(InventoryDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()
    return {"ignored": True}


@router.get("/runs", response_model=list[ScanRunResponse])
async def list_runs(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[ScanRun]:
    result = await db.execute(select(ScanRun).order_by(ScanRun.started_at.desc()).limit(20))
    return list(result.scalars().all())


@router.get("/runs/{run_id}", response_model=ScanRunResponse)
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """One run, for a caller waiting on a scan it started (the device rescan)."""
    run = await db.get(ScanRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Scan run not found")
    return run


@router.get("/config", response_model=ScanConfig)
async def get_scan_config(_: str = Depends(get_current_user)) -> ScanConfig:
    return ScanConfig(
        ranges=settings.scanner_ranges,
        http_ranges=settings.scanner_http_ranges,
        http_probe_enabled=settings.scanner_http_probe_enabled,
        verify_tls=settings.scanner_http_verify_tls,
    )


@router.post("/config", response_model=ScanConfig)
async def update_scan_config(payload: ScanConfig, _: str = Depends(get_current_user)) -> ScanConfig:
    previous = (
        settings.scanner_ranges,
        settings.scanner_http_ranges,
        settings.scanner_http_probe_enabled,
        settings.scanner_http_verify_tls,
    )
    settings.scanner_ranges = payload.ranges
    settings.scanner_http_ranges = payload.http_ranges
    settings.scanner_http_probe_enabled = payload.http_probe_enabled
    settings.scanner_http_verify_tls = payload.verify_tls
    try:
        settings.save_overrides()
        return payload
    except Exception as exc:
        (
            settings.scanner_ranges,
            settings.scanner_http_ranges,
            settings.scanner_http_probe_enabled,
            settings.scanner_http_verify_tls,
        ) = previous
        logger.error("Failed to save scan config: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save scan config") from exc
