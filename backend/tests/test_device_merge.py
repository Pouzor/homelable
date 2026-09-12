"""Tests for the inventory duplicate repair (app.services.device_merge).

Two shapes, one merge: the user picks the survivor by hand, or an import proves
two rows are one device by their shared MAC. What both must guarantee is that
nothing is lost — not a fact, not a canvas node, not a rack mount, not a
document, and not the *visibility* of the facts that just arrived on a canvas
that never saw them.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

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
from app.services.device_merge import (
    _naive,
    _newest,
    distinct_ieees,
    merge_devices,
    reconcile_duplicates,
)


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
    # The pre-existing entry is kept exactly as it was stored — a view is
    # rewritten by a save, not by a merge — so the key seeded alongside it is
    # in today's port-keyed form while that one stays in the older one.
    assert {e["key"] for e in services} == {"5678|tcp|http", "22|tcp"}
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
async def test_the_survivor_adopts_the_first_ieee_and_reports_the_rest(db_session):
    """Regression for #453: a merge has room for one IEEE, so say what it drops.

    Two losers carrying distinct addresses collapse onto an IEEE-less survivor.
    Only the first can be adopted — `ieee_address` is UNIQUE — and the second
    goes with the row that held it. The automatic passes refuse such a group
    outright; a hand merge is allowed to do it, but never silently.
    """
    winner = await _device(db_session, id="w", ip="192.168.1.62", ieee_address=None)
    first = await _device(db_session, id="a", ieee_address="0xAABB", discovered_at=_at(1))
    second = await _device(db_session, id="b", ieee_address="0xCCDD", discovered_at=_at(2))

    result = await merge_devices(db_session, winner, [first, second])
    await db_session.flush()

    assert winner.ieee_address == "0xAABB"
    assert result["ieee_dropped"] == ["0xCCDD"]


@pytest.mark.asyncio
async def test_an_ieee_the_survivor_already_holds_is_not_reported_as_dropped(db_session):
    winner = await _device(db_session, id="w", ieee_address="0xAABB", ip="192.168.1.62")
    loser = await _device(db_session, id="l", ieee_address="0xaabb".upper(), ip="192.168.1.62")

    result = await merge_devices(db_session, winner, [loser])

    assert result["ieee_dropped"] == []


@pytest.mark.asyncio
async def test_a_losers_ieee_is_reported_when_the_survivor_holds_its_own(db_session):
    """The survivor keeps what it has, so a different address on a loser is lost."""
    winner = await _device(db_session, id="w", ieee_address="pve-pve1-130", ip="192.168.1.62")
    loser = await _device(db_session, id="l", ieee_address="0xCCDD", ip="192.168.1.62")

    result = await merge_devices(db_session, winner, [loser])

    assert result["ieee_dropped"] == ["0xCCDD"]


@pytest.mark.asyncio
async def test_a_merge_that_loses_no_address_reports_nothing(db_session):
    winner = await _device(db_session, id="w", ip="192.168.1.62", ieee_address=None)
    loser = await _device(db_session, id="l", ip="192.168.1.62", ieee_address=None)

    result = await merge_devices(db_session, winner, [loser])

    assert result["ieee_dropped"] == []


def test_distinct_ieees_folds_case_and_keeps_the_first_spelling():
    rows = [
        InventoryDevice(id="a", ieee_address="0xAABB"),
        InventoryDevice(id="b", ieee_address="0xaabb"),
        InventoryDevice(id="c", ieee_address=None),
        InventoryDevice(id="d", ieee_address=""),
        InventoryDevice(id="e", ieee_address="0xCCDD"),
    ]

    assert distinct_ieees(rows) == ["0xAABB", "0xCCDD"]


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


# --- Regression: mixed tz-awareness on discovered_at (#440) --------------
#
# Every other test in this file builds both rows in one session, so both carry
# the tz-aware value the column default gave them and every comparison is
# naive-vs-naive or aware-vs-aware. Production is not like that: SQLite stores
# no offset, so a row read back is naive, while a row this session just created
# is aware — and `expire_on_commit=False` means no commit reconciles them.
# `expire_all` reproduces that split, which is the state a scan reconcile runs
# in: it is where a row first learns the MAC that proves it a duplicate.


async def _stored(db, **kwargs):
    """A row as it comes back from the database — naive, offset dropped."""
    device = await _device(db, **kwargs)
    await db.flush()
    db.expire_all()
    await db.refresh(device)
    return device


@pytest.mark.asyncio
async def test_merge_devices_compares_stored_and_session_timestamps(db_session):
    """A loser read from the database must sort against a winner created here."""
    stored = await _stored(db_session, id="l", ip="10.0.0.2", mac="aa:bb:cc:dd:ee:02")
    assert stored.discovered_at.tzinfo is None, "row from the database should be naive"
    winner = InventoryDevice(id="w", ip="10.0.0.1", mac="aa:bb:cc:dd:ee:01")
    db_session.add(winner)
    await db_session.flush()
    assert winner.discovered_at.tzinfo is not None, "row made here should be tz-aware"

    result = await merge_devices(db_session, winner, [stored])
    assert result["merged"] == 1
    # The survivor keeps the earlier sighting, whichever form it was stored in.
    assert _naive(winner.discovered_at) == _naive(stored.discovered_at)


@pytest.mark.asyncio
async def test_reconcile_compares_stored_and_session_timestamps(db_session):
    """A scan reconcile folds a row it just made into one already on disk."""
    await _stored(db_session, id="a", mac="aa:bb:cc:dd:ee:ff")
    fresh = InventoryDevice(id="b", mac="aa:bb:cc:dd:ee:ff")
    db_session.add(fresh)
    await db_session.flush()

    assert await reconcile_duplicates(db_session) == 1


@pytest.mark.asyncio
async def test_newest_compares_stored_and_session_timestamps():
    """`last_seen`/`last_scan` carry the same split — scanner writes them aware."""
    stored = datetime(2026, 1, 2)
    fresh = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert _newest(stored, fresh) is stored
    assert _newest(fresh, stored) is stored


# --- Regression: dedupe called once per reconcile batch ------------------


@pytest.mark.asyncio
async def test_reconcile_calls_dedupe_nodes_once_regardless_of_group_count(db_session):
    """dedupe_nodes_by_device must be called exactly once even with N merge groups."""
    for i in range(3):
        mac = f"aa:bb:cc:dd:ee:{i:02x}"
        await _device(db_session, id=f"a{i}", mac=mac, discovered_at=_at(1))
        await _device(db_session, id=f"b{i}", mac=mac, discovered_at=_at(2))

    with patch(
        "app.services.device_merge.dedupe_nodes_by_device", new_callable=AsyncMock
    ) as mock_dedupe:
        merged = await reconcile_duplicates(db_session)

    assert merged == 3
    assert mock_dedupe.call_count == 1, (
        f"dedupe_nodes_by_device called {mock_dedupe.call_count} times; expected 1"
    )


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
async def test_a_merge_keeps_the_survivor_name_for_a_service_on_the_same_port(db_session):
    """Two rows describing one device describe one service per port.

    The winner is the row the canvas points at, and a loser is usually a pending
    row a scan minted, carrying the fingerprint's guess. Collapsing the pair must
    not let that guess overwrite the name, icon and category the user curated —
    the collapse runs unattended during a background scan.
    """
    winner = await _device(
        db_session, id="w", ip="192.168.1.62",
        services=[{
            "port": 80, "protocol": "tcp", "service_name": "Homepage",
            "icon": "brand:homepage", "category": "monitoring",
        }],
    )
    loser = await _device(
        db_session, id="l", ip="192.168.1.62",
        services=[{
            "port": 80, "protocol": "tcp", "service_name": "nginx",
            "icon": "Globe", "category": "web", "path": "/dash",
        }],
    )

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    assert len(winner.services) == 1
    assert winner.services[0]["service_name"] == "Homepage"
    assert winner.services[0]["icon"] == "brand:homepage"
    assert winner.services[0]["category"] == "monitoring"
    # Everything that is not the user's call still comes across.
    assert winner.services[0]["path"] == "/dash"


@pytest.mark.asyncio
async def test_a_merge_still_takes_a_service_the_survivor_never_had(db_session):
    """Curating the collision must not stop the union doing its job."""
    winner = await _device(
        db_session, id="w", ip="192.168.1.62",
        services=[{"port": 80, "protocol": "tcp", "service_name": "Homepage"}],
    )
    loser = await _device(
        db_session, id="l", ip="192.168.1.62",
        services=[{"port": 5678, "protocol": "tcp", "service_name": "n8n"}],
    )

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    assert [s["service_name"] for s in winner.services] == ["Homepage", "n8n"]


@pytest.mark.asyncio
async def test_a_merge_names_a_service_the_survivor_left_unnamed(db_session):
    """A blank name is silence, so the loser's fills it rather than being dropped."""
    winner = await _device(
        db_session, id="w", ip="192.168.1.62",
        services=[{"port": 80, "protocol": "tcp"}],
    )
    loser = await _device(
        db_session, id="l", ip="192.168.1.62",
        services=[{"port": 80, "protocol": "tcp", "service_name": "nginx"}],
    )

    await merge_devices(db_session, winner, [loser])
    await db_session.flush()

    assert [s["service_name"] for s in winner.services] == ["nginx"]
