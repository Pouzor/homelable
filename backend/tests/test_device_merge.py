"""Tests for the inventory duplicate repair (app.services.device_merge).

Two shapes, one merge: the user picks the survivor by hand, or an import proves
two rows are one device by their shared MAC. What both must guarantee is that
nothing is lost — not a fact, not a canvas node, not a rack mount, not a
document, and not the *visibility* of the facts that just arrived on a canvas
that never saw them.
"""

import logging
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db.models import (
    Design,
    Document,
    InventoryDevice,
    InventoryDeviceLink,
    Node,
    Rack,
    RackDevice,
)
from app.services.device_merge import merge_devices, reconcile_duplicates


def _at(day: int) -> datetime:
    return datetime(2026, 1, day, tzinfo=timezone.utc)


async def _design(db, name="d1"):
    design = Design(name=name)
    db.add(design)
    await db.flush()
    return design


async def _device(db, **kwargs):
    kwargs.setdefault("discovered_at", _at(1))
    device = InventoryDevice(**kwargs)
    db.add(device)
    await db.flush()
    return device


async def _node(db, design, device, **kwargs):
    node = Node(design_id=design.id, device_id=device.id, label=kwargs.pop("label", "n8n"),
                type=kwargs.pop("type", "lxc"), **kwargs)
    db.add(node)
    await db.flush()
    return node


async def _rack(db, design):
    rack = Rack(design_id=design.id, name="R1", u_height=42)
    db.add(rack)
    await db.flush()
    return rack


@pytest.mark.asyncio
async def test_merge_unions_facts_without_overwriting_the_survivor(db_session):
    winner = await _device(
        db_session, id="w", ip="192.168.1.62", mac="bc:24:11:95:af:8c",
        hostname="n8n", label="n8n", vendor="Proxmox VE", status="pending",
        services=[{"service_name": "ssh", "port": 22, "protocol": "tcp"}],
        properties=[{"key": "VMID", "value": "130", "visible": True}],
        discovery_source="arp", discovery_sources=["arp", "proxmox"],
        discovered_at=_at(5),
    )
    loser = await _device(
        db_session, id="l", ip="10.0.0.9", mac=None, hostname="ignored",
        notes="runs the automations", cpu_count=4, status="approved",
        services=[{"service_name": "http", "port": 5678, "protocol": "tcp"}],
        properties=[{"key": "Owner", "value": "me", "visible": True}],
        discovery_source="canvas", discovery_sources=["canvas"],
        discovered_at=_at(2),
    )

    result = await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    assert result["merged"] == 1
    assert await db_session.get(InventoryDevice, "l") is None
    # Established facts are never overwritten by the folded-in row...
    assert winner.hostname == "n8n"
    # ...but every gap it can fill, it fills.
    assert winner.notes == "runs the automations"
    assert winner.cpu_count == 4
    # Addresses and lists union; sources accumulate.
    assert winner.ip == "192.168.1.62, 10.0.0.9"
    assert {s["service_name"] for s in winner.services} == {"ssh", "http"}
    assert {p["key"] for p in winner.properties} == {"VMID", "Owner"}
    assert set(winner.discovery_sources) == {"arp", "proxmox", "canvas"}
    # Drawn on a canvas, so the survivor cannot go back to the pending queue.
    assert winner.status == "approved"
    # Known since the earliest of the two rows saw it.
    assert winner.discovered_at == _at(2)


@pytest.mark.asyncio
async def test_merge_repoints_canvas_nodes_and_rack_mounts(db_session):
    design = await _design(db_session)
    other = await _design(db_session, name="d2")
    winner = await _device(db_session, id="w", ip="192.168.1.62", status="approved")
    loser = await _device(db_session, id="l", ip="192.168.1.62", label="n8n", status="approved")

    kept = await _node(db_session, design, winner, pos_x=10, pos_y=20)
    moved = await _node(db_session, other, loser, pos_x=300, pos_y=400)
    rack = await _rack(db_session, design)
    mount = RackDevice(design_id=design.id, rack_id=rack.id, device_id=loser.id, label="n8n")
    db_session.add(mount)
    await db_session.flush()

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    # The node on the other canvas keeps its position and now draws the survivor.
    await db_session.refresh(moved)
    assert moved.device_id == "w"
    assert (moved.pos_x, moved.pos_y) == (300, 400)
    assert (await db_session.get(Node, kept.id)).device_id == "w"
    # The mount follows too — a rack that rendered before still renders.
    await db_session.refresh(mount)
    assert mount.device_id == "w"


@pytest.mark.asyncio
async def test_merge_shows_the_new_facts_on_a_canvas_that_never_saw_them(db_session):
    """The point of the merge: a poorer node must gain the richer row's facts.

    `display_view` is a whitelist — without extending it the folded-in services
    and properties would render hidden and the canvas would look unchanged.
    """
    design = await _design(db_session)
    winner = await _device(
        db_session, id="w", ip="192.168.1.62",
        services=[{"service_name": "ssh", "port": 22, "protocol": "tcp"}],
        properties=[{"key": "VMID", "value": "130", "visible": True}],
    )
    loser = await _device(
        db_session, id="l", ip="192.168.1.62",
        services=[{"service_name": "http", "port": 5678, "protocol": "tcp"}],
        properties=[],
    )
    poor = await _node(db_session, design, loser)
    poor.display_view = {
        "services": [{"key": "5678|tcp|http", "visible": True}],
        "properties": [],
    }
    await db_session.flush()

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()
    await db_session.refresh(poor)

    services = poor.display_view["services"]
    assert [e["visible"] for e in services] == [True, True]
    assert {e["key"] for e in services} == {"5678|tcp|http", "22|tcp|ssh"}
    # A property list this canvas had never seen picks up the survivor's.
    assert [e["key"] for e in poor.display_view["properties"]] == ["vmid"]


@pytest.mark.asyncio
async def test_merge_keeps_a_deliberately_hidden_fact_hidden(db_session):
    design = await _design(db_session)
    winner = await _device(
        db_session, id="w", ip="192.168.1.62",
        services=[{"service_name": "ssh", "port": 22, "protocol": "tcp"}],
    )
    loser = await _device(db_session, id="l", ip="192.168.1.62", services=[])
    node = await _node(db_session, design, loser)
    node.display_view = {"services": [{"key": "22|tcp|ssh", "visible": False}], "properties": []}
    await db_session.flush()

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()
    await db_session.refresh(node)

    assert node.display_view["services"] == [{"key": "22|tcp|ssh", "visible": False}]


@pytest.mark.asyncio
async def test_merge_collapses_two_nodes_that_now_draw_one_device(db_session):
    """Both rows drawn on the *same* canvas: one node survives, the oldest."""
    design = await _design(db_session)
    winner = await _device(db_session, id="w", ip="192.168.1.62", status="approved")
    loser = await _device(db_session, id="l", ip="192.168.1.62", status="approved")
    keep = await _node(db_session, design, winner, pos_x=10, pos_y=20)
    await _node(db_session, design, loser, pos_x=99, pos_y=99)

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    nodes = (
        await db_session.execute(select(Node).where(Node.design_id == design.id))
    ).scalars().all()
    assert [n.id for n in nodes] == [keep.id]
    assert (nodes[0].pos_x, nodes[0].pos_y) == (10, 20)


@pytest.mark.asyncio
async def test_a_rack_mount_survives_the_node_collapse(db_session):
    """`rack_devices.node_id` must not be left naming a deleted duplicate node."""
    design = await _design(db_session)
    winner = await _device(db_session, id="w", ip="192.168.1.62", status="approved")
    loser = await _device(db_session, id="l", ip="192.168.1.62", status="approved")
    keep = await _node(db_session, design, winner)
    dup = await _node(db_session, design, loser)
    rack = await _rack(db_session, design)
    mount = RackDevice(
        design_id=design.id, rack_id=rack.id, device_id=loser.id, node_id=dup.id, label="n8n"
    )
    db_session.add(mount)
    await db_session.flush()

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()
    await db_session.refresh(mount)

    assert mount.device_id == "w"
    assert mount.node_id == keep.id
    assert await db_session.get(Node, dup.id) is None


@pytest.mark.asyncio
async def test_merge_adopts_a_document_or_orphans_it(db_session):
    winner = await _device(db_session, id="w", ip="192.168.1.62")
    loser = await _device(db_session, id="l", ip="192.168.1.62")
    doc = Document(title="n8n", slug="n8n", device_id=loser.id, body="# n8n")
    db_session.add(doc)
    await db_session.flush()

    result = await merge_devices(db_session, winner, [loser])
    await db_session.flush()
    await db_session.refresh(doc)

    # No document on the survivor, so the loser's is adopted rather than orphaned.
    assert doc.device_id == "w"
    assert result["documents_orphaned"] == 0


@pytest.mark.asyncio
async def test_a_second_document_is_orphaned_not_deleted(db_session):
    winner = await _device(db_session, id="w", ip="192.168.1.62")
    loser = await _device(db_session, id="l", ip="192.168.1.62")
    mine = Document(title="n8n", slug="n8n", device_id=winner.id, body="kept")
    theirs = Document(title="n8n (dup)", slug="n8n-dup", device_id=loser.id, body="written by hand")
    db_session.add_all([mine, theirs])
    await db_session.flush()

    result = await merge_devices(db_session, winner, [loser])
    await db_session.flush()
    await db_session.refresh(theirs)

    assert result["documents_orphaned"] == 1
    assert theirs.device_id is None
    assert theirs.body == "written by hand"  # survives as an orphan


@pytest.mark.asyncio
async def test_merge_moves_mesh_links_onto_the_survivor_ieee(db_session):
    winner = await _device(db_session, id="w", ieee_address="pve-pve1-130", ip="192.168.1.62")
    loser = await _device(db_session, id="l", ieee_address="0xAABB", ip="192.168.1.62")
    db_session.add(InventoryDeviceLink(source_ieee="pve-host", target_ieee="0xAABB"))
    db_session.add(InventoryDeviceLink(source_ieee="0xAABB", target_ieee="0xCCDD"))
    await db_session.flush()

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    links = (await db_session.execute(select(InventoryDeviceLink))).scalars().all()
    pairs = {(link.source_ieee, link.target_ieee) for link in links}
    assert pairs == {("pve-host", "pve-pve1-130"), ("pve-pve1-130", "0xCCDD")}


@pytest.mark.asyncio
async def test_the_survivor_adopts_an_ieee_it_lacks(db_session):
    winner = await _device(db_session, id="w", ip="192.168.1.62", ieee_address=None)
    loser = await _device(db_session, id="l", ip="192.168.1.62", ieee_address="pve-pve1-130")

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    assert winner.ieee_address == "pve-pve1-130"


@pytest.mark.asyncio
async def test_reconcile_merges_rows_sharing_a_mac(db_session):
    """The reported case: a Proxmox row and a canvas row, same NIC."""
    scanned = await _device(
        db_session, id="scanned", ip="192.168.1.62", mac="bc:24:11:95:af:8c",
        ieee_address="pve-proxmox-ai-130", status="pending", discovered_at=_at(1),
    )
    from_canvas = await _device(
        db_session, id="canvas", ip="192.168.1.62", mac="bc:24:11:95:af:8c",
        label="n8n", status="approved", discovered_at=_at(20),
    )

    merged = await reconcile_duplicates(db_session)
    await db_session.flush()

    assert merged == 1
    # The IEEE-bearing row wins: the Proxmox import and the link graph key on it.
    assert await db_session.get(InventoryDevice, from_canvas.id) is None
    assert (await db_session.get(InventoryDevice, scanned.id)).label == "n8n"


@pytest.mark.asyncio
async def test_reconcile_leaves_rows_that_only_share_an_ip(db_session):
    """An IP is not an identity — a re-used lease must not merge two machines."""
    await _device(db_session, id="a", ip="192.168.1.62", mac="aa:aa:aa:aa:aa:aa")
    await _device(db_session, id="b", ip="192.168.1.62", mac="bb:bb:bb:bb:bb:bb")

    assert await reconcile_duplicates(db_session) == 0
    assert len((await db_session.execute(select(InventoryDevice))).scalars().all()) == 2


@pytest.mark.asyncio
async def test_reconcile_leaves_two_proxmox_guests_sharing_a_mac(db_session):
    """Distinct synthetic IEEEs are decisive: two guests are never one device."""
    await _device(db_session, id="a", mac="bc:24:11:95:af:8c", ieee_address="pve-pve1-130")
    await _device(db_session, id="b", mac="bc:24:11:95:af:8c", ieee_address="pve-pve1-131")

    assert await reconcile_duplicates(db_session) == 0
    assert len((await db_session.execute(select(InventoryDevice))).scalars().all()) == 2


@pytest.mark.asyncio
async def test_reconcile_never_touches_a_hidden_row(db_session):
    """A hidden row was hidden on purpose — merging it would resurrect it."""
    await _device(db_session, id="visible", mac="bc:24:11:95:af:8c", status="pending")
    await _device(db_session, id="hidden", mac="bc:24:11:95:af:8c", status="hidden")

    assert await reconcile_duplicates(db_session) == 0
    hidden = await db_session.get(InventoryDevice, "hidden")
    assert hidden is not None and hidden.status == "hidden"


@pytest.mark.asyncio
async def test_reconcile_is_idempotent(db_session):
    await _device(db_session, id="a", mac="bc:24:11:95:af:8c", ip="192.168.1.62")
    await _device(db_session, id="b", mac="bc:24:11:95:af:8c", ip="192.168.1.62")

    assert await reconcile_duplicates(db_session) == 1
    await db_session.flush()
    assert await reconcile_duplicates(db_session) == 0


# --- The route -----------------------------------------------------------


@pytest.mark.asyncio
async def test_merge_route_returns_the_survivor(client, headers, db_session):
    await _device(db_session, id="w", ip="192.168.1.62", label="n8n", status="approved")
    await _device(db_session, id="l", hostname="n8n", notes="the good notes")
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/merge",
        json={"winner_id": "w", "loser_ids": ["l"]},
        headers=headers,
    )

    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "w"
    assert body["notes"] == "the good notes"
    assert await db_session.get(InventoryDevice, "l") is None


@pytest.mark.asyncio
async def test_merge_route_rejects_a_single_device(client, headers, db_session):
    await _device(db_session, id="w", ip="192.168.1.62")
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/merge",
        json={"winner_id": "w", "loser_ids": ["w"]},
        headers=headers,
    )

    assert res.status_code == 400


@pytest.mark.asyncio
async def test_merge_route_404s_on_an_unknown_row(client, headers, db_session):
    await _device(db_session, id="w", ip="192.168.1.62")
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/merge",
        json={"winner_id": "w", "loser_ids": ["nope"]},
        headers=headers,
    )

    assert res.status_code == 404


@pytest.mark.asyncio
async def test_merge_route_requires_auth(client, db_session):
    res = await client.post(
        "/api/v1/scan/pending/merge", json={"winner_id": "w", "loser_ids": ["l"]}
    )
    assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_merge_warns_when_multiple_loser_ieees_collapse(db_session, caplog):
    # Winner has no IEEE; two losers each have a distinct IEEE address.
    # Only the first can be adopted (ieee_address is UNIQUE). Verify a
    # WARNING is emitted so operators can see the discarded address.
    winner = await _device(db_session, id="w", ip="10.0.0.1")
    loser1 = await _device(db_session, id="l1", ip="10.0.0.2",
                            ieee_address="aa:bb:cc:dd:ee:01")
    loser2 = await _device(db_session, id="l2", ip="10.0.0.3",
                            ieee_address="aa:bb:cc:dd:ee:02")
    await db_session.commit()

    with caplog.at_level(logging.WARNING, logger="app.services.device_merge"):
        await merge_devices(db_session, winner, [loser1, loser2])
        await db_session.commit()

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING
                and "discarding" in r.message]
    assert warnings, "expected a WARNING about discarded IEEE address(es)"
    assert "aa:bb:cc:dd:ee:02" in warnings[0].message
    # Winner adopts the first loser's address
    await db_session.refresh(winner)
    assert winner.ieee_address == "aa:bb:cc:dd:ee:01"
