import ipaddress
import logging
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import Design, Edge, Node, PendingDevice, PendingDeviceLink, ScanRun
from app.schemas.nodes import NodeCreate
from app.schemas.scan import PendingDeviceResponse, ScanRunResponse
from app.services.scanner import DeepScanOptions, _valid_port_range, request_cancel, run_scan
from app.services.zigbee_service import build_zigbee_properties

_ZIGBEE_TYPES = {"zigbee_coordinator", "zigbee_router", "zigbee_enddevice"}


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
    return {"stopping": True}


async def _canvas_counts(
    db: AsyncSession, devices: list[PendingDevice]
) -> dict[str, int]:
    """Map each device id → number of distinct canvases (designs) it appears on.

    Correlates a scanned device to existing nodes by ``ieee_address`` (exact) or
    ``ip`` (exact). Runs a single node query and groups in Python — node counts are
    small for a homelab, so this avoids an N+1 per device.
    """
    if not devices:
        return {}
    rows = (
        await db.execute(
            select(Node.ip, Node.ieee_address, Node.design_id).where(
                Node.design_id.isnot(None)
            )
        )
    ).all()
    # ip → set(design_id), ieee → set(design_id)
    by_ip: dict[str, set[str]] = {}
    by_ieee: dict[str, set[str]] = {}
    for ip, ieee, design_id in rows:
        if ip:
            by_ip.setdefault(ip, set()).add(design_id)
        if ieee:
            by_ieee.setdefault(ieee, set()).add(design_id)

    counts: dict[str, int] = {}
    for d in devices:
        designs: set[str] = set()
        if d.ieee_address:
            designs |= by_ieee.get(d.ieee_address, set())
        if d.ip:
            designs |= by_ip.get(d.ip, set())
        counts[d.id] = len(designs)
    return counts


async def _with_canvas_counts(
    db: AsyncSession, devices: list[PendingDevice]
) -> list[PendingDevice]:
    """Attach a transient ``canvas_count`` to each device for the response schema."""
    counts = await _canvas_counts(db, devices)
    for d in devices:
        d.canvas_count = counts.get(d.id, 0)
    return devices


@router.get("/pending", response_model=list[PendingDeviceResponse])
async def list_pending(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[PendingDevice]:
    # Inventory: every scanned device except the user-hidden ones. Approved devices
    # stay listed so they keep showing with a canvas-presence badge.
    result = await db.execute(select(PendingDevice).where(PendingDevice.status != "hidden"))
    return await _with_canvas_counts(db, list(result.scalars().all()))


@router.delete("/pending", response_model=dict)
async def clear_pending(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, int]:
    from sqlalchemy import delete as sa_delete
    result = await db.execute(sa_delete(PendingDevice).where(PendingDevice.status == "pending"))
    await db.commit()
    return {"deleted": result.rowcount}


@router.get("/hidden", response_model=list[PendingDeviceResponse])
async def list_hidden(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[PendingDevice]:
    result = await db.execute(select(PendingDevice).where(PendingDevice.status == "hidden"))
    return await _with_canvas_counts(db, list(result.scalars().all()))


@router.post("/pending/bulk-approve", response_model=dict)
async def bulk_approve_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    # Determine target design (use first design as fallback)
    first_design = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
    default_design_id = first_design.id if first_design else None

    result = await db.execute(
        select(PendingDevice).where(
            PendingDevice.id.in_(payload.device_ids),
            PendingDevice.status == "pending",
        )
    )
    devices = result.scalars().all()
    created_nodes: list[Node] = []
    for device in devices:
        device.status = "approved"
        node_type = device.suggested_type or "generic"
        is_zigbee = node_type in _ZIGBEE_TYPES
        node = Node(
            label=device.hostname or device.friendly_name or device.ip or "device",
            type=node_type,
            ip=device.ip,
            mac=device.mac,
            hostname=device.hostname,
            status="online" if is_zigbee else "unknown",
            services=device.services or [],
            ieee_address=device.ieee_address,
            properties=build_zigbee_properties(
                device.ieee_address, device.vendor, device.model, device.lqi
            ) if is_zigbee else build_mac_property(device.mac),
            # Default to ping so the status checker actually polls the new node.
            # Without this the scheduler skips it (check_method NULL → no check).
            check_method="none" if is_zigbee else ("ping" if device.ip else None),
            design_id=default_design_id,
        )
        db.add(node)
        created_nodes.append(node)
    await db.flush()  # populates node.id from Python-side default before reading
    node_ids = [n.id for n in created_nodes]
    approved_device_ids = [d.id for d in devices]

    all_edges: list[dict[str, str]] = []
    for device in devices:
        all_edges.extend(await _resolve_pending_links_for_ieee(db, device.ieee_address))

    await db.commit()
    return {
        "approved": len(node_ids),
        "node_ids": node_ids,
        "device_ids": approved_device_ids,
        "edges_created": len(all_edges),
        "edges": all_edges,
        "skipped": len(payload.device_ids) - len(node_ids),
    }


@router.post("/pending/bulk-hide", response_model=dict)
async def bulk_hide_devices(
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(PendingDevice).where(
            PendingDevice.id.in_(payload.device_ids),
            PendingDevice.status == "pending",
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
    device = await db.get(PendingDevice, device_id)
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
        select(PendingDevice).where(
            PendingDevice.id.in_(payload.device_ids),
            PendingDevice.status == "hidden",
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

    device = await db.get(PendingDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.status != "pending":
        raise HTTPException(status_code=409, detail="Device already processed")
    device.status = "approved"
    _is_zigbee = node_data.type in _ZIGBEE_TYPES
    # Prefer the MAC discovered during the scan (stored on the pending device);
    # fall back to whatever the approve payload carried.
    _mac = device.mac or node_data.mac
    node = Node(
        label=node_data.label,
        type=node_data.type,
        ip=node_data.ip,
        mac=_mac,
        hostname=node_data.hostname,
        status="online" if _is_zigbee else node_data.status,
        services=node_data.services or [],
        ieee_address=device.ieee_address,
        properties=build_zigbee_properties(
            device.ieee_address, device.vendor, device.model, device.lqi
        ) if _is_zigbee else merge_mac_property(node_data.properties, _mac),
        check_method="none" if _is_zigbee else (node_data.check_method or ("ping" if node_data.ip else None)),
        check_target=None if _is_zigbee else node_data.check_target,
        design_id=node_design_id,
    )
    db.add(node)
    await db.flush()
    node_id = node.id

    edges = await _resolve_pending_links_for_ieee(db, device.ieee_address)

    await db.commit()
    return {
        "approved": True,
        "node_id": node_id,
        "edges_created": len(edges),
        "edges": edges,
    }


async def _resolve_pending_links_for_ieee(
    db: AsyncSession, ieee: str | None
) -> list[dict[str, str]]:
    """Materialize edges for any pending_device_links involving ``ieee``.

    For each link where the other endpoint already exists as a canvas Node
    (matched by ``Node.ieee_address``), create the Edge and drop the link
    row. Links where the other endpoint is still pending are kept so they
    can resolve when that endpoint is approved later.
    """
    if not ieee:
        return []

    links_q = await db.execute(
        select(PendingDeviceLink).where(
            (PendingDeviceLink.source_ieee == ieee)
            | (PendingDeviceLink.target_ieee == ieee)
        )
    )
    links = list(links_q.scalars().all())
    if not links:
        return []

    # Map every relevant ieee → Node (single query).
    other_ieees = {
        link.target_ieee if link.source_ieee == ieee else link.source_ieee
        for link in links
    }
    other_ieees.add(ieee)
    nodes_q = await db.execute(
        select(Node).where(Node.ieee_address.in_(other_ieees))
    )
    by_ieee = {n.ieee_address: n for n in nodes_q.scalars().all() if n.ieee_address}

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
        # Skip if either direction already exists.
        if (src_id, tgt_id) in existing_pairs or (tgt_id, src_id) in existing_pairs:
            await db.delete(link)
            continue
        # Use the source node's design_id for the edge
        edge_design_id = self_node.design_id if self_node else None
        if edge_design_id is None:
            first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
            edge_design_id = first.id if first else None
        edge = Edge(
            source=src_id,
            target=tgt_id,
            type="iot",
            source_handle="bottom",
            target_handle="top-t",
            design_id=edge_design_id,
        )
        db.add(edge)
        await db.flush()
        existing_pairs.add((src_id, tgt_id))
        created.append({"id": edge.id, "source": src_id, "target": tgt_id})
        await db.delete(link)

    return created


@router.post("/pending/{device_id}/hide")
async def hide_device(
    device_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    device = await db.get(PendingDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.status = "hidden"
    await db.commit()
    return {"hidden": True}


@router.post("/pending/{device_id}/ignore")
async def ignore_device(
    device_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool]:
    device = await db.get(PendingDevice, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()
    return {"ignored": True}


@router.get("/runs", response_model=list[ScanRunResponse])
async def list_runs(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)) -> list[ScanRun]:
    result = await db.execute(select(ScanRun).order_by(ScanRun.started_at.desc()).limit(20))
    return list(result.scalars().all())


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
