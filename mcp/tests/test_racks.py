import copy
from unittest.mock import AsyncMock, patch

import pytest

from app.faceplates import get_faceplate
from app.racks import dispatch_rack

DESIGN = "design-rack"
VIEWPORT = {"x": 5, "y": 6, "zoom": 2}


def api_rack(rack_id="r1", **patch):
    """A rack as GET /api/v1/racks reports it — `design_id` included."""
    return {
        "id": rack_id,
        "design_id": DESIGN,
        "name": "Rack 1",
        "u_height": 10,
        "width_standard": "19",
        "numbering": "bottom-up",
        "location": None,
        "style": {},
        "pos_x": 80,
        "pos_y": 60,
        **patch,
    }


def api_mount(mount_id="m1", **patch):
    return {
        "id": mount_id,
        "design_id": DESIGN,
        "rack_id": "r1",
        "device_id": None,
        "node_id": None,
        "label": "Mount",
        "u_start": 1,
        "u_height": 1,
        "col_start": 0,
        "col_span": 12,
        "faceplate_id": "server-1u",
        "color": None,
        "status": "unknown",
        "port_visibility": "auto",
        "ports": [
            {"id": "p1", "label": "eth1", "type": "rj45", "x": 0.83, "y": 0.5},
            {"id": "p2", "label": "eth2", "type": "rj45", "x": 0.91, "y": 0.5},
        ],
        **patch,
    }


def api_cable(cable_id="c1", **patch):
    return {
        "id": cable_id,
        "design_id": DESIGN,
        "from_device_id": "m1",
        "from_port_id": "p1",
        "to_device_id": "m2",
        "to_port_id": "p1",
        "type": "ethernet",
        "color": "#39d353",
        "label": None,
        "label_visible": False,
        "properties": [],
        **patch,
    }


def api_item(item_id="i1", **patch):
    return {
        "id": item_id,
        "label": "pve1",
        "suggested_type": "proxmox",
        "ip": "192.168.1.10",
        "status": "approved",
        "discovery_source": "scan",
        "racked": False,
        "node_id": "n1",
        "rack_faceplate_id": None,
        "rack_u_height": None,
        "rack_col_span": None,
        "rack_color": None,
        "rack_ports": [],
        **patch,
    }


class FakeBackend:
    """Serves the rack state and the tray, and records what is saved."""

    def __init__(self, racks=None, devices=None, cables=None, items=None):
        self.state = {
            "racks": racks if racks is not None else [api_rack()],
            "devices": devices or [],
            "cables": cables or [],
            "viewport": dict(VIEWPORT),
        }
        self.items = items if items is not None else [api_item()]
        self.saved = []

    async def get(self, path):
        if "/racks/inventory" in path:
            return {"items": copy.deepcopy(self.items)}
        if path.startswith("/api/v1/racks?"):
            return copy.deepcopy(self.state)
        raise AssertionError(f"unexpected GET {path}")

    async def post(self, path, body):
        assert path == "/api/v1/racks/save"
        self.saved.append(copy.deepcopy(body))
        return {"saved": True}

    @property
    def payload(self):
        assert self.saved, "nothing was saved"
        return self.saved[-1]


@pytest.fixture
def fake():
    backend = FakeBackend()
    with patch("app.racks.backend") as m:
        m.get = AsyncMock(side_effect=backend.get)
        m.post = AsyncMock(side_effect=backend.post)
        yield backend


def _use(fake, **kwargs):
    """Reshape the fixture's state for one test."""
    for key, value in kwargs.items():
        if key == "items":
            fake.items = value
        else:
            fake.state[key] = value


# --- The state round trip ---------------------------------------------------
@pytest.mark.anyio
async def test_save_strips_design_id_from_every_row(fake):
    _use(fake, devices=[api_mount()], cables=[api_cable(to_device_id="m1", to_port_id="p2")])
    await dispatch_rack("create_rack", {"design_id": DESIGN, "name": "Rack 2"})

    payload = fake.payload
    assert payload["design_id"] == DESIGN
    for section in ("racks", "devices", "cables"):
        assert payload[section], f"{section} was dropped"
        for row in payload[section]:
            assert "design_id" not in row, f"{section} row still carries design_id"


@pytest.mark.anyio
async def test_save_echoes_the_viewport(fake):
    """The save overwrites the design's CanvasState — not echoing the viewport
    back resets the user's pan and zoom."""
    await dispatch_rack("create_rack", {"design_id": DESIGN, "name": "Rack 2"})
    assert fake.payload["viewport"] == VIEWPORT


# --- Racks ------------------------------------------------------------------
@pytest.mark.anyio
async def test_create_rack_defaults_and_clamps(fake):
    result = await dispatch_rack(
        "create_rack", {"design_id": DESIGN, "name": "Rack 2", "u_height": 999}
    )
    created = next(r for r in fake.payload["racks"] if r["name"] == "Rack 2")
    assert created["u_height"] == 48  # MAX_RACK_U, not the backend's 100
    assert result["rack_id"] == created["id"]
    # Laid out to the right of the rack already there.
    assert created["pos_x"] == 80 + 620
    assert created["style"]["frame"] == "#1c2129"


@pytest.mark.anyio
async def test_create_rack_honours_explicit_geometry(fake):
    await dispatch_rack("create_rack", {
        "design_id": DESIGN, "name": "Baie", "u_height": 12,
        "width_standard": "10", "numbering": "top-down", "location": "Garage",
        "pos_x": 1000, "pos_y": 200,
    })
    created = next(r for r in fake.payload["racks"] if r["name"] == "Baie")
    assert (created["u_height"], created["width_standard"]) == (12, "10")
    assert (created["numbering"], created["location"]) == ("top-down", "Garage")
    assert (created["pos_x"], created["pos_y"]) == (1000, 200)


@pytest.mark.anyio
async def test_update_rack_shrink_relocates_the_mounts_it_pushes_out(fake):
    _use(fake, devices=[api_mount("m1", u_start=1), api_mount("m2", u_start=9)])
    await dispatch_rack("update_rack", {"design_id": DESIGN, "rack_id": "r1", "u_height": 4})

    moved = next(d for d in fake.payload["devices"] if d["id"] == "m2")
    assert moved["u_start"] <= 4
    assert moved["u_start"] != 1  # not on top of the mount that stayed


@pytest.mark.anyio
async def test_update_rack_refuses_a_shrink_with_nowhere_to_put_a_mount(fake):
    _use(fake, devices=[
        api_mount("m1", u_start=1),
        api_mount("m2", u_start=2),
        api_mount("m3", u_start=9),
    ])
    with pytest.raises(ValueError, match="Cannot shrink"):
        await dispatch_rack("update_rack", {"design_id": DESIGN, "rack_id": "r1", "u_height": 2})
    assert fake.saved == []  # nothing persisted


@pytest.mark.anyio
async def test_update_rack_rejects_an_unknown_rack(fake):
    with pytest.raises(ValueError, match="Unknown rack"):
        await dispatch_rack("update_rack", {"design_id": DESIGN, "rack_id": "nope", "name": "x"})


@pytest.mark.anyio
async def test_delete_rack_takes_its_mounts_and_their_cables(fake):
    _use(
        fake,
        racks=[api_rack("r1"), api_rack("r2", name="Rack 2")],
        devices=[api_mount("m1", rack_id="r1"), api_mount("m2", rack_id="r2")],
        cables=[api_cable("c1")],
    )
    result = await dispatch_rack("delete_rack", {"design_id": DESIGN, "rack_id": "r1"})

    assert result["unmounted"] == 1 and result["cables_removed"] == 1
    payload = fake.payload
    assert [r["id"] for r in payload["racks"]] == ["r2"]
    assert [d["id"] for d in payload["devices"]] == ["m2"]
    assert payload["cables"] == []


# --- Mounting ---------------------------------------------------------------
@pytest.mark.anyio
async def test_mount_device_seeds_ports_from_the_suggested_faceplate(fake):
    result = await dispatch_rack(
        "mount_device", {"design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1"}
    )
    mount = fake.payload["devices"][0]

    # proxmox -> server-2u-bays, per the frontend's suggestion map.
    plate = get_faceplate("server-2u-bays")
    assert mount["faceplate_id"] == "server-2u-bays"
    assert mount["u_height"] == plate["u_height"]
    assert mount["col_span"] == plate["col_span"]
    assert mount["device_id"] == "i1" and mount["node_id"] == "n1"
    assert mount["label"] == "pve1" and mount["status"] == "approved"

    assert len(mount["ports"]) == len(plate["ports"])
    assert [p["label"] for p in mount["ports"]] == [p["label"] for p in plate["ports"]]
    ids = {p["id"] for p in mount["ports"]}
    assert len(ids) == len(mount["ports"]) and "" not in ids
    assert result["mount_id"] == mount["id"]


@pytest.mark.anyio
async def test_mount_device_reuses_the_front_panel_the_inventory_owns(fake):
    """The device wears the same plate in every rack, ports included."""
    ports = [{"id": "keep-1", "label": "eth1", "type": "rj45", "x": 0.5, "y": 0.5}]
    _use(fake, items=[api_item(
        rack_faceplate_id="switch-24", rack_u_height=1, rack_col_span=6,
        rack_color="#ff6e00", rack_ports=ports,
    )])
    await dispatch_rack(
        "mount_device", {"design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1"}
    )
    mount = fake.payload["devices"][0]
    assert mount["faceplate_id"] == "switch-24"
    assert (mount["u_height"], mount["col_span"]) == (1, 6)
    assert mount["color"] == "#ff6e00"
    assert mount["ports"] == ports


@pytest.mark.anyio
async def test_mount_device_ignores_a_stored_size_from_another_plate(fake):
    """The stored size was measured on the plate it was stored with; an explicit
    faceplate override means the size and ports have to come from that plate."""
    _use(fake, items=[api_item(
        rack_faceplate_id="switch-24", rack_u_height=1, rack_col_span=6,
        rack_ports=[{"id": "old", "label": "eth1", "type": "rj45", "x": 0.5, "y": 0.5}],
    )])
    await dispatch_rack("mount_device", {
        "design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1",
        "faceplate_id": "server-4u-storage",
    })
    mount = fake.payload["devices"][0]
    plate = get_faceplate("server-4u-storage")
    assert mount["u_height"] == plate["u_height"] == 4
    assert mount["col_span"] == plate["col_span"]
    assert [p["id"] for p in mount["ports"]] != ["old"]


@pytest.mark.anyio
async def test_mount_device_places_at_the_requested_slot(fake):
    await dispatch_rack("mount_device", {
        "design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1",
        "faceplate_id": "sff-half", "u_start": 7, "col_start": 6,
    })
    mount = fake.payload["devices"][0]
    assert (mount["u_start"], mount["col_start"], mount["col_span"]) == (7, 6, 6)


@pytest.mark.anyio
async def test_mount_device_refuses_a_device_already_racked(fake):
    _use(fake, items=[api_item(racked=True)])
    with pytest.raises(ValueError, match="already mounted"):
        await dispatch_rack(
            "mount_device", {"design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1"}
        )
    assert fake.saved == []


@pytest.mark.anyio
async def test_mount_device_refuses_an_unknown_entry(fake):
    with pytest.raises(ValueError, match="Unknown inventory device"):
        await dispatch_rack(
            "mount_device", {"design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "ghost"}
        )


@pytest.mark.anyio
async def test_mount_device_refuses_an_unknown_faceplate(fake):
    with pytest.raises(ValueError, match="Unknown faceplate"):
        await dispatch_rack("mount_device", {
            "design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1",
            "faceplate_id": "server-9u",
        })


@pytest.mark.anyio
async def test_mount_device_reports_a_rack_with_no_room(fake):
    _use(fake, racks=[api_rack(u_height=2)], devices=[
        api_mount("m1", u_start=1), api_mount("m2", u_start=2),
    ])
    with pytest.raises(ValueError, match="no free slot"):
        await dispatch_rack(
            "mount_device", {"design_id": DESIGN, "rack_id": "r1", "inventory_device_id": "i1"}
        )


@pytest.mark.anyio
async def test_mount_accessory_has_no_inventory_row(fake):
    await dispatch_rack(
        "mount_accessory", {"design_id": DESIGN, "rack_id": "r1", "faceplate_id": "shelf-1u"}
    )
    mount = fake.payload["devices"][0]
    assert mount["device_id"] is None and mount["node_id"] is None
    assert mount["label"] == "Shelf 1U" and mount["ports"] == []


@pytest.mark.anyio
async def test_unmount_device_drops_its_cables_and_keeps_the_inventory_row(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)], cables=[api_cable("c1")])
    result = await dispatch_rack("unmount_device", {"design_id": DESIGN, "mount_id": "m1"})

    assert result["cables_removed"] == 1
    payload = fake.payload
    assert [d["id"] for d in payload["devices"]] == ["m2"]
    assert payload["cables"] == []
    # Nothing was asked of the inventory: unmounting never deletes a device.
    assert result["inventory_device_id"] is None


@pytest.mark.anyio
async def test_unmount_device_rejects_an_unknown_mount(fake):
    with pytest.raises(ValueError, match="Unknown mount"):
        await dispatch_rack("unmount_device", {"design_id": DESIGN, "mount_id": "nope"})


# --- Moving -----------------------------------------------------------------
@pytest.mark.anyio
async def test_move_device_to_a_free_slot(fake):
    _use(fake, devices=[api_mount("m1", u_start=1)])
    await dispatch_rack(
        "move_device", {"design_id": DESIGN, "mount_id": "m1", "u_start": 6}
    )
    assert fake.payload["devices"][0]["u_start"] == 6


@pytest.mark.anyio
async def test_move_device_refuses_an_occupied_slot(fake):
    _use(fake, devices=[api_mount("m1", u_start=1), api_mount("m2", u_start=6)])
    with pytest.raises(ValueError, match="does not fit"):
        await dispatch_rack("move_device", {"design_id": DESIGN, "mount_id": "m1", "u_start": 6})
    assert fake.saved == []


@pytest.mark.anyio
async def test_move_device_to_another_rack(fake):
    _use(
        fake,
        racks=[api_rack("r1"), api_rack("r2", name="Rack 2")],
        devices=[api_mount("m1", rack_id="r1", u_start=3)],
    )
    await dispatch_rack(
        "move_device", {"design_id": DESIGN, "mount_id": "m1", "rack_id": "r2", "u_start": 2}
    )
    moved = fake.payload["devices"][0]
    assert (moved["rack_id"], moved["u_start"]) == ("r2", 2)


@pytest.mark.anyio
async def test_move_device_keeps_what_was_not_asked_for(fake):
    _use(fake, devices=[api_mount("m1", u_start=1, col_start=6, col_span=6)])
    await dispatch_rack("move_device", {"design_id": DESIGN, "mount_id": "m1", "u_start": 5})
    moved = fake.payload["devices"][0]
    assert (moved["col_start"], moved["col_span"]) == (6, 6)


# --- Faceplates -------------------------------------------------------------
@pytest.mark.anyio
async def test_set_device_faceplate_reseeds_ports_and_drops_stale_cables(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=5)], cables=[api_cable("c1")])
    result = await dispatch_rack("set_device_faceplate", {
        "design_id": DESIGN, "mount_id": "m1", "faceplate_id": "switch-8",
    })

    mount = next(d for d in fake.payload["devices"] if d["id"] == "m1")
    plate = get_faceplate("switch-8")
    assert mount["faceplate_id"] == "switch-8"
    assert [p["label"] for p in mount["ports"]] == [p["label"] for p in plate["ports"]]
    assert {p["id"] for p in mount["ports"]}.isdisjoint({"p1", "p2"})
    assert result["cables_removed"] == 1
    assert fake.payload["cables"] == []


@pytest.mark.anyio
async def test_set_device_faceplate_relocates_a_plate_that_no_longer_fits(fake):
    """A 1U mount with a neighbour right above it cannot grow in place."""
    _use(fake, devices=[api_mount("m1", u_start=1), api_mount("m2", u_start=2)])
    await dispatch_rack("set_device_faceplate", {
        "design_id": DESIGN, "mount_id": "m1", "faceplate_id": "server-4u-storage",
    })
    mount = next(d for d in fake.payload["devices"] if d["id"] == "m1")
    assert mount["u_height"] == 4
    assert mount["u_start"] >= 3  # clear of the mount on U2


# --- Cables -----------------------------------------------------------------
@pytest.mark.anyio
async def test_patch_cable_resolves_port_labels(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)])
    result = await dispatch_rack("patch_cable", {
        "design_id": DESIGN,
        "from_mount_id": "m1", "from_port": "eth1",
        "to_mount_id": "m2", "to_port": "ETH2",
    })
    cable = fake.payload["cables"][0]
    assert (cable["from_device_id"], cable["from_port_id"]) == ("m1", "p1")
    assert (cable["to_device_id"], cable["to_port_id"]) == ("m2", "p2")
    # An rj45 patch is copper, and copper is green.
    assert cable["type"] == "ethernet" and cable["color"] == "#39d353"
    assert result["from"] == "Mount eth1"


@pytest.mark.anyio
async def test_patch_cable_from_a_fibre_port_is_fibre(fake):
    sfp = [{"id": "s1", "label": "sfp1", "type": "sfp+", "x": 0.9, "y": 0.5}]
    _use(fake, devices=[api_mount("m1", ports=sfp), api_mount("m2", u_start=2)])
    await dispatch_rack("patch_cable", {
        "design_id": DESIGN,
        "from_mount_id": "m1", "from_port": "sfp1",
        "to_mount_id": "m2", "to_port": "eth1",
    })
    cable = fake.payload["cables"][0]
    assert cable["type"] == "fiber" and cable["color"] == "#f0a500"


@pytest.mark.anyio
async def test_patch_cable_refuses_an_occupied_port(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)], cables=[api_cable("c1")])
    with pytest.raises(ValueError, match="already patched"):
        await dispatch_rack("patch_cable", {
            "design_id": DESIGN,
            "from_mount_id": "m1", "from_port": "eth1",
            "to_mount_id": "m2", "to_port": "eth2",
        })
    assert fake.saved == []


@pytest.mark.anyio
async def test_patch_cable_refuses_a_port_patched_to_itself(fake):
    _use(fake, devices=[api_mount("m1")])
    with pytest.raises(ValueError, match="cannot patch a port to itself"):
        await dispatch_rack("patch_cable", {
            "design_id": DESIGN,
            "from_mount_id": "m1", "from_port": "eth1",
            "to_mount_id": "m1", "to_port": "eth1",
        })


@pytest.mark.anyio
async def test_patch_cable_names_the_ports_it_knows(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)])
    with pytest.raises(ValueError, match="Unknown port 'eth9'.*eth1, eth2"):
        await dispatch_rack("patch_cable", {
            "design_id": DESIGN,
            "from_mount_id": "m1", "from_port": "eth9",
            "to_mount_id": "m2", "to_port": "eth1",
        })


@pytest.mark.anyio
async def test_patch_cable_carries_a_label(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)])
    await dispatch_rack("patch_cable", {
        "design_id": DESIGN,
        "from_mount_id": "m1", "from_port": "eth1",
        "to_mount_id": "m2", "to_port": "eth1",
        "label": "A12", "label_visible": True, "color": "#00d4ff",
    })
    cable = fake.payload["cables"][0]
    assert (cable["label"], cable["label_visible"], cable["color"]) == ("A12", True, "#00d4ff")


@pytest.mark.anyio
async def test_unpatch_cable(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)], cables=[api_cable("c1")])
    await dispatch_rack("unpatch_cable", {"design_id": DESIGN, "cable_id": "c1"})
    assert fake.payload["cables"] == []


@pytest.mark.anyio
async def test_unpatch_cable_rejects_an_unknown_id(fake):
    with pytest.raises(ValueError, match="Unknown cable"):
        await dispatch_rack("unpatch_cable", {"design_id": DESIGN, "cable_id": "ghost"})


# --- Reads ------------------------------------------------------------------
@pytest.mark.anyio
async def test_list_racks_reports_occupancy(fake):
    _use(fake, devices=[api_mount("m1", u_start=1, u_height=2)])
    racks = await dispatch_rack("list_racks", {"design_id": DESIGN})
    assert racks == [{
        "id": "r1", "name": "Rack 1", "u_height": 10, "width_standard": "19",
        "numbering": "bottom-up", "location": None, "mount_count": 1, "free_u": 8,
    }]


@pytest.mark.anyio
async def test_get_rack_returns_mounts_with_their_ports_and_cables(fake):
    _use(fake, devices=[api_mount("m1"), api_mount("m2", u_start=2)], cables=[api_cable("c1")])
    result = await dispatch_rack("get_rack", {"design_id": DESIGN, "rack_id": "r1"})

    mounts = result["racks"][0]["devices"]
    assert [m["id"] for m in mounts] == ["m1", "m2"]
    assert mounts[0]["ports"] == [
        {"id": "p1", "label": "eth1", "type": "rj45"},
        {"id": "p2", "label": "eth2", "type": "rj45"},
    ]
    cable = result["cables"][0]
    assert cable["from"] == {"mount_id": "m1", "device": "Mount", "port_id": "p1", "port": "eth1"}


@pytest.mark.anyio
async def test_get_rack_narrows_to_one_rack(fake):
    _use(
        fake,
        racks=[api_rack("r1"), api_rack("r2", name="Rack 2")],
        devices=[api_mount("m1", rack_id="r1"), api_mount("m2", rack_id="r2")],
    )
    result = await dispatch_rack("get_rack", {"design_id": DESIGN, "rack_id": "r2"})
    assert [r["id"] for r in result["racks"]] == ["r2"]
    assert [d["id"] for d in result["racks"][0]["devices"]] == ["m2"]


@pytest.mark.anyio
async def test_get_rack_rejects_an_unknown_rack(fake):
    with pytest.raises(ValueError, match="Unknown rack"):
        await dispatch_rack("get_rack", {"design_id": DESIGN, "rack_id": "ghost"})


@pytest.mark.anyio
async def test_list_rack_inventory_flags_what_is_racked_and_modelled(fake):
    _use(fake, items=[
        api_item("i1"),
        api_item("i2", label="sw1", racked=True, rack_faceplate_id="switch-24"),
    ])
    items = await dispatch_rack("list_rack_inventory", {"design_id": DESIGN})
    assert items[0]["racked"] is False and items[0]["modelled"] is False
    assert items[1]["racked"] is True and items[1]["modelled"] is True
    assert items[1]["faceplate_id"] == "switch-24"


@pytest.mark.anyio
async def test_list_faceplates_covers_the_catalog(fake):
    plates = await dispatch_rack("list_faceplates", {})
    ids = [p["id"] for p in plates]
    assert "server-1u" in ids and "blank-1u" in ids
    server = next(p for p in plates if p["id"] == "server-2u-bays")
    assert (server["u_height"], server["col_span"], server["port_count"]) == (2, 12, 6)
    assert next(p for p in plates if p["id"] == "shelf-1u")["kind"] == "accessory"


@pytest.mark.anyio
async def test_rack_tools_are_reachable_from_the_main_dispatch(fake):
    """tools._dispatch routes rack names here rather than falling through."""
    from app.tools import _dispatch

    assert await _dispatch("list_racks", {"design_id": DESIGN}) == await dispatch_rack(
        "list_racks", {"design_id": DESIGN}
    )
