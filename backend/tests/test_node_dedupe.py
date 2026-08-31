"""Tests for the same-canvas node dedupe repair (app.services.node_dedupe).

Identity is the device link now: two nodes are duplicates when they draw the
same `device_inventory` row on the same design. The device facts live on that
row, so nothing has to be merged out of the extras before they go — only edges
and parent links are re-pointed.
"""

import pytest
from sqlalchemy import select

from app.db.models import Design, Edge, InventoryDevice, Node
from app.services.node_dedupe import dedupe_nodes_by_device


async def _design(db, name="d1"):
    d = Design(name=name)
    db.add(d)
    await db.flush()
    return d


async def _device(db, ieee="0xAAA", **kwargs):
    device = InventoryDevice(ieee_address=ieee, status="approved", **kwargs)
    db.add(device)
    await db.flush()
    return device


@pytest.mark.asyncio
async def test_collapses_same_device_same_design(db_session):
    d = await _design(db_session)
    device = await _device(db_session)
    keep = Node(
        label="Sensor", type="zigbee_enddevice", design_id=d.id,
        device_id=device.id, pos_x=100, pos_y=200,
    )
    db_session.add(keep)
    await db_session.flush()
    dup = Node(label="Sensor", type="zigbee_enddevice", design_id=d.id, device_id=device.id)
    db_session.add(dup)
    await db_session.flush()

    removed = await dedupe_nodes_by_device(db_session)
    assert removed == 1

    nodes = (
        await db_session.execute(select(Node).where(Node.device_id == device.id))
    ).scalars().all()
    assert len(nodes) == 1
    survivor = nodes[0]
    assert survivor.id == keep.id          # oldest kept
    assert survivor.pos_x == 100           # canvas position preserved
    # The device facts were never on the node, so none can be lost here.
    assert await db_session.get(InventoryDevice, device.id) is not None


@pytest.mark.asyncio
async def test_preserves_same_device_across_designs(db_session):
    """Same device on two canvases is valid — must NOT be merged."""
    d1 = await _design(db_session, "d1")
    d2 = await _design(db_session, "d2")
    device = await _device(db_session, ieee="0xBBB")
    for d in (d1, d2):
        db_session.add(Node(label="S", type="zigbee_enddevice", design_id=d.id, device_id=device.id))
    await db_session.flush()

    removed = await dedupe_nodes_by_device(db_session)
    assert removed == 0

    nodes = (
        await db_session.execute(select(Node).where(Node.device_id == device.id))
    ).scalars().all()
    assert len(nodes) == 2


@pytest.mark.asyncio
async def test_leaves_furniture_alone(db_session):
    """Zones and text carry no device link, so they are never duplicates."""
    d = await _design(db_session)
    for _ in range(2):
        db_session.add(Node(label="Zone", type="groupRect", design_id=d.id))
    await db_session.flush()

    assert await dedupe_nodes_by_device(db_session) == 0


@pytest.mark.asyncio
async def test_repoints_edges_and_drops_dupes(db_session):
    d = await _design(db_session)
    device = await _device(db_session, ieee="0xCCC")
    keep = Node(label="A", type="server", design_id=d.id, device_id=device.id)
    other = Node(label="B", type="server", design_id=d.id)
    db_session.add_all([keep, other])
    await db_session.flush()
    dup = Node(label="A", type="server", design_id=d.id, device_id=device.id)
    db_session.add(dup)
    await db_session.flush()

    # keep<->other and dup<->other (parallel after repoint), plus dup<->keep (self-loop).
    db_session.add_all([
        Edge(source=keep.id, target=other.id, type="ethernet", design_id=d.id),
        Edge(source=dup.id, target=other.id, type="ethernet", design_id=d.id),
        Edge(source=dup.id, target=keep.id, type="ethernet", design_id=d.id),
    ])
    await db_session.flush()

    removed = await dedupe_nodes_by_device(db_session)
    assert removed == 1

    edges = (await db_session.execute(select(Edge))).scalars().all()
    # self-loop dropped, parallel edge collapsed -> a single keep<->other edge
    assert len(edges) == 1
    e = edges[0]
    assert {e.source, e.target} == {keep.id, other.id}


@pytest.mark.asyncio
async def test_repoints_child_parent(db_session):
    d = await _design(db_session)
    device = await _device(db_session, ieee="0xDDD")
    keep = Node(label="Host", type="proxmox", design_id=d.id, device_id=device.id)
    db_session.add(keep)
    await db_session.flush()
    dup = Node(label="Host", type="proxmox", design_id=d.id, device_id=device.id)
    db_session.add(dup)
    await db_session.flush()
    child = Node(label="VM", type="vm", design_id=d.id, parent_id=dup.id)
    db_session.add(child)
    await db_session.flush()

    await dedupe_nodes_by_device(db_session)
    await db_session.refresh(child)
    assert child.parent_id == keep.id


@pytest.mark.asyncio
async def test_canonical_nested_under_its_own_duplicate_is_detached(db_session):
    """#370 — re-pointing the canonical node made it its own parent.

    The canonical node had been nested under one of its duplicates, so the
    blanket re-point wrote `parent_id = id` and froze it on the canvas.
    """
    d = await _design(db_session)
    device = await _device(db_session, ieee="0xFFF")
    keep = Node(label="Host", type="proxmox", design_id=d.id, device_id=device.id)
    db_session.add(keep)
    await db_session.flush()
    dup = Node(label="Host", type="proxmox", design_id=d.id, device_id=device.id)
    db_session.add(dup)
    await db_session.flush()
    # The oldest node is the one that survives, and it points at the newer twin.
    keep.parent_id = dup.id
    await db_session.flush()

    await dedupe_nodes_by_device(db_session)
    await db_session.refresh(keep)
    assert keep.parent_id is None


@pytest.mark.asyncio
async def test_idempotent_noop_when_unique(db_session):
    d = await _design(db_session)
    device = await _device(db_session, ieee="0xEEE")
    db_session.add(Node(label="X", type="server", design_id=d.id, device_id=device.id))
    await db_session.flush()
    assert await dedupe_nodes_by_device(db_session) == 0
    assert await dedupe_nodes_by_device(db_session) == 0
