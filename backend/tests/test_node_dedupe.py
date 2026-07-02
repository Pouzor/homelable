"""Tests for the same-canvas node dedupe repair (app.services.node_dedupe)."""

import pytest
from sqlalchemy import select

from app.db.models import Design, Edge, Node
from app.services.node_dedupe import dedupe_nodes_by_ieee


async def _design(db, name="d1"):
    d = Design(name=name)
    db.add(d)
    await db.flush()
    return d


@pytest.mark.asyncio
async def test_collapses_same_ieee_same_design(db_session):
    d = await _design(db_session)
    keep = Node(
        label="Sensor", type="zigbee_enddevice", design_id=d.id,
        ieee_address="0xAAA", properties=[{"key": "IEEE", "value": "0xAAA", "visible": True}],
        pos_x=100, pos_y=200,
    )
    db_session.add(keep)
    await db_session.flush()
    dup = Node(
        label="Sensor", type="zigbee_enddevice", design_id=d.id,
        ieee_address="0xAAA", ip="10.0.0.5",
        properties=[{"key": "LQI", "value": "88", "visible": False}],
    )
    db_session.add(dup)
    await db_session.flush()

    removed = await dedupe_nodes_by_ieee(db_session)
    assert removed == 1

    nodes = (await db_session.execute(select(Node).where(Node.ieee_address == "0xAAA"))).scalars().all()
    assert len(nodes) == 1
    survivor = nodes[0]
    assert survivor.id == keep.id          # oldest kept
    assert survivor.pos_x == 100           # canvas position preserved
    assert survivor.ip == "10.0.0.5"       # missing field filled from dup
    keys = {p["key"] for p in survivor.properties}
    assert keys == {"IEEE", "LQI"}         # properties merged


@pytest.mark.asyncio
async def test_preserves_same_ieee_across_designs(db_session):
    """Same device on two canvases is valid — must NOT be merged."""
    d1 = await _design(db_session, "d1")
    d2 = await _design(db_session, "d2")
    for d in (d1, d2):
        db_session.add(Node(label="S", type="zigbee_enddevice", design_id=d.id, ieee_address="0xBBB"))
    await db_session.flush()

    removed = await dedupe_nodes_by_ieee(db_session)
    assert removed == 0

    nodes = (await db_session.execute(select(Node).where(Node.ieee_address == "0xBBB"))).scalars().all()
    assert len(nodes) == 2


@pytest.mark.asyncio
async def test_repoints_edges_and_drops_dupes(db_session):
    d = await _design(db_session)
    keep = Node(label="A", type="server", design_id=d.id, ieee_address="0xCCC")
    dup = Node(label="A", type="server", design_id=d.id, ieee_address="0xCCC")
    other = Node(label="B", type="server", design_id=d.id)
    db_session.add_all([keep, other])
    await db_session.flush()
    db_session.add(dup)
    await db_session.flush()

    # keep<->other and dup<->other (parallel after repoint), plus dup<->keep (self-loop).
    db_session.add_all([
        Edge(source=keep.id, target=other.id, type="ethernet", design_id=d.id),
        Edge(source=dup.id, target=other.id, type="ethernet", design_id=d.id),
        Edge(source=dup.id, target=keep.id, type="ethernet", design_id=d.id),
    ])
    await db_session.flush()

    removed = await dedupe_nodes_by_ieee(db_session)
    assert removed == 1

    edges = (await db_session.execute(select(Edge))).scalars().all()
    # self-loop dropped, parallel edge collapsed -> a single keep<->other edge
    assert len(edges) == 1
    e = edges[0]
    assert {e.source, e.target} == {keep.id, other.id}


@pytest.mark.asyncio
async def test_repoints_child_parent(db_session):
    d = await _design(db_session)
    keep = Node(label="Host", type="proxmox", design_id=d.id, ieee_address="0xDDD")
    dup = Node(label="Host", type="proxmox", design_id=d.id, ieee_address="0xDDD")
    db_session.add(keep)
    await db_session.flush()
    db_session.add(dup)
    await db_session.flush()
    child = Node(label="VM", type="vm", design_id=d.id, parent_id=dup.id)
    db_session.add(child)
    await db_session.flush()

    await dedupe_nodes_by_ieee(db_session)
    await db_session.refresh(child)
    assert child.parent_id == keep.id


@pytest.mark.asyncio
async def test_idempotent_noop_when_unique(db_session):
    d = await _design(db_session)
    db_session.add(Node(label="X", type="server", design_id=d.id, ieee_address="0xEEE"))
    await db_session.flush()
    assert await dedupe_nodes_by_ieee(db_session) == 0
    assert await dedupe_nodes_by_ieee(db_session) == 0
