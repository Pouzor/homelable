import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Design, Edge, Node, Rack, RackCable, RackDevice
from app.schemas.designs import DesignCopy, DesignCreate, DesignResponse, DesignUpdate

router = APIRouter()

# Node.type values that are canvas annotations rather than real devices. Kept in
# sync with the frontend (Sidebar counts, canvasSerializer types).
_GROUP_TYPE = "groupRect"
_TEXT_TYPE = "text"


@router.get("", response_model=list[DesignResponse])
async def list_designs(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[DesignResponse]:
    designs = (await db.execute(select(Design).order_by(Design.created_at))).scalars().all()
    # One grouped query for all designs → node/group/text counts per design.
    rows = (
        await db.execute(select(Node.design_id, Node.type, func.count()).group_by(Node.design_id, Node.type))
    ).all()
    counts: dict[str, dict[str, int]] = {}
    for design_id, node_type, count in rows:
        if design_id is None:
            continue
        bucket = counts.setdefault(design_id, {"node": 0, "group": 0, "text": 0})
        if node_type == _GROUP_TYPE:
            bucket["group"] += count
        elif node_type == _TEXT_TYPE:
            bucket["text"] += count
        else:
            bucket["node"] += count

    result = []
    for d in designs:
        resp = DesignResponse.model_validate(d)
        c = counts.get(d.id, {"node": 0, "group": 0, "text": 0})
        resp.node_count = c["node"]
        resp.group_count = c["group"]
        resp.text_count = c["text"]
        result.append(resp)
    return result


@router.post("", response_model=DesignResponse, status_code=201)
async def create_design(
    body: DesignCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DesignResponse:
    design = Design(name=body.name, design_type=body.design_type, icon=body.icon)
    db.add(design)
    await db.flush()
    # Create empty canvas state for the new design
    db.add(CanvasState(design_id=design.id))
    await db.commit()
    await db.refresh(design)
    return DesignResponse.model_validate(design)


@router.post("/{source_id}/copy", response_model=DesignResponse, status_code=201)
async def copy_design(
    source_id: str,
    body: DesignCopy,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DesignResponse:
    """Create a new design that deep-copies the source's nodes, edges and canvas state."""
    source = await db.get(Design, source_id)
    if not source:
        raise HTTPException(404, "Source design not found")

    new_design = Design(name=body.name, icon=body.icon, design_type=source.design_type)
    db.add(new_design)
    await db.flush()

    src_nodes = (await db.execute(select(Node).where(Node.design_id == source_id))).scalars().all()
    src_edges = (await db.execute(select(Edge).where(Edge.design_id == source_id))).scalars().all()

    # New id per source node so edges and parent links can be re-pointed at the copy.
    id_map = {n.id: str(uuid.uuid4()) for n in src_nodes}

    # Columns we set explicitly or let the DB default — never copy verbatim.
    node_skip = {"id", "design_id", "parent_id", "created_at", "updated_at"}
    for n in src_nodes:
        cols = {c.name: getattr(n, c.name) for c in Node.__table__.columns if c.name not in node_skip}
        db.add(Node(id=id_map[n.id], design_id=new_design.id, parent_id=None, **cols))
    await db.flush()  # nodes must exist before we wire self-referential parent_id

    # Second pass: re-point parent links inside the copy.
    for n in src_nodes:
        if n.parent_id and n.parent_id in id_map:
            child = await db.get(Node, id_map[n.id])
            if child:
                child.parent_id = id_map[n.parent_id]

    edge_skip = {"id", "design_id", "source", "target", "created_at"}
    for e in src_edges:
        # Skip edges whose endpoints aren't part of this design (dangling FKs).
        if e.source not in id_map or e.target not in id_map:
            continue
        cols = {c.name: getattr(e, c.name) for c in Edge.__table__.columns if c.name not in edge_skip}
        db.add(
            Edge(
                id=str(uuid.uuid4()),
                design_id=new_design.id,
                source=id_map[e.source],
                target=id_map[e.target],
                **cols,
            )
        )

    # Copy the rack canvas, if the source has one. Racks, mounted gear and patches
    # all get new ids; the inventory / node links are carried over untouched, since
    # a copy documents the same hardware.
    src_racks = (await db.execute(select(Rack).where(Rack.design_id == source_id))).scalars().all()
    rack_id_map = {r.id: str(uuid.uuid4()) for r in src_racks}
    rack_skip = {"id", "design_id", "created_at", "updated_at"}
    for r in src_racks:
        cols = {c.name: getattr(r, c.name) for c in Rack.__table__.columns if c.name not in rack_skip}
        db.add(Rack(id=rack_id_map[r.id], design_id=new_design.id, **cols))

    src_rack_devices = (
        await db.execute(select(RackDevice).where(RackDevice.design_id == source_id))
    ).scalars().all()
    rack_device_id_map = {d.id: str(uuid.uuid4()) for d in src_rack_devices}
    rack_device_skip = {"id", "design_id", "rack_id", "created_at", "updated_at"}
    for d in src_rack_devices:
        if d.rack_id not in rack_id_map:
            continue
        cols = {
            c.name: getattr(d, c.name)
            for c in RackDevice.__table__.columns
            if c.name not in rack_device_skip
        }
        db.add(
            RackDevice(
                id=rack_device_id_map[d.id],
                design_id=new_design.id,
                rack_id=rack_id_map[d.rack_id],
                **cols,
            )
        )

    src_cables = (await db.execute(select(RackCable).where(RackCable.design_id == source_id))).scalars().all()
    cable_skip = {"id", "design_id", "from_device_id", "to_device_id", "created_at"}
    for c_row in src_cables:
        if c_row.from_device_id not in rack_device_id_map or c_row.to_device_id not in rack_device_id_map:
            continue
        cols = {
            c.name: getattr(c_row, c.name) for c in RackCable.__table__.columns if c.name not in cable_skip
        }
        db.add(
            RackCable(
                id=str(uuid.uuid4()),
                design_id=new_design.id,
                from_device_id=rack_device_id_map[c_row.from_device_id],
                to_device_id=rack_device_id_map[c_row.to_device_id],
                **cols,
            )
        )

    # Copy canvas state (viewport, custom style, and the floor plan carried in viewport).
    src_state = await db.get(CanvasState, source_id)
    db.add(
        CanvasState(
            design_id=new_design.id,
            viewport=src_state.viewport if src_state else {},
            custom_style=src_state.custom_style if src_state else None,
        )
    )

    await db.commit()
    await db.refresh(new_design)
    return DesignResponse.model_validate(new_design)


@router.put("/{design_id}", response_model=DesignResponse)
async def update_design(
    design_id: str,
    body: DesignUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DesignResponse:
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")
    if body.name is not None:
        design.name = body.name
    if body.icon is not None:
        design.icon = body.icon
    await db.commit()
    await db.refresh(design)
    return DesignResponse.model_validate(design)


@router.delete("/{design_id}", status_code=204)
async def delete_design(
    design_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> None:
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")
    # Count remaining designs — prevent deleting the last one
    count = (await db.execute(select(Design))).scalars().all()
    if len(count) <= 1:
        raise HTTPException(400, "Cannot delete the only design")
    # Delete associated canvas state, rack rows, edges, nodes. SQLite does not
    # always enforce the ON DELETE CASCADE, so unwind by hand — cables before
    # devices before racks.
    cs = await db.get(CanvasState, design_id)
    if cs:
        await db.delete(cs)
    for cable in (await db.execute(select(RackCable).where(RackCable.design_id == design_id))).scalars().all():
        await db.delete(cable)
    for rack_device in (
        await db.execute(select(RackDevice).where(RackDevice.design_id == design_id))
    ).scalars().all():
        await db.delete(rack_device)
    for rack in (await db.execute(select(Rack).where(Rack.design_id == design_id))).scalars().all():
        await db.delete(rack)
    edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    for e in edges:
        await db.delete(e)
    nodes = (await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all()
    for n in nodes:
        await db.delete(n)
    await db.delete(design)
    await db.commit()
