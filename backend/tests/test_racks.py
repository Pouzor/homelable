import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.db.models import PendingDevice

pytestmark = pytest.mark.asyncio


async def _design(client: AsyncClient, headers: dict, *, name="Rack Room", design_type="rack") -> str:
    res = await client.post(
        "/api/v1/designs",
        json={"name": name, "icon": "server", "design_type": design_type},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _state(design_id: str, **overrides) -> dict:
    """A minimal but complete rack payload: one rack, two devices, one patch."""
    payload = {
        "design_id": design_id,
        "racks": [
            {
                "id": "rack-1",
                "name": "Main",
                "u_height": 12,
                "width_standard": "19",
                "numbering": "bottom-up",
                "location": "garage",
                "style": {"frame": "#1c2129", "showNumbers": True},
                "pos_x": 40,
                "pos_y": 60,
            }
        ],
        "devices": [
            {
                "id": "dev-sw",
                "rack_id": "rack-1",
                "label": "sw-24",
                "u_start": 10,
                "u_height": 1,
                "col_start": 0,
                "col_span": 12,
                "faceplate_id": "switch-24",
                "status": "online",
                "ports": [{"id": "p1", "label": "1", "type": "rj45", "x": 0.4, "y": 0.5}],
            },
            {
                "id": "dev-nas",
                "rack_id": "rack-1",
                "label": "nas",
                "u_start": 4,
                "u_height": 2,
                "col_start": 0,
                "col_span": 12,
                "faceplate_id": "nas-2u",
                "status": "unknown",
                "ports": [{"id": "p2", "label": "eth0", "type": "rj45", "x": 0.7, "y": 0.5}],
            },
        ],
        "cables": [
            {
                "id": "cbl-1",
                "from_device_id": "dev-sw",
                "from_port_id": "p1",
                "to_device_id": "dev-nas",
                "to_port_id": "p2",
                "type": "ethernet",
                "color": "#39d353",
            }
        ],
        "viewport": {"x": 10, "y": 20, "zoom": 1.5},
    }
    payload.update(overrides)
    return payload


class TestDesignType:
    async def test_creates_a_rack_design(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        res = await client.get("/api/v1/designs", headers=headers)
        design = next(d for d in res.json() if d["id"] == design_id)
        assert design["design_type"] == "rack"

    async def test_rejects_an_unknown_design_type(self, client: AsyncClient, headers):
        res = await client.post(
            "/api/v1/designs",
            json={"name": "Nope", "design_type": "spaceship"},
            headers=headers,
        )
        assert res.status_code == 422


class TestSaveAndLoad:
    async def test_round_trips_the_full_state(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        res = await client.post("/api/v1/racks/save", json=_state(design_id), headers=headers)
        assert res.status_code == 200, res.text

        loaded = (await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)).json()
        assert [r["name"] for r in loaded["racks"]] == ["Main"]
        assert loaded["racks"][0]["u_height"] == 12
        assert loaded["racks"][0]["style"]["showNumbers"] is True
        assert {d["id"] for d in loaded["devices"]} == {"dev-sw", "dev-nas"}
        assert loaded["devices"][0]["ports"][0]["type"] == "rj45"
        assert loaded["cables"][0]["from_port_id"] == "p1"
        assert loaded["viewport"] == {"x": 10, "y": 20, "zoom": 1.5}

    async def test_keeps_a_mount_that_follows_its_node_check(
        self, client: AsyncClient, headers
    ):
        # "Check device" is stored as `auto` on the mount: the rack has no
        # checker, it reads the linked node's live status at render time. The
        # status column is free-form, so this only guards it staying that way.
        design_id = await _design(client, headers)
        state = _state(design_id)
        state["devices"][0]["status"] = "auto"
        res = await client.post("/api/v1/racks/save", json=state, headers=headers)
        assert res.status_code == 200, res.text

        loaded = (await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)).json()
        mount = next(d for d in loaded["devices"] if d["id"] == "dev-sw")
        assert mount["status"] == "auto"

    async def test_prunes_what_the_client_dropped(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        await client.post("/api/v1/racks/save", json=_state(design_id), headers=headers)

        trimmed = _state(design_id)
        trimmed["devices"] = [d for d in trimmed["devices"] if d["id"] == "dev-sw"]
        trimmed["cables"] = []
        await client.post("/api/v1/racks/save", json=trimmed, headers=headers)

        loaded = (await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)).json()
        assert {d["id"] for d in loaded["devices"]} == {"dev-sw"}
        assert loaded["cables"] == []

    async def test_updates_an_existing_device_in_place(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        await client.post("/api/v1/racks/save", json=_state(design_id), headers=headers)

        moved = _state(design_id)
        moved["devices"][1]["u_start"] = 1
        moved["devices"][1]["label"] = "nas-renamed"
        await client.post("/api/v1/racks/save", json=moved, headers=headers)

        loaded = (await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)).json()
        nas = next(d for d in loaded["devices"] if d["id"] == "dev-nas")
        assert (nas["u_start"], nas["label"]) == (1, "nas-renamed")

    async def test_keeps_designs_isolated(self, client: AsyncClient, headers):
        first = await _design(client, headers, name="Rack A")
        second = await _design(client, headers, name="Rack B")
        await client.post("/api/v1/racks/save", json=_state(first), headers=headers)

        loaded = (await client.get(f"/api/v1/racks?design_id={second}", headers=headers)).json()
        assert loaded["racks"] == []
        assert loaded["devices"] == []

    async def test_refuses_to_steal_a_row_from_another_design(
        self, client: AsyncClient, headers
    ):
        """Ids come from the client, so a stale tab or a copy can collide.

        The upsert sets `design_id` from the payload: without a guard, saving
        design B with an id owned by design A moved A's rack — devices and
        cables with it — into B, and A silently lost it.
        """
        first = await _design(client, headers, name="Rack A")
        second = await _design(client, headers, name="Rack B")
        await client.post("/api/v1/racks/save", json=_state(first), headers=headers)

        res = await client.post("/api/v1/racks/save", json=_state(second), headers=headers)
        assert res.status_code == 409

        kept = (await client.get(f"/api/v1/racks?design_id={first}", headers=headers)).json()
        assert [r["id"] for r in kept["racks"]] == ["rack-1"]
        assert len(kept["devices"]) == 2

    async def test_rejects_an_unknown_design(self, client: AsyncClient, headers):
        res = await client.post("/api/v1/racks/save", json=_state("nope"), headers=headers)
        assert res.status_code == 404

    async def test_rejects_a_device_pointing_outside_the_payload(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        broken = _state(design_id)
        broken["devices"][0]["rack_id"] = "rack-ghost"
        res = await client.post("/api/v1/racks/save", json=broken, headers=headers)
        assert res.status_code == 400

    async def test_rejects_a_cable_pointing_outside_the_payload(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        broken = _state(design_id)
        broken["cables"][0]["to_device_id"] = "dev-ghost"
        res = await client.post("/api/v1/racks/save", json=broken, headers=headers)
        assert res.status_code == 400

    @pytest.mark.parametrize(
        "patch",
        [
            {"u_height": 0},
            {"width_standard": "23"},
            {"numbering": "sideways"},
        ],
    )
    async def test_rejects_invalid_rack_geometry(self, client: AsyncClient, headers, patch):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["racks"][0].update(patch)
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 422

    @pytest.mark.parametrize(
        "patch",
        [
            {"u_start": 0},
            {"col_start": 12},
            {"col_span": 13},
        ],
    )
    async def test_rejects_invalid_device_geometry(self, client: AsyncClient, headers, patch):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["devices"][0].update(patch)
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 422

    async def test_rejects_a_device_taller_than_its_rack(self, client: AsyncClient, headers):
        # Each field is legal on its own; only the rack says otherwise. A mount
        # above the top rail draws outside the chassis with no way to drag it back.
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["devices"][0]["u_start"] = 40  # rack is 12U
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 422

    async def test_rejects_a_device_whose_height_overruns_the_rack(
        self, client: AsyncClient, headers
    ):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["devices"][0].update({"u_start": 11, "u_height": 4})  # 11..14 of 12U
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 422

    async def test_accepts_a_device_that_ends_on_the_top_rail(
        self, client: AsyncClient, headers
    ):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["devices"][0].update({"u_start": 11, "u_height": 2})  # 11..12 of 12U
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 200, res.text

    async def test_rejects_a_span_that_overruns_the_column_grid(
        self, client: AsyncClient, headers
    ):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["devices"][0].update({"col_start": 11, "col_span": 12})
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 422

    async def test_accepts_a_half_width_pair_sharing_one_u(
        self, client: AsyncClient, headers
    ):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["devices"][0].update({"col_start": 0, "col_span": 6})
        payload["devices"][1].update({"col_start": 6, "col_span": 6})
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 200, res.text

    async def test_rejects_an_unknown_cable_type(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["cables"][0]["type"] = "power"
        res = await client.post("/api/v1/racks/save", json=payload, headers=headers)
        assert res.status_code == 422

    async def test_round_trips_cable_annotations(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["cables"][0].update(
            {
                "label": "Uplink to core",
                "label_visible": True,
                "properties": [
                    {"key": "Length", "value": "2 m", "icon": None, "visible": True},
                    {"key": "VLAN", "value": "20", "icon": None, "visible": False},
                ],
            }
        )
        assert (
            await client.post("/api/v1/racks/save", json=payload, headers=headers)
        ).status_code == 200

        cable = (
            await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)
        ).json()["cables"][0]
        assert cable["label"] == "Uplink to core"
        assert cable["label_visible"] is True
        assert [p["key"] for p in cable["properties"]] == ["Length", "VLAN"]
        assert cable["properties"][1]["visible"] is False

    async def test_defaults_cable_annotations_when_absent(
        self, client: AsyncClient, headers
    ):
        # A client that predates the feature sends neither key; the response must
        # still carry usable values rather than nulls.
        design_id = await _design(client, headers)
        assert (
            await client.post("/api/v1/racks/save", json=_state(design_id), headers=headers)
        ).status_code == 200

        cable = (
            await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)
        ).json()["cables"][0]
        assert cable["label_visible"] is False
        assert cable["properties"] == []

    async def test_drops_cable_properties_with_no_key(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["cables"][0]["properties"] = [
            {"key": "  ", "value": "orphan", "icon": None, "visible": True},
            {"key": "Length", "value": "2 m", "icon": None, "visible": True},
        ]
        assert (
            await client.post("/api/v1/racks/save", json=payload, headers=headers)
        ).status_code == 200

        cable = (
            await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)
        ).json()["cables"][0]
        assert [p["key"] for p in cable["properties"]] == ["Length"]

    async def test_updates_cable_annotations_on_a_second_save(
        self, client: AsyncClient, headers
    ):
        design_id = await _design(client, headers)
        payload = _state(design_id)
        payload["cables"][0]["properties"] = [
            {"key": "Length", "value": "2 m", "icon": None, "visible": True}
        ]
        await client.post("/api/v1/racks/save", json=payload, headers=headers)

        payload["cables"][0]["properties"] = []
        payload["cables"][0]["label_visible"] = True
        await client.post("/api/v1/racks/save", json=payload, headers=headers)

        cable = (
            await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)
        ).json()["cables"][0]
        assert cable["properties"] == []
        assert cable["label_visible"] is True

    async def test_requires_auth(self, client: AsyncClient):
        assert (await client.get("/api/v1/racks?design_id=any")).status_code == 401


class TestInventory:
    async def test_lists_rackable_devices_only(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        await client.post(
            "/api/v1/scan/pending",
            json={"hostname": "pve-01", "suggested_type": "proxmox"},
            headers=headers,
        )
        await client.post(
            "/api/v1/scan/pending",
            json={"hostname": "phone", "suggested_type": "mobile"},
            headers=headers,
        )

        res = await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        labels = [i["label"] for i in res.json()["items"]]
        assert "pve-01" in labels
        assert "phone" not in labels

    async def test_names_a_device_the_way_the_inventory_does(
        self, client: AsyncClient, headers, db_session
    ):
        """A scan find with no hostname is named after the app it runs, not its IP.

        The rack picker used to show "192.168.1.63 · 192.168.1.63" where the
        Device Inventory showed "jellyfin".
        """
        design_id = await _design(client, headers)
        db_session.add(
            PendingDevice(
                id="pd-services",
                ip="192.168.1.63",
                services=[
                    {"port": 443, "category": "web", "service_name": "https"},
                    {"port": 8096, "category": "media", "service_name": "jellyfin"},
                ],
                suggested_type="server",
            )
        )
        db_session.add(PendingDevice(id="pd-bare", ip="192.168.1.64", suggested_type="server"))
        # A portless service is no fingerprint: the inventory skips it, so must
        # this — `None not in _COMMON_PORTS` is True and used to let it through.
        db_session.add(
            PendingDevice(
                id="pd-portless",
                ip="192.168.1.65",
                services=[{"port": None, "category": "media", "service_name": "jellyfin"}],
                suggested_type="server",
            )
        )
        await db_session.commit()

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        assert next(i for i in items if i["id"] == "pd-services")["label"] == "jellyfin"
        # Nothing better to say: the IP stays the label, and the UI stops doubling it.
        assert next(i for i in items if i["id"] == "pd-bare")["label"] == "192.168.1.64"
        assert next(i for i in items if i["id"] == "pd-portless")["label"] == "192.168.1.65"

    async def test_flags_devices_already_mounted(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        created = (
            await client.post(
                "/api/v1/scan/pending",
                json={"hostname": "sw-24", "suggested_type": "switch"},
                headers=headers,
            )
        ).json()

        payload = _state(design_id)
        payload["devices"][0]["device_id"] = created["id"]
        await client.post("/api/v1/racks/save", json=payload, headers=headers)

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        assert next(i for i in items if i["id"] == created["id"])["racked"] is True

    async def test_resolves_the_canvas_node_for_live_status(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        node = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "server", "label": "nas", "ip": "192.168.1.9", "status": "online"},
                headers=headers,
            )
        ).json()
        await client.post(
            "/api/v1/scan/pending",
            json={"hostname": "nas", "ip": "192.168.1.9", "suggested_type": "nas"},
            headers=headers,
        )

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        entry = next(i for i in items if i["label"] == "nas")
        assert entry["node_id"] == node["id"]
        assert entry["node_status"] == "online"

    async def test_reports_what_the_canvas_node_knows(
        self, client: AsyncClient, headers, db_session
    ):
        """The rack prints the logical view's facts, so the endpoint must ship them."""
        rack_design = await _design(client, headers)
        network = await _design(client, headers, name="Network", design_type="network")
        await client.post(
            "/api/v1/nodes",
            json={
                "type": "nas",
                "label": "nas-truenas",
                "design_id": network,
                "ip": "192.168.1.9",
                "mac": "aa:bb:cc:dd:ee:ff",
                "hostname": "nas.lan",
                "os": "TrueNAS SCALE",
                "status": "online",
                "check_method": "http",
            },
            headers=headers,
        )
        # Straight to the table: the manual-create schema carries no os/services,
        # and a scan find does.
        db_session.add(
            PendingDevice(
                id="pd-nas",
                hostname="nas",
                ip="192.168.1.9",
                mac="aa:bb:cc:dd:ee:ff",
                os="TrueNAS",
                suggested_type="nas",
                services=[{"port": 445, "service_name": "smb", "category": "storage"}],
            )
        )
        await db_session.commit()

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={rack_design}", headers=headers)
        ).json()["items"]
        entry = next(i for i in items if i["ip"] == "192.168.1.9")
        assert entry["mac"] == "aa:bb:cc:dd:ee:ff"
        assert entry["os"] == "TrueNAS"
        assert entry["services"] == [{"port": 445, "name": "smb"}]
        assert entry["node_label"] == "nas-truenas"
        assert entry["node_type"] == "nas"
        assert entry["node_hostname"] == "nas.lan"
        assert entry["node_os"] == "TrueNAS SCALE"
        assert entry["node_check_method"] == "http"
        assert entry["node_design_id"] == network
        assert entry["node_design_name"] == "Network"

    async def test_stamps_last_seen_with_an_offset(self, client: AsyncClient, headers, db_session):
        """SQLite reads `last_seen` back naive, and a naive ISO string is *local*
        time to `new Date()` — the panel printed it shifted by the viewer's offset.
        """
        design_id = await _design(client, headers)
        node = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "server", "label": "seen", "ip": "192.168.1.77"},
                headers=headers,
            )
        ).json()
        db_session.add(PendingDevice(id="pd-seen", ip="192.168.1.77", suggested_type="server"))
        await db_session.execute(
            text("UPDATE nodes SET last_seen = :ts WHERE id = :id"),
            {"ts": "2026-08-08 10:00:00.000000", "id": node["id"]},
        )
        await db_session.commit()

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        entry = next(i for i in items if i["id"] == "pd-seen")
        assert entry["node_last_seen"].endswith(("Z", "+00:00"))

    async def test_leaves_the_node_fields_empty_without_a_match(
        self, client: AsyncClient, headers
    ):
        design_id = await _design(client, headers)
        await client.post(
            "/api/v1/scan/pending",
            json={"hostname": "pdu-main", "suggested_type": "generic"},
            headers=headers,
        )

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        entry = next(i for i in items if i["label"] == "pdu-main")
        assert entry["node_id"] is None
        assert entry["node_label"] is None
        assert entry["node_design_name"] is None
        assert entry["services"] == []

    async def test_falls_back_to_the_node_services(self, client: AsyncClient, headers, db_session):
        """An approved device keeps its fingerprint on the node, not the inventory row."""
        design_id = await _design(client, headers)
        await client.post(
            "/api/v1/nodes",
            json={
                "type": "server",
                "label": "media",
                "ip": "192.168.1.63",
                "services": [{"port": 8096, "service_name": "jellyfin", "category": "media"}],
            },
            headers=headers,
        )
        db_session.add(
            PendingDevice(id="pd-noservices", ip="192.168.1.63", suggested_type="server")
        )
        await db_session.commit()

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        entry = next(i for i in items if i["id"] == "pd-noservices")
        assert entry["services"] == [{"port": 8096, "name": "jellyfin"}]

    async def test_manual_entry_is_tagged_as_such(self, client: AsyncClient, headers):
        created = (
            await client.post(
                "/api/v1/scan/pending",
                json={"hostname": "patch-panel", "suggested_type": "generic"},
                headers=headers,
            )
        ).json()
        assert created["discovery_source"] == "manual"
        assert created["status"] == "pending"

        listed = (await client.get("/api/v1/scan/pending", headers=headers)).json()
        assert any(d["id"] == created["id"] for d in listed)


class TestRackSourcedInventory:
    """Gear created from a rack canvas shares the Device Inventory, but never a
    logical canvas: it documents a mount, not a host."""

    async def _rack_device(self, client: AsyncClient, headers, hostname: str = "patch-house"):
        return (
            await client.post(
                "/api/v1/scan/pending",
                json={"hostname": hostname, "discovery_source": "rack"},
                headers=headers,
            )
        ).json()

    async def test_records_the_rack_source(self, client: AsyncClient, headers):
        created = await self._rack_device(client, headers)
        assert created["discovery_source"] == "rack"
        assert created["discovery_sources"] == ["rack"]

    async def test_rejects_an_unknown_source(self, client: AsyncClient, headers):
        res = await client.post(
            "/api/v1/scan/pending",
            json={"hostname": "spoof", "discovery_source": "zigbee"},
            headers=headers,
        )
        assert res.status_code == 422

    async def test_approve_refuses_rack_gear(self, client: AsyncClient, headers):
        created = await self._rack_device(client, headers)
        res = await client.post(
            f"/api/v1/scan/pending/{created['id']}/approve",
            json={"type": "generic", "label": "patch-house"},
            headers=headers,
        )
        assert res.status_code == 409
        assert "rack" in res.json()["detail"].lower()

    async def test_bulk_approve_skips_rack_gear(self, client: AsyncClient, headers):
        rack_device = await self._rack_device(client, headers)
        scanned = (
            await client.post(
                "/api/v1/scan/pending",
                json={"hostname": "nuc", "ip": "192.168.1.77", "suggested_type": "server"},
                headers=headers,
            )
        ).json()

        res = await client.post(
            "/api/v1/scan/pending/bulk-approve",
            json={"device_ids": [rack_device["id"], scanned["id"]]},
            headers=headers,
        )
        body = res.json()
        assert body["approved"] == 1
        assert body["device_ids"] == [scanned["id"]]
        skipped = next(s for s in body["skipped_devices"] if s["device_id"] == rack_device["id"])
        assert skipped["match"] == "rack"

    async def test_rack_gear_is_offered_to_the_rack_inventory(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        created = await self._rack_device(client, headers, hostname="blank-panel")
        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        assert any(i["id"] == created["id"] for i in items)


class TestDesignLifecycle:
    async def test_deleting_a_design_removes_its_rack_rows(self, client: AsyncClient, headers):
        keeper = await _design(client, headers, name="Keeper", design_type="network")
        design_id = await _design(client, headers)
        await client.post("/api/v1/racks/save", json=_state(design_id), headers=headers)

        assert (await client.delete(f"/api/v1/designs/{design_id}", headers=headers)).status_code == 204
        assert (await client.get(f"/api/v1/racks?design_id={design_id}", headers=headers)).status_code == 404
        # The other design is untouched.
        assert (await client.get(f"/api/v1/racks?design_id={keeper}", headers=headers)).status_code == 200

    async def test_unmounting_keeps_the_inventory_entry(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        created = (
            await client.post(
                "/api/v1/scan/pending",
                json={"hostname": "sw-24", "suggested_type": "switch"},
                headers=headers,
            )
        ).json()

        payload = _state(design_id)
        payload["devices"][0]["device_id"] = created["id"]
        await client.post("/api/v1/racks/save", json=payload, headers=headers)

        # Unmount: the device disappears from the rack payload entirely.
        unmounted = _state(design_id)
        unmounted["devices"] = [d for d in unmounted["devices"] if d["id"] != "dev-sw"]
        unmounted["cables"] = []
        await client.post("/api/v1/racks/save", json=unmounted, headers=headers)

        items = (
            await client.get(f"/api/v1/racks/inventory?design_id={design_id}", headers=headers)
        ).json()["items"]
        entry = next(i for i in items if i["id"] == created["id"])
        assert entry["racked"] is False

    async def test_copying_a_rack_design_duplicates_its_racks(self, client: AsyncClient, headers):
        design_id = await _design(client, headers)
        await client.post("/api/v1/racks/save", json=_state(design_id), headers=headers)

        copy = (
            await client.post(
                f"/api/v1/designs/{design_id}/copy",
                json={"name": "Rack Room (copy)", "icon": "server"},
                headers=headers,
            )
        ).json()
        assert copy["design_type"] == "rack"

        loaded = (await client.get(f"/api/v1/racks?design_id={copy['id']}", headers=headers)).json()
        assert [r["name"] for r in loaded["racks"]] == ["Main"]
        assert len(loaded["devices"]) == 2
        assert len(loaded["cables"]) == 1
        # Fresh ids, so editing the copy cannot touch the original.
        assert loaded["racks"][0]["id"] != "rack-1"
        assert {d["id"] for d in loaded["devices"]}.isdisjoint({"dev-sw", "dev-nas"})
        # Cables still join the copied devices, not the originals.
        copied_ids = {d["id"] for d in loaded["devices"]}
        assert loaded["cables"][0]["from_device_id"] in copied_ids
        assert loaded["cables"][0]["to_device_id"] in copied_ids
