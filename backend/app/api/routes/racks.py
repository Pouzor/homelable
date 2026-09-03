from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Design, InventoryDevice, Node, Rack, RackCable, RackDevice
from app.schemas.racks import (
    RACK_COLUMNS,
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


def _rack_model(device: InventoryDevice) -> dict[str, Any] | None:
    """The rack modelisation the inventory row owns, or None when never modelled.

    `rack_faceplate_id` is the flag: a device that has never been mounted (or was
    mounted before this became inventory-owned) carries NULL, and the mount's own
    denormalized copy then stands unchanged.
    """
    if not device.rack_faceplate_id:
        return None
    return {
        "faceplate_id": device.rack_faceplate_id,
        "u_height": device.rack_u_height,
        "col_span": device.rack_col_span,
        "color": device.rack_color,
        "ports": [p for p in (device.rack_ports or []) if isinstance(p, dict) and p.get("id")],
    }


# A mount's footprint in the rack grid: (u_start, u_height, col_start, col_span).
_Box = tuple[int, int, int, int]


def _height_fits(u_start: int, u_height: int | None, rack_u_height: int | None) -> bool:
    """Whether a mount of that height, starting there, stays under the top rail."""
    if not u_height:
        return False
    return rack_u_height is None or u_start + u_height - 1 <= rack_u_height


def _span_fits(col_start: int, col_span: int | None) -> bool:
    """Whether a mount of that width, starting there, stays inside the grid."""
    if not col_span:
        return False
    return col_start + col_span <= RACK_COLUMNS


def _overlaps(box: _Box, others: Sequence[_Box]) -> bool:
    """Whether a footprint (u_start, u_height, col_start, col_span) hits any other."""
    u_start, u_height, col_start, col_span = box
    return any(
        u_start < o_u + o_uh
        and o_u < u_start + u_height
        and col_start < o_c + o_cs
        and o_c < col_start + col_span
        for o_u, o_uh, o_c, o_cs in others
    )


def _with_model(
    device: RackDevice,
    model: dict[str, Any] | None,
    rack_u_height: int | None,
    neighbours: Sequence[_Box] = (),
) -> RackDeviceResponse:
    """Overlay the inventory's rack modelisation onto a mount for the response.

    Geometry is global, but a rack is not: a device grown to 4U in one rack may no
    longer fit where it sits in another. Height and width are therefore applied
    only when they still fit at the mount's own `u_start` / `col_start` *and* the
    bigger footprint lands on no neighbour — the placement rule the canvas itself
    enforces, and one a plain rail check misses: a 4U model overlaid on a mount
    with a device one U above it would draw two plates on the same U, and save
    back in that state. The plate, its colour and its ports always are, since
    none of them can overflow anything.
    """
    row = RackDeviceResponse.model_validate(device)
    if model is None:
        return row
    patch: dict[str, Any] = {
        "faceplate_id": model["faceplate_id"],
        "ports": model["ports"],
        "color": model["color"],
    }
    u_height = row.u_height
    if _height_fits(row.u_start, model["u_height"], rack_u_height) and not _overlaps(
        (row.u_start, model["u_height"], row.col_start, row.col_span), neighbours
    ):
        u_height = model["u_height"]
        patch["u_height"] = u_height
    if _span_fits(row.col_start, model["col_span"]) and not _overlaps(
        (row.u_start, u_height, row.col_start, model["col_span"]), neighbours
    ):
        patch["col_span"] = model["col_span"]
    return row.model_copy(update=patch)


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

    # The inventory row owns the front panel, so it wins over the mount's copy.
    inventory_ids = {d.device_id for d in devices if d.device_id}
    models: dict[str, dict[str, Any]] = {}
    if inventory_ids:
        rows = (
            await db.execute(
                select(InventoryDevice).where(InventoryDevice.id.in_(inventory_ids))
            )
        ).scalars().all()
        for row in rows:
            model = _rack_model(row)
            if model is not None:
                models[row.id] = model
    heights = {r.id: r.u_height for r in racks}

    # An overlaid size must not land on the mount above. Footprints start as
    # persisted and are replaced by what the overlay actually applied, so a rack
    # of devices that all grew elsewhere resolves in one deterministic pass
    # instead of each one being measured against stale neighbours.
    boxes: dict[str, _Box] = {
        d.id: (d.u_start, d.u_height, d.col_start, d.col_span) for d in devices
    }
    mounted: list[RackDeviceResponse] = []
    for d in devices:
        placed = _with_model(
            d,
            models.get(d.device_id or ""),
            heights.get(d.rack_id),
            [boxes[o.id] for o in devices if o.id != d.id and o.rack_id == d.rack_id],
        )
        boxes[d.id] = (placed.u_start, placed.u_height, placed.col_start, placed.col_span)
        mounted.append(placed)

    return RackStateResponse(
        racks=[RackResponse.model_validate(r) for r in racks],
        devices=mounted,
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
        # The size this mount held before the save, to tell a real resize from an
        # echo of what the load handed out. See the write-through below.
        was = (db_device.u_height, db_device.col_span) if db_device else None
        if db_device:
            for field, value in payload.items():
                setattr(db_device, field, value)
        else:
            db.add(RackDevice(**payload))

        # Write-through: the device's front panel belongs to the inventory row,
        # not to this mount, so every rack showing the same device picks the
        # change up on its next load. Accessories have no row and keep theirs.
        if device_data.device_id:
            entry = await db.get(InventoryDevice, device_data.device_id)
            if entry is not None:
                entry.rack_faceplate_id = device_data.faceplate_id
                entry.rack_color = device_data.color
                entry.rack_ports = [p for p in device_data.ports if isinstance(p, dict)]
                # Size, unlike the plate, is not written back blind. The load
                # overlays it only where it still fits this rack, so a mount can
                # legitimately hold less than the row does — and saving that back
                # would shrink the device in every other rack. Only a size this
                # save actually changes travels; an unchanged one is an echo.
                if was is None or device_data.u_height != was[0]:
                    entry.rack_u_height = device_data.u_height
                if was is None or device_data.col_span != was[1]:
                    entry.rack_col_span = device_data.col_span
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

    # Correlate against canvas nodes: a node names the inventory row it draws,
    # so the IEEE/IP guessing this used to do is gone — the link is explicit.
    nodes = (await db.execute(select(Node))).scalars().all()
    by_id = {n.id: n for n in nodes}
    by_device: dict[str, Node] = {}
    for node in nodes:
        if node.device_id:
            by_device.setdefault(node.device_id, node)
    # Which canvas the matched node lives on — the rack prints it so the user
    # knows where the logical twin of a mount is drawn.
    design_names = {
        d.id: d.name for d in (await db.execute(select(Design))).scalars().all()
    }

    # A pinned node may draw a *different* device than the mount names, so its
    # view is read off its own row.
    devices_by_id = {d.id: d for d in devices}

    items = []
    for device in devices:
        if device.suggested_type in _UNRACKABLE_TYPES:
            continue
        # A node the user linked by hand wins; a deleted one falls back to the
        # node that draws this device, if any.
        linked: Node | None = by_id.get(pinned.get(device.id) or "") or by_device.get(device.id)
        # The logical view is whatever the linked node actually draws. Usually
        # that is this same row — the node_* fields then simply mirror it.
        node_device = None
        if linked is not None:
            node_device = devices_by_id.get(linked.device_id or "")
            if node_device is None and linked.device_id:
                node_device = await db.get(InventoryDevice, linked.device_id)
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
                services=_services(device.services),
                node_id=linked.id if linked else None,
                node_status=node_device.status_live if node_device else None,
                node_label=(
                    (node_device.label if node_device else None) or linked.label
                ) if linked else None,
                node_type=(
                    (node_device.type if node_device else None) or linked.type
                ) if linked else None,
                node_ip=node_device.ip if node_device else None,
                node_mac=(node_device.mac or node_device.ieee_address) if node_device else None,
                node_hostname=node_device.hostname if node_device else None,
                node_os=node_device.os if node_device else None,
                node_check_method=node_device.check_method if node_device else None,
                node_design_id=linked.design_id if linked else None,
                node_design_name=(
                    design_names.get(linked.design_id) if linked and linked.design_id else None
                ),
                node_last_seen=node_device.last_seen if node_device else None,
                racked=device.id in mounted,
                rack_faceplate_id=device.rack_faceplate_id,
                rack_u_height=device.rack_u_height,
                rack_col_span=device.rack_col_span,
                rack_color=device.rack_color,
                rack_ports=device.rack_ports or [],
            )
        )
    return RackInventoryResponse(items=items)
