from datetime import datetime, timezone
from typing import Any, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Design, InventoryDevice, Node, Rack, RackCable, RackDevice
from app.schemas.racks import (
    RackCableResponse,
    RackDeviceResponse,
    RackInventoryItem,
    RackInventoryResponse,
    RackResponse,
    RackSaveRequest,
    RackServiceInfo,
    RackStateResponse,
)

router = APIRouter()

# Device kinds that cannot be racked. An exclusion list rather than an allow list:
# new hardware types should show up in the tray by default, and only the obviously
# virtual / mesh / annotation kinds need to opt out.
_UNRACKABLE_TYPES = {
    "vm",
    "lxc",
    "docker_container",
    "mobile",
    "laptop",
    "light",
    "socket",
    "load",
    "groupRect",
    "group",
    "text",
    "zigbee_coordinator",
    "zigbee_router",
    "zigbee_enddevice",
    "zwave_coordinator",
    "zwave_router",
    "zwave_enddevice",
}


_COMMON_PORTS = {22, 80, 443}


def _service_name(device: InventoryDevice) -> str | None:
    """Name a device after the app it runs, the way the Device Inventory does.

    Ports everyone exposes (ssh, http, https) say nothing, and the generic web
    category loses to a real match, so "jellyfin" wins over "http".
    """
    candidates = [
        s
        for s in (device.services or [])
        if isinstance(s, dict)
        and s.get("category")
        and s.get("service_name")
        # A service with no port is not a fingerprint the inventory names a
        # device after either — and `None not in _COMMON_PORTS` is True.
        and s.get("port") is not None
        and s.get("port") not in _COMMON_PORTS
    ]
    if not candidates:
        return None
    named = next((s for s in candidates if str(s["category"]).lower() != "web"), candidates[0])
    name = named.get("service_name")
    return str(name) if name else None


def _device_label(device: InventoryDevice) -> str:
    """Inventory naming, mirrored: friendly name, host, app, IP, IEEE, id.

    Must stay in step with `deviceLabel` in `InventoryDevicesModal.tsx` — a device
    the user picked out of the inventory by one name should not turn up in the
    rack picker under another.
    """
    return (
        device.friendly_name
        or device.hostname
        or _service_name(device)
        or device.ip
        or device.ieee_address
        or device.id
    )


# A mount prints its services as a short list, not a port scan dump.
_MAX_SERVICES = 12


def _services(raw: Any) -> list[RackServiceInfo]:
    """Fingerprinted services, deduped and trimmed for the rack's info panel."""
    out: list[RackServiceInfo] = []
    seen: set[tuple[int | None, str | None]] = set()
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        raw_port = entry.get("port")
        port = raw_port if isinstance(raw_port, int) else None
        raw_name = entry.get("service_name") or entry.get("name")
        name = str(raw_name) if raw_name else None
        if port is None and name is None:
            continue
        if (port, name) in seen:
            continue
        seen.add((port, name))
        out.append(RackServiceInfo(port=port, name=name))
        if len(out) == _MAX_SERVICES:
            break
    return out


def _ip_tokens(ip: str | None) -> list[str]:
    """Split a device ``ip`` field into individual addresses.

    Mirrors the scan routes: the canvas stores multiple addresses in one
    comma-separated string, so matching must compare per-address.
    """
    return [t.strip() for t in ip.split(",") if t.strip()] if ip else []


_Row = TypeVar("_Row", Rack, RackDevice, RackCable)


async def _owned(
    db: AsyncSession, model: type[_Row], row_id: str, design_id: str
) -> _Row | None:
    """Fetch a rack row by id, refusing one that belongs to another design.

    The upsert below sets `design_id` from the payload, so without this a save
    carrying an id from design A would quietly move A's rack — devices and
    cables included — into design B, and A would lose it with no error. Ids come
    from the client, so a copied design or a stale tab is enough to collide.
    """
    row = await db.get(model, row_id)
    if row is not None and row.design_id != design_id:
        raise HTTPException(409, f"{model.__name__} {row_id} belongs to another design")
    return row


async def _require_design(db: AsyncSession, design_id: str) -> Design:
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")
    return design


@router.get("", response_model=RackStateResponse)
async def load_racks(
    design_id: str = Query(..., description="Rack design to load"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> RackStateResponse:
    await _require_design(db, design_id)

    racks = (await db.execute(select(Rack).where(Rack.design_id == design_id))).scalars().all()
    devices = (
        await db.execute(select(RackDevice).where(RackDevice.design_id == design_id))
    ).scalars().all()
    cables = (await db.execute(select(RackCable).where(RackCable.design_id == design_id))).scalars().all()
    state = await db.get(CanvasState, design_id)

    return RackStateResponse(
        racks=[RackResponse.model_validate(r) for r in racks],
        devices=[RackDeviceResponse.model_validate(d) for d in devices],
        cables=[RackCableResponse.model_validate(c) for c in cables],
        viewport=state.viewport if state else {"x": 0, "y": 0, "zoom": 1},
    )


@router.post("/save")
async def save_racks(
    body: RackSaveRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, bool]:
    """Persist the full rack state of one design: upsert what is sent, prune the rest."""
    await _require_design(db, body.design_id)

    rack_ids = {r.id for r in body.racks}
    device_ids = {d.id for d in body.devices}

    # A device must land in a rack that is part of the same payload, and a cable
    # must join two devices in it — otherwise the prune below would orphan them.
    for device in body.devices:
        if device.rack_id not in rack_ids:
            raise HTTPException(400, f"Device {device.id} references unknown rack {device.rack_id}")
    for cable in body.cables:
        if cable.from_device_id not in device_ids or cable.to_device_id not in device_ids:
            raise HTTPException(400, f"Cable {cable.id} references a device outside this payload")

    # Prune first (cables, then devices, then racks) so freed rows never collide
    # with an upsert that reuses their geometry.
    for existing_cable in (
        await db.execute(select(RackCable).where(RackCable.design_id == body.design_id))
    ).scalars().all():
        if existing_cable.id not in {c.id for c in body.cables}:
            await db.delete(existing_cable)
    for existing_device in (
        await db.execute(select(RackDevice).where(RackDevice.design_id == body.design_id))
    ).scalars().all():
        if existing_device.id not in device_ids:
            await db.delete(existing_device)
    for existing_rack in (
        await db.execute(select(Rack).where(Rack.design_id == body.design_id))
    ).scalars().all():
        if existing_rack.id not in rack_ids:
            await db.delete(existing_rack)
    await db.flush()

    for rack_data in body.racks:
        payload: dict[str, Any] = rack_data.model_dump()
        payload["design_id"] = body.design_id
        db_rack = await _owned(db, Rack, rack_data.id, body.design_id)
        if db_rack:
            for field, value in payload.items():
                setattr(db_rack, field, value)
        else:
            db.add(Rack(**payload))
    await db.flush()  # racks must exist before devices point at them

    for device_data in body.devices:
        payload = device_data.model_dump()
        payload["design_id"] = body.design_id
        db_device = await _owned(db, RackDevice, device_data.id, body.design_id)
        if db_device:
            for field, value in payload.items():
                setattr(db_device, field, value)
        else:
            db.add(RackDevice(**payload))
    await db.flush()  # devices must exist before cables point at them

    for cable_data in body.cables:
        payload = cable_data.model_dump()
        payload["design_id"] = body.design_id
        db_cable = await _owned(db, RackCable, cable_data.id, body.design_id)
        if db_cable:
            for field, value in payload.items():
                setattr(db_cable, field, value)
        else:
            db.add(RackCable(**payload))

    # Viewport lives on the design's shared CanvasState row, like the logical canvas.
    state = await db.get(CanvasState, body.design_id)
    if state:
        state.viewport = body.viewport
        state.saved_at = datetime.now(timezone.utc)
    else:
        db.add(CanvasState(design_id=body.design_id, viewport=body.viewport))

    await db.commit()
    return {"saved": True}


@router.get("/inventory", response_model=RackInventoryResponse)
async def rack_inventory(
    design_id: str = Query(..., description="Rack design the tray is for"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> RackInventoryResponse:
    """Device Inventory entries that can be racked, flagged with what is already mounted.

    Reads `device_inventory` — the inventory survives approval and node deletion,
    so unracking or deleting a canvas node never removes the entry here.
    """
    await _require_design(db, design_id)

    devices = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.status != "hidden"))
    ).scalars().all()
    mounts = (
        await db.execute(
            select(RackDevice.device_id, RackDevice.node_id).where(
                RackDevice.design_id == design_id
            )
        )
    ).all()
    mounted = {device_id for device_id, _ in mounts if device_id}
    # A mount can name its canvas node itself, when the user linked one by hand
    # in the rack. That beats the IEEE/IP guess below: the guess is what failed
    # to find anything in the first place.
    pinned = {device_id: node_id for device_id, node_id in mounts if device_id and node_id}

    # Correlate against canvas nodes for live status: IEEE first (stable), then IP.
    nodes = (await db.execute(select(Node))).scalars().all()
    by_id = {n.id: n for n in nodes}
    by_ieee = {n.ieee_address: n for n in nodes if n.ieee_address}
    by_ip: dict[str, Node] = {}
    for node in nodes:
        for token in _ip_tokens(node.ip):
            by_ip.setdefault(token, node)
    # Which canvas the matched node lives on — the rack prints it so the user
    # knows where the logical twin of a mount is drawn.
    design_names = {
        d.id: d.name for d in (await db.execute(select(Design))).scalars().all()
    }

    items = []
    for device in devices:
        if device.suggested_type in _UNRACKABLE_TYPES:
            continue
        # A node the user linked by hand wins; a deleted one falls back to the
        # guess rather than reporting a node that no longer exists.
        linked: Node | None = by_id.get(pinned.get(device.id) or "")
        if linked is None and device.ieee_address:
            linked = by_ieee.get(device.ieee_address)
        if linked is None:
            linked = next((by_ip[t] for t in _ip_tokens(device.ip) if t in by_ip), None)
        # The node is the richer record once a device has been approved onto a
        # canvas; the inventory row is what discovery last saw. Report both and
        # let the panel prefer the node.
        services = _services(device.services) or (
            _services(linked.services) if linked else []
        )
        items.append(
            RackInventoryItem(
                id=device.id,
                label=_device_label(device),
                suggested_type=device.suggested_type,
                ip=device.ip,
                status=device.status,
                discovery_source=device.discovery_source,
                mac=device.mac or device.ieee_address,
                hostname=device.hostname,
                os=device.os,
                services=services,
                node_id=linked.id if linked else None,
                node_status=linked.status if linked else None,
                node_label=linked.label if linked else None,
                node_type=linked.type if linked else None,
                node_ip=linked.ip if linked else None,
                node_mac=(linked.mac or linked.ieee_address) if linked else None,
                node_hostname=linked.hostname if linked else None,
                node_os=linked.os if linked else None,
                node_check_method=linked.check_method if linked else None,
                node_design_id=linked.design_id if linked else None,
                node_design_name=(
                    design_names.get(linked.design_id) if linked and linked.design_id else None
                ),
                node_last_seen=linked.last_seen if linked else None,
                racked=device.id in mounted,
            )
        )
    return RackInventoryResponse(items=items)
