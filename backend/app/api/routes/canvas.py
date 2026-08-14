import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import CanvasState, Design, Edge, Node
from app.schemas.canvas import CanvasSaveRequest, CanvasStateResponse
from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse
from app.services.inventory_sync import (
    facts_from_payload,
    hydrated_node,
    link_facts,
    load_devices_for,
    node_columns,
)

router = APIRouter()


@router.get("", response_model=CanvasStateResponse)
async def load_canvas(
    design_id: str | None = Query(None, description="Design ID to load; uses first design if omitted"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> CanvasStateResponse:
    if design_id is None:
        first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        design_id = first.id if first else None
    if design_id is None:
        return CanvasStateResponse(nodes=[], edges=[], viewport={"x": 0, "y": 0, "zoom": 1}, custom_style=None)

    nodes = list((await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all())
    edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    state = await db.get(CanvasState, design_id)
    viewport: dict[str, Any] = state.viewport if state else {"x": 0, "y": 0, "zoom": 1}
    # The device facts live on the inventory row now; hydrate them back into the
    # node so the wire shape the canvas consumes is unchanged.
    devices = await load_devices_for(db, nodes)
    return CanvasStateResponse(
        nodes=[NodeResponse.model_validate(hydrated_node(n, devices.get(n.device_id or ""))) for n in nodes],
        edges=[EdgeResponse.model_validate(e) for e in edges],
        viewport=viewport,
        custom_style=state.custom_style if state else None,
        # A CanvasState row exists only after a save (or explicit design create),
        # so its presence marks an intentional canvas vs. a never-touched one.
        initialized=state is not None,
    )


@router.post("/save")
async def save_canvas(
    body: CanvasSaveRequest, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
) -> dict[str, bool | str]:
    design_id = body.design_id
    if design_id is None:
        first = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
        design_id = first.id if first else None
    if design_id is None:
        new_design = Design(id=str(uuid.uuid4()), name="Network Topology", design_type="network")
        db.add(new_design)
        await db.flush()
        design_id = new_design.id

    incoming_node_ids = {n.id for n in body.nodes}
    incoming_edge_ids = {e.id for e in body.edges}

    # Delete nodes removed from canvas (only within this design)
    existing_nodes = (await db.execute(select(Node).where(Node.design_id == design_id))).scalars().all()
    for node in existing_nodes:
        if node.id not in incoming_node_ids:
            await db.delete(node)

    # Delete edges removed from canvas (only within this design)
    existing_edges = (await db.execute(select(Edge).where(Edge.design_id == design_id))).scalars().all()
    for edge in existing_edges:
        if edge.id not in incoming_edge_ids:
            await db.delete(edge)

    await db.flush()

    # Upsert nodes, then route their device facts to the inventory row that owns
    # them — an edit made on this canvas is an edit to the device itself, and
    # every other canvas showing it follows.
    saved: list[tuple[Node, dict[str, Any], list[str] | None]] = []
    for node_data in body.nodes:
        db_node = await db.get(Node, node_data.id)
        payload = node_data.model_dump()
        payload["design_id"] = design_id
        facts = facts_from_payload(payload, label=node_data.label, node_type=node_data.type)
        columns = node_columns(payload)
        if db_node:
            for field, value in columns.items():
                setattr(db_node, field, value)
        else:
            db_node = Node(**columns)
            db.add(db_node)
        saved.append((db_node, facts, node_data.changed_facts))

    await db.flush()
    for node, facts, changed in saved:
        # The payload carries a full copy of each device, hydrated when this
        # canvas loaded. Routing all of it back would rewrite the row from a
        # stale snapshot — a save made for nothing but a moved node could revert
        # an edit meanwhile in the inventory modal. `changed_facts` (when the
        # client tracked it) plus the row diff narrow the write to this canvas'
        # actual edit.
        await link_facts(
            db,
            node,
            facts,
            overwrite_scalars=True,
            replace_lists=True,
            only_changed=True,
            changed_fields=changed,
        )

    # Upsert edges
    for edge_data in body.edges:
        db_edge = await db.get(Edge, edge_data.id)
        payload = edge_data.model_dump()
        payload["design_id"] = design_id
        if db_edge:
            for field, value in payload.items():
                setattr(db_edge, field, value)
        else:
            db.add(Edge(**payload))

    # Upsert viewport + custom style
    state = await db.get(CanvasState, design_id)
    if state:
        state.viewport = body.viewport
        state.custom_style = body.custom_style
        state.saved_at = datetime.now(timezone.utc)
    else:
        db.add(CanvasState(design_id=design_id, viewport=body.viewport, custom_style=body.custom_style))

    await db.commit()
    return {"saved": True}
