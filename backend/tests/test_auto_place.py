"""Tests for the auto-place topology layout service.

Covers:
  - _dev_in_types       pure type/suggested_type matching
  - _client_grid_shape  pure grid dimension helper
  - _compute_tree_layout  Reingold-Tilford infra + client layout
  - run_auto_place      DB integration with mocked _build_topology
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.db.models import InventoryDevice, Node
from app.services.auto_place import (
    CLIENT_NODE_HEIGHT,
    INFRA_NODE_WIDTH,
    INFRA_TIER_HEIGHT,
    _client_grid_shape,
    _compute_tree_layout,
    _dev_in_types,
    run_auto_place,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dev(
    id: str,
    *,
    type: str | None = None,
    suggested_type: str | None = None,
    mac: str | None = None,
    label: str | None = None,
    hostname: str | None = None,
    ip: str | None = None,
    status: str = "approved",
    ieee_address: str | None = None,
) -> InventoryDevice:
    d = InventoryDevice()
    d.id = id
    d.type = type
    d.suggested_type = suggested_type
    d.mac = mac
    d.label = label
    d.hostname = hostname
    d.ip = ip
    d.status = status
    d.ieee_address = ieee_address
    # snmp_enabled is referenced in _build_topology but not on the ORM model;
    # set it as a plain attribute so SNMP walk list comprehension short-circuits.
    d.snmp_enabled = False
    return d


# ---------------------------------------------------------------------------
# _dev_in_types
# ---------------------------------------------------------------------------

class TestDevInTypes:
    def test_matches_type(self):
        d = _dev("x", type="switch")
        assert _dev_in_types(d, {"switch"})

    def test_matches_suggested_type(self):
        d = _dev("x", type="server", suggested_type="switch")
        assert _dev_in_types(d, {"switch"})

    def test_type_takes_precedence(self):
        d = _dev("x", type="switch", suggested_type="router")
        assert _dev_in_types(d, {"switch"})
        assert _dev_in_types(d, {"router"})   # suggested_type also matches

    def test_no_match(self):
        d = _dev("x", type="computer")
        assert not _dev_in_types(d, {"switch", "router"})

    def test_none_type(self):
        d = _dev("x")
        assert not _dev_in_types(d, {"switch"})

    def test_case_insensitive(self):
        d = _dev("x", type="Switch")
        assert _dev_in_types(d, {"switch"})


# ---------------------------------------------------------------------------
# _client_grid_shape
# ---------------------------------------------------------------------------

class TestClientGridShape:
    def test_zero(self):
        assert _client_grid_shape(0) == (0, 0)

    def test_one(self):
        cols, rows = _client_grid_shape(1)
        assert cols >= 1 and rows >= 1
        assert cols * rows >= 1

    def test_four_is_square(self):
        cols, rows = _client_grid_shape(4)
        assert cols == 2
        assert rows == 2

    def test_max_cols_cap(self):
        # 20 clients: cols must not exceed CLIENT_MAX_COLS (4)
        cols, rows = _client_grid_shape(20)
        assert cols == 4
        assert rows == 5

    def test_fits_all(self):
        for n in range(1, 30):
            cols, rows = _client_grid_shape(n)
            assert cols * rows >= n


# ---------------------------------------------------------------------------
# _compute_tree_layout
# ---------------------------------------------------------------------------

def _layout(
    infra_ids,
    tier_map,
    bfs_parent=None,
    infra_adj=None,
    client_parent=None,
    label_of=None,
    virtual_infra_ids=None,
):
    return _compute_tree_layout(
        infra_ids,
        tier_map,
        bfs_parent or {},
        infra_adj or {k: set() for k in infra_ids},
        client_parent or {},
        label_of or {k: k for k in infra_ids},
        virtual_infra_ids=virtual_infra_ids,
    )


class TestComputeTreeLayout:
    def test_single_node_placed(self):
        pos, _ = _layout(["fw"], {"fw": 0})
        assert "fw" in pos

    def test_fw_at_tier_0(self):
        pos, _ = _layout(["fw"], {"fw": 0})
        _, y = pos["fw"]
        assert y == 0

    def test_switch_below_fw(self):
        pos, _ = _layout(
            ["fw", "sw"],
            {"fw": 0, "sw": 1},
            bfs_parent={"sw": "fw"},
            infra_adj={"fw": {"sw"}, "sw": {"fw"}},
        )
        _, fw_y = pos["fw"]
        _, sw_y = pos["sw"]
        assert sw_y > fw_y

    def test_tier_y_equals_tier_times_height(self):
        pos, _ = _layout(
            ["fw", "sw"],
            {"fw": 0, "sw": 1},
            bfs_parent={"sw": "fw"},
        )
        _, sw_y = pos["sw"]
        assert sw_y == pytest.approx(INFRA_TIER_HEIGHT)

    def test_two_switches_same_y(self):
        pos, _ = _layout(
            ["fw", "sw1", "sw2"],
            {"fw": 0, "sw1": 1, "sw2": 1},
            bfs_parent={"sw1": "fw", "sw2": "fw"},
            infra_adj={"fw": {"sw1", "sw2"}, "sw1": {"fw"}, "sw2": {"fw"}},
        )
        _, y1 = pos["sw1"]
        _, y2 = pos["sw2"]
        assert y1 == pytest.approx(y2)

    def test_two_switches_different_x(self):
        pos, _ = _layout(
            ["fw", "sw1", "sw2"],
            {"fw": 0, "sw1": 1, "sw2": 1},
            bfs_parent={"sw1": "fw", "sw2": "fw"},
            infra_adj={"fw": {"sw1", "sw2"}, "sw1": {"fw"}, "sw2": {"fw"}},
        )
        x1, _ = pos["sw1"]
        x2, _ = pos["sw2"]
        assert abs(x1 - x2) >= INFRA_NODE_WIDTH

    def test_clients_below_infra(self):
        pos, _ = _layout(
            ["fw", "sw"],
            {"fw": 0, "sw": 1},
            bfs_parent={"sw": "fw"},
            infra_adj={"fw": {"sw"}, "sw": {"fw"}},
            client_parent={"pc1": "sw", "pc2": "sw"},
            label_of={"fw": "fw", "sw": "sw", "pc1": "pc1", "pc2": "pc2"},
        )
        _, sw_y = pos["sw"]
        for client in ("pc1", "pc2"):
            _, cy = pos[client]
            assert cy > sw_y

    def test_client_band_bottom_positive(self):
        _, bottom = _layout(
            ["fw"],
            {"fw": 0},
            client_parent={"pc": "fw"},
            label_of={"fw": "fw", "pc": "pc"},
        )
        assert bottom > 0

    def test_orphan_clients_placed(self):
        # client with no infra parent (None) should still get a position
        pos, _ = _layout(
            ["fw"],
            {"fw": 0},
            client_parent={"orphan": None},
            label_of={"fw": "fw", "orphan": "orphan"},
        )
        assert "orphan" in pos

    def test_multiple_roots_placed(self):
        # Two firewalls (multi-root topology)
        pos, _ = _layout(
            ["fw1", "fw2", "sw"],
            {"fw1": 0, "fw2": 0, "sw": 1},
            bfs_parent={"sw": "fw1"},
            infra_adj={"fw1": {"sw", "fw2"}, "fw2": {"fw1"}, "sw": {"fw1"}},
        )
        assert "fw1" in pos and "fw2" in pos and "sw" in pos

    def test_virtual_infra_placed(self):
        pos, _ = _layout(
            ["sw", "proxmox"],
            {"sw": 0, "proxmox": 1},
            bfs_parent={"proxmox": "sw"},
            infra_adj={"sw": {"proxmox"}, "proxmox": {"sw"}},
            virtual_infra_ids={"proxmox"},
        )
        assert "proxmox" in pos

    def test_client_grid_row_y_offset(self):
        # 5 clients → 3 cols (ceil(sqrt(5))=3), 2 rows
        # clients in second row should be CLIENT_NODE_HEIGHT lower
        clients = {f"c{i}": "sw" for i in range(5)}
        pos, _ = _layout(
            ["fw", "sw"],
            {"fw": 0, "sw": 1},
            bfs_parent={"sw": "fw"},
            infra_adj={"fw": {"sw"}, "sw": {"fw"}},
            client_parent=clients,
            label_of={"fw": "fw", "sw": "sw", **{k: k for k in clients}},
        )
        ys = sorted({pos[c][1] for c in clients})
        assert len(ys) == 2
        assert ys[1] - ys[0] == pytest.approx(CLIENT_NODE_HEIGHT)


# ---------------------------------------------------------------------------
# run_auto_place  (DB integration + mocked _build_topology)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_auto_place_empty_db(db_session):
    """No devices → returns zero counts."""
    design_id = "d-empty"
    with patch("app.services.auto_place._build_topology", new=AsyncMock(return_value=({}, {}, set()))):
        result = await run_auto_place(design_id, db_session)
    assert result == {"nodes_placed": 0, "nodes_moved": 0, "edges_created": 0, "skipped": 0}


@pytest.mark.asyncio
async def test_run_auto_place_single_device(db_session):
    """One approved device → one node created, zero edges."""
    dev = _dev("dev1", type="router", ip="10.0.0.1")
    db_session.add(dev)
    await db_session.flush()

    design_id = "d-single"
    with patch("app.services.auto_place._build_topology", new=AsyncMock(return_value=({}, {}, set()))):
        result = await run_auto_place(design_id, db_session)

    assert result["nodes_placed"] == 1
    assert result["edges_created"] == 0


@pytest.mark.asyncio
async def test_run_auto_place_two_devices_edge_created(db_session):
    """Firewall + switch with adjacency → one infra edge created."""
    fw = _dev("fw1", type="firewall", mac="aa:bb:cc:00:00:01", label="fw")
    sw = _dev("sw1", type="switch",   mac="aa:bb:cc:00:00:02", label="sw")
    db_session.add(fw)
    db_session.add(sw)
    await db_session.flush()

    adjacency = {"fw1": {"sw1"}, "sw1": {"fw1"}}
    design_id = "d-two"
    with patch(
        "app.services.auto_place._build_topology",
        new=AsyncMock(return_value=(adjacency, {}, set())),
    ):
        result = await run_auto_place(design_id, db_session)

    assert result["nodes_placed"] == 2
    assert result["edges_created"] == 1


@pytest.mark.asyncio
async def test_run_auto_place_hidden_device_excluded(db_session):
    """Hidden devices are not placed."""
    visible = _dev("v1", type="switch", status="approved")
    hidden  = _dev("h1", type="router", status="hidden")
    db_session.add(visible)
    db_session.add(hidden)
    await db_session.flush()

    design_id = "d-hidden"
    with patch("app.services.auto_place._build_topology", new=AsyncMock(return_value=({}, {}, set()))):
        result = await run_auto_place(design_id, db_session)

    assert result["nodes_placed"] == 1


@pytest.mark.asyncio
async def test_run_auto_place_force_repositions(db_session):
    """force=True repositions an existing node."""
    dev = _dev("dev1", type="switch")
    db_session.add(dev)
    await db_session.flush()

    design_id = "d-force"
    with patch("app.services.auto_place._build_topology", new=AsyncMock(return_value=({}, {}, set()))):
        await run_auto_place(design_id, db_session)
        result = await run_auto_place(design_id, db_session, force=True)

    assert result["nodes_moved"] == 1
    assert result["nodes_placed"] == 0


@pytest.mark.asyncio
async def test_run_auto_place_skips_existing_non_force(db_session):
    """Second run without force → device already on canvas is skipped."""
    dev = _dev("dev1", type="switch")
    db_session.add(dev)
    await db_session.flush()

    design_id = "d-skip"
    with patch("app.services.auto_place._build_topology", new=AsyncMock(return_value=({}, {}, set()))):
        await run_auto_place(design_id, db_session)
        result = await run_auto_place(design_id, db_session)

    assert result["skipped"] == 1
    assert result["nodes_placed"] == 0


@pytest.mark.asyncio
async def test_run_auto_place_fw_placed_at_tier0(db_session):
    """Firewall node ends up at y=0 (tier-0 position)."""
    fw = _dev("fw1", type="firewall", label="fw")
    db_session.add(fw)
    await db_session.flush()

    design_id = "d-fw"
    with patch("app.services.auto_place._build_topology", new=AsyncMock(return_value=({}, {}, set()))):
        await run_auto_place(design_id, db_session)

    from sqlalchemy import select
    nodes = (await db_session.execute(
        select(Node).where(Node.design_id == design_id, Node.device_id == "fw1")
    )).scalars().all()
    assert len(nodes) == 1
    assert nodes[0].pos_y == pytest.approx(0.0)


@pytest.mark.asyncio
async def test_run_auto_place_no_duplicate_edges(db_session):
    """Running auto-place twice non-force should not create duplicate edges."""
    fw = _dev("fw1", type="firewall", mac="aa:00:00:00:00:01", label="fw")
    sw = _dev("sw1", type="switch",   mac="aa:00:00:00:00:02", label="sw")
    db_session.add(fw)
    db_session.add(sw)
    await db_session.flush()

    adjacency = {"fw1": {"sw1"}, "sw1": {"fw1"}}
    design_id = "d-dup"
    with patch(
        "app.services.auto_place._build_topology",
        new=AsyncMock(return_value=(adjacency, {}, set())),
    ):
        r1 = await run_auto_place(design_id, db_session)
        r2 = await run_auto_place(design_id, db_session)

    assert r1["edges_created"] == 1
    assert r2["edges_created"] == 0   # edge already exists, skipped
