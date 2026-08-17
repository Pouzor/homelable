"""The node ↔ Device Inventory link: matching, merging, and the 3.3.0 backfill.

The inventory row owns the device facts; a node owns how the device is drawn.
These tests pin the rules that make one device end up as one row even when it
was drawn on several canvases.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from app.db.models import Design, InventoryDevice, Node
from app.services.inventory_sync import (
    backfill_node_devices,
    changed_facts,
    find_device_for,
    hydrated_node,
    link_facts,
    merge_properties,
    merge_services,
    seed_node_views,
)


def _now(offset_minutes: int = 0) -> datetime:
    return datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc) + timedelta(minutes=offset_minutes)


async def _design(db_session, name="Net") -> str:
    design = Design(id=str(uuid.uuid4()), name=name)
    db_session.add(design)
    await db_session.commit()
    return design.id


def _node(design_id: str, **kwargs) -> Node:
    payload = {
        "id": str(uuid.uuid4()),
        "label": "n",
        "type": "server",
        "pos_x": 0.0,
        "pos_y": 0.0,
        "design_id": design_id,
    }
    payload.update(kwargs)
    return Node(**payload)


# --- pure merge rules -------------------------------------------------------


class TestMergeRules:
    def test_properties_union_on_key_with_incoming_winning(self):
        base = [{"key": "Rack", "value": "A1", "icon": None, "visible": True}]
        incoming = [
            {"key": "rack", "value": "B2", "icon": None, "visible": False},
            {"key": "Owner", "value": "me", "icon": None, "visible": True},
        ]
        out = merge_properties(base, incoming)
        assert [p["value"] for p in out] == ["B2", "me"]
        # Existing keys keep their position — a user's ordering survives.
        assert out[0]["key"] == "Rack"
        assert out[0]["visible"] is False

    def test_properties_keep_established_value_when_incoming_is_blank(self):
        out = merge_properties(
            [{"key": "Rack", "value": "A1", "icon": "Server", "visible": True}],
            [{"key": "Rack", "value": "", "icon": None, "visible": True}],
        )
        assert out[0]["value"] == "A1"
        assert out[0]["icon"] == "Server"

    def test_services_union_on_port_protocol_and_name(self):
        base = [{"port": 22, "protocol": "tcp", "service_name": "ssh"}]
        incoming = [
            {"port": 22, "protocol": "tcp", "service_name": "SSH", "icon": "Terminal"},
            {"port": 80, "protocol": "tcp", "service_name": "http"},
        ]
        out = merge_services(base, incoming)
        assert len(out) == 2
        assert out[0]["icon"] == "Terminal"
        assert out[1]["port"] == 80


class TestChangedFacts:
    """What a save is allowed to write: its edit, not its whole snapshot."""

    def test_an_unchanged_snapshot_writes_nothing(self):
        device = InventoryDevice(
            id="d-1",
            label="NAS",
            type="nas",
            hostname="nas.lan",
            ip="10.0.0.5",
            notes="in the garage",
            status_live="online",
            properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
        )
        facts = {
            "label": "NAS",
            "type": "nas",
            "hostname": "nas.lan",
            "ip": "10.0.0.5",
            "notes": "in the garage",
            "status": "online",
            "properties": [{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            "services": [{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
        }
        assert changed_facts(device, facts) == {}

    def test_only_the_edited_field_survives(self):
        device = InventoryDevice(id="d-1", hostname="nas.lan", ip="10.0.0.5", notes="old")
        facts = {"hostname": "nas.lan", "ip": "10.0.0.5", "notes": "new"}
        assert changed_facts(device, facts) == {"notes": "new"}

    def test_a_blank_incoming_value_is_not_a_change(self):
        # A blank never clears an established value, so it is not an edit either.
        device = InventoryDevice(id="d-1", hostname="nas.lan", notes="keep me")
        assert changed_facts(device, {"hostname": "", "notes": None}) == {}

    def test_a_changed_list_is_sent_whole(self):
        device = InventoryDevice(
            id="d-1",
            properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
        )
        facts = {
            "properties": [],
            "services": [{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
        }
        # Replace semantics need the full list, and the untouched one stays out.
        assert changed_facts(device, facts) == {"properties": []}

    def test_live_status_only_fills_a_row_never_checked(self):
        unknown = InventoryDevice(id="d-1", status_live="unknown")
        assert changed_facts(unknown, {"status": "online"}) == {"status": "online"}
        checked = InventoryDevice(id="d-2", status_live="offline")
        # The status checker owns reachability; a stale canvas must not reset it.
        assert changed_facts(checked, {"status": "online"}) == {}


# --- matching ---------------------------------------------------------------


class TestFindDeviceFor:
    @pytest.mark.asyncio
    async def test_prefers_ieee_over_ip_and_mac(self, db_session):
        by_ip = InventoryDevice(id="d-ip", ip="10.0.0.5")
        by_ieee = InventoryDevice(id="d-ieee", ieee_address="0xAAA")
        db_session.add_all([by_ip, by_ieee])
        await db_session.commit()

        found = await find_device_for(db_session, ip="10.0.0.5", mac=None, ieee="0xAAA")
        assert found is not None and found.id == "d-ieee"

    @pytest.mark.asyncio
    async def test_matches_one_address_out_of_a_comma_list(self, db_session):
        device = InventoryDevice(id="d-1", ip="10.0.0.5, fd00::1")
        db_session.add(device)
        await db_session.commit()

        found = await find_device_for(db_session, ip="fd00::1", mac=None, ieee=None)
        assert found is not None and found.id == "d-1"

    @pytest.mark.asyncio
    async def test_does_not_match_a_longer_address_with_the_same_prefix(self, db_session):
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.40"))
        await db_session.commit()

        assert await find_device_for(db_session, ip="10.0.0.4", mac=None, ieee=None) is None

    @pytest.mark.asyncio
    async def test_matches_a_hidden_row_rather_than_minting_a_second(self, db_session):
        db_session.add(InventoryDevice(id="d-hidden", ip="10.0.0.5", status="hidden"))
        await db_session.commit()

        found = await find_device_for(db_session, ip="10.0.0.5", mac=None, ieee=None)
        assert found is not None and found.id == "d-hidden"

    @pytest.mark.asyncio
    async def test_matches_an_ieee_written_in_another_case(self, db_session):
        """One radio, one row: `ieee_address` is UNIQUE, so a case-sensitive
        match here would mint a second row the index then refuses."""
        db_session.add(InventoryDevice(id="d-1", ieee_address="0x00124b0022334455"))
        await db_session.commit()

        found = await find_device_for(
            db_session, ip=None, mac=None, ieee="0x00124B0022334455"
        )
        assert found is not None and found.id == "d-1"


class TestIeeeCollisions:
    """`device_inventory.ieee_address` is UNIQUE — a merge must never duplicate it."""

    @pytest.mark.asyncio
    async def test_an_address_another_row_owns_is_left_where_it_is(self, db_session):
        """The node is already linked, so identity is settled — the IEEE is not
        a reason to move it, and writing it here would violate the index."""
        design = await _design(db_session)
        db_session.add_all([
            InventoryDevice(id="d-radio", ieee_address="0xAAA"),
            InventoryDevice(id="d-host", ip="10.0.0.5"),
        ])
        node = _node(design, device_id="d-host")
        db_session.add(node)
        await db_session.commit()

        device = await link_facts(
            db_session, node, {"ip": "10.0.0.5", "ieee_address": "0xAAA"}, overwrite_scalars=True
        )
        await db_session.commit()

        assert device is not None and device.id == "d-host"
        assert device.ieee_address is None
        radio = await db_session.get(InventoryDevice, "d-radio")
        assert radio is not None and radio.ieee_address == "0xAAA"

    @pytest.mark.asyncio
    async def test_the_row_that_already_holds_it_keeps_writing_it(self, db_session):
        design = await _design(db_session)
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", ieee_address="0xAAA"))
        node = _node(design)
        db_session.add(node)
        await db_session.commit()

        device = await link_facts(
            db_session, node, {"ip": "10.0.0.5", "ieee_address": "0xAAA"}, overwrite_scalars=True
        )
        await db_session.commit()

        assert device is not None and device.ieee_address == "0xAAA"


# --- the backfill -----------------------------------------------------------


class TestBackfill:
    """The 3.3.0 migration path.

    A pre-3.3.0 database still has the device columns on `nodes`; the backfill
    reads them with raw SQL (the model no longer declares them) and folds each
    node's view into an inventory row. These tests recreate that shape.
    """

    async def _legacy_nodes_table(self, db_session) -> None:
        """Re-add the pre-3.3.0 device columns to `nodes`."""
        for column, sql_type in (
            ("hostname", "VARCHAR"), ("ip", "VARCHAR"), ("mac", "VARCHAR"), ("os", "VARCHAR"),
            ("status", "VARCHAR"), ("check_method", "VARCHAR"), ("check_target", "VARCHAR"),
            ("services", "JSON"), ("notes", "TEXT"), ("cpu_count", "INTEGER"),
            ("cpu_model", "VARCHAR"), ("ram_gb", "FLOAT"), ("disk_gb", "FLOAT"),
            ("show_hardware", "BOOLEAN"), ("properties", "JSON"), ("ieee_address", "VARCHAR"),
            ("last_seen", "DATETIME"), ("last_scan", "DATETIME"), ("response_time_ms", "INTEGER"),
        ):
            await db_session.execute(text(f"ALTER TABLE nodes ADD COLUMN {column} {sql_type}"))
        await db_session.commit()

    async def _legacy_node(self, db_session, design_id: str, *, updated_at=None, **facts) -> str:
        node_id = str(uuid.uuid4())
        columns = {
            "id": node_id,
            "label": facts.pop("label", "n"),
            "type": facts.pop("type", "server"),
            "design_id": design_id,
            "pos_x": 0.0,
            "pos_y": 0.0,
            "container_mode": 0,
            "show_port_numbers": 0,
            "bottom_handles": 1,
            "top_handles": 1,
            "left_handles": 0,
            "right_handles": 0,
            "created_at": _now(0),
            "updated_at": updated_at or _now(0),
        }
        for key in ("services", "properties"):
            if key in facts:
                facts[key] = json.dumps(facts[key])
        columns.update(facts)
        names = ", ".join(columns)
        binds = ", ".join(f":{c}" for c in columns)
        await db_session.execute(text(f"INSERT INTO nodes ({names}) VALUES ({binds})"), columns)
        await db_session.commit()
        return node_id

    @pytest.mark.asyncio
    async def test_does_nothing_when_the_columns_are_already_gone(self, db_session):
        """A second boot: there is no legacy data left to read."""
        design = await _design(db_session)
        db_session.add(_node(design))
        await db_session.commit()

        assert await backfill_node_devices(db_session) == {"linked": 0, "created": 0, "merged": 0, "skipped": 0}

    @pytest.mark.asyncio
    async def test_links_a_node_to_its_existing_row(self, db_session):
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", hostname="nas"))
        await db_session.commit()
        node_id = await self._legacy_node(db_session, design, ip="10.0.0.5", label="NAS")

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats == {"linked": 1, "created": 0, "merged": 1, "skipped": 0}
        node = await db_session.get(Node, node_id)
        assert node is not None and node.device_id == "d-1"

    @pytest.mark.asyncio
    async def test_creates_a_row_for_a_node_no_scan_ever_saw(self, db_session):
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        node_id = await self._legacy_node(
            db_session, design, label="Dumb switch", type="switch", notes="under the desk"
        )

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats == {"linked": 1, "created": 1, "merged": 0, "skipped": 0}
        node = await db_session.get(Node, node_id)
        assert node is not None
        device = await db_session.get(InventoryDevice, node.device_id)
        assert device is not None
        assert device.label == "Dumb switch"
        assert device.type == "switch"
        assert device.notes == "under the desk"
        assert device.status == "approved"
        assert device.discovery_sources == ["canvas"]

    @pytest.mark.asyncio
    async def test_two_canvases_one_device_merge_into_one_row(self, db_session):
        """The whole point: the same host drawn twice becomes one inventory row."""
        await self._legacy_nodes_table(db_session)
        design_a = await _design(db_session, "A")
        design_b = await _design(db_session, "B")
        older = await self._legacy_node(
            db_session, design_a,
            ip="10.0.0.5", label="nas-old", hostname="nas.lan", notes="older note",
            properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
            updated_at=_now(0),
        )
        newer = await self._legacy_node(
            db_session, design_b,
            ip="10.0.0.5", label="nas-new", os="TrueNAS",
            properties=[{"key": "Owner", "value": "me", "icon": None, "visible": True}],
            services=[{"port": 80, "protocol": "tcp", "service_name": "http"}],
            updated_at=_now(30),
        )

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 2
        node_a = await db_session.get(Node, older)
        node_b = await db_session.get(Node, newer)
        assert node_a is not None and node_b is not None
        assert node_a.device_id == node_b.device_id
        device = await db_session.get(InventoryDevice, node_a.device_id)
        assert device is not None
        # Scalars: most recent edit wins, blanks never wipe an established value.
        assert device.label == "nas-new"
        assert device.hostname == "nas.lan"
        assert device.os == "TrueNAS"
        assert device.notes == "older note"
        # Cumulative fields: union of both canvases.
        assert {p["key"] for p in device.properties} == {"Rack", "Owner"}
        assert {s["port"] for s in device.services} == {22, 80}

    @pytest.mark.asyncio
    async def test_leaves_canvas_furniture_alone(self, db_session):
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        for kind in ("group", "groupRect", "text"):
            await self._legacy_node(db_session, design, type=kind, label=kind)

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 0
        assert (await db_session.execute(select(InventoryDevice))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_carries_over_timestamps_stored_as_text(self, db_session):
        """The legacy columns are read with raw SQL, so SQLite hands the DATETIME
        ones back as strings. Writing one straight into the row raises
        ``TypeError: SQLite DateTime type only accepts Python datetime and date
        objects`` — which used to abort the whole backfill (issue #347)."""
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        node_id = await self._legacy_node(
            db_session,
            design,
            ip="10.0.0.5",
            label="Dockerhost",
            status="online",
            last_seen="2026-08-15 04:10:22.123456",
            last_scan="2026-08-15 04:00:00",
        )

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats == {"linked": 1, "created": 1, "merged": 0, "skipped": 0}
        node = await db_session.get(Node, node_id)
        assert node is not None
        device = await db_session.get(InventoryDevice, node.device_id)
        assert device is not None
        assert device.last_seen == datetime(2026, 8, 15, 4, 10, 22, 123456)
        assert device.last_scan == datetime(2026, 8, 15, 4, 0, 0)
        assert device.status_live == "online"

    @pytest.mark.asyncio
    async def test_a_stamp_it_cannot_parse_costs_only_the_stamp(self, db_session):
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        await self._legacy_node(db_session, design, ip="10.0.0.5", last_seen="not a date")

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 1
        device = (await db_session.execute(select(InventoryDevice))).scalars().one()
        assert device.last_seen is None
        assert device.ip == "10.0.0.5"

    @pytest.mark.asyncio
    async def test_one_unwritable_node_does_not_cost_the_others_their_link(self, db_session, monkeypatch):
        """Whatever a single node raises — not only a constraint violation — the
        rest of the canvas still gets linked."""
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        await self._legacy_node(db_session, design, ip="10.0.0.5", label="good")
        await self._legacy_node(db_session, design, ip="10.0.0.6", label="bad")

        import app.services.inventory_sync as module

        real = module.link_facts

        async def link_facts(db, node, facts, **kwargs):
            if facts.get("ip") == "10.0.0.6":
                raise TypeError("SQLite DateTime type only accepts Python datetime")
            return await real(db, node, facts, **kwargs)

        monkeypatch.setattr(module, "link_facts", link_facts)

        stats = await module.backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 1
        assert stats["skipped"] == 1
        devices = (await db_session.execute(select(InventoryDevice))).scalars().all()
        assert [d.ip for d in devices] == ["10.0.0.5"]

    @pytest.mark.asyncio
    async def test_fills_a_blank_row_a_stuck_canvas_save_created(self, db_session):
        """A save made while an earlier migration was stuck linked the node to a
        row minted from a blank UI. Those facts only exist in the legacy columns,
        and the drop is about to remove them — so fill the row before it does."""
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        db_session.add(InventoryDevice(id="d-blank", ip="", label="Dockerhost", services=[]))
        await db_session.commit()
        node_id = await self._legacy_node(
            db_session, design, label="Dockerhost", ip="192.168.0.42", hostname="clara.lan",
            notes="in the cupboard", services=[{"port": 443, "protocol": "tcp", "service_name": "https"}],
        )
        node = await db_session.get(Node, node_id)
        node.device_id = "d-blank"
        await db_session.commit()

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 1
        device = await db_session.get(InventoryDevice, "d-blank")
        assert device is not None
        assert device.ip == "192.168.0.42"
        assert device.hostname == "clara.lan"
        assert device.notes == "in the cupboard"
        assert [s["service_name"] for s in device.services] == ["https"]

    @pytest.mark.asyncio
    async def test_leaves_a_linked_row_that_already_has_the_facts_alone(self, db_session):
        """The mirror of the above: a row a user has since edited is not reverted
        to what the node's abandoned columns still say."""
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        db_session.add(InventoryDevice(
            id="d-1", ip="192.168.0.99", hostname="renamed.lan",
            label="Dockerhost", type="docker_host",
        ))
        await db_session.commit()
        node_id = await self._legacy_node(
            db_session, design, ip="192.168.0.42", hostname="clara.lan", label="Dockerhost"
        )
        node = await db_session.get(Node, node_id)
        node.device_id = "d-1"
        await db_session.commit()

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 0
        device = await db_session.get(InventoryDevice, "d-1")
        assert device is not None
        assert device.ip == "192.168.0.99"
        assert device.hostname == "renamed.lan"

    @pytest.mark.asyncio
    async def test_is_a_no_op_on_a_second_run(self, db_session):
        await self._legacy_nodes_table(db_session)
        design = await _design(db_session)
        await self._legacy_node(db_session, design, ip="10.0.0.5")

        first = await backfill_node_devices(db_session)
        await db_session.commit()
        second = await backfill_node_devices(db_session)
        await db_session.commit()

        assert first["linked"] == 1
        assert second == {"linked": 0, "created": 0, "merged": 0, "skipped": 0}
        rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_each_canvas_keeps_showing_what_it_showed(self, db_session):
        """The upgrade must not redraw a canvas.

        Two canvases drew the same host with different service lists, and the
        scanner's row for it holds a third the user never put on either. They
        converge on one row — so each node keeps a view of the subset it drew,
        and the scanner's guess appears on neither.
        """
        await self._legacy_nodes_table(db_session)
        ssh = {"port": 22, "protocol": "tcp", "service_name": "ssh"}
        https = {"port": 443, "protocol": "tcp", "service_name": "https"}
        kuma = {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"}
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", services=[kuma]))
        await db_session.commit()

        one, two = await _design(db_session, "Net"), await _design(db_session, "Rack")
        a = await self._legacy_node(db_session, one, ip="10.0.0.5", services=[ssh])
        b = await self._legacy_node(db_session, two, ip="10.0.0.5", services=[ssh, https])

        await backfill_node_devices(db_session)
        await db_session.commit()

        device = await db_session.get(InventoryDevice, "d-1")
        assert {s["service_name"] for s in device.services} == {"Uptime Kuma", "ssh", "https"}
        drawn = {}
        for node_id in (a, b):
            node = await db_session.get(Node, node_id)
            payload = hydrated_node(node, device)
            drawn[node_id] = [s["service_name"] for s in payload["services"] if s.get("visible", True)]
        assert drawn[a] == ["ssh"]
        assert drawn[b] == ["ssh", "https"]

    @pytest.mark.asyncio
    async def test_a_node_that_drew_no_service_keeps_drawing_none(self, db_session):
        """An empty legacy list is an answer: that canvas showed no services."""
        await self._legacy_nodes_table(db_session)
        db_session.add(
            InventoryDevice(
                id="d-1", ip="10.0.0.5",
                services=[{"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"}],
            )
        )
        await db_session.commit()
        design = await _design(db_session)
        node_id = await self._legacy_node(db_session, design, ip="10.0.0.5", services=[])

        await backfill_node_devices(db_session)
        await db_session.commit()

        node = await db_session.get(Node, node_id)
        device = await db_session.get(InventoryDevice, "d-1")
        payload = hydrated_node(node, device)
        assert [s.get("visible", True) for s in payload["services"]] == [False]


# --- routes -----------------------------------------------------------------


class TestRoutesKeepTheLinkInStep:
    @pytest.mark.asyncio
    async def test_creating_a_node_joins_the_matching_row(self, client: AsyncClient, headers, db_session):
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", hostname="nas", os="TrueNAS"))
        await db_session.commit()

        res = await client.post(
            "/api/v1/nodes",
            json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "force": True},
            headers=headers,
        )
        assert res.status_code == 201
        body = res.json()
        assert body["device_id"] == "d-1"
        # Hydrated from the row: the node never carried an OS.
        assert body["os"] == "TrueNAS"

    @pytest.mark.asyncio
    async def test_creating_furniture_creates_no_row(self, client: AsyncClient, headers, db_session):
        res = await client.post(
            "/api/v1/nodes", json={"type": "groupRect", "label": "Zone"}, headers=headers
        )
        assert res.status_code == 201
        assert res.json()["device_id"] is None
        rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
        assert rows == []

    @pytest.mark.asyncio
    async def test_editing_a_node_writes_through_to_the_row(self, client: AsyncClient, headers, db_session):
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", hostname="nas"))
        await db_session.commit()
        node_id = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "force": True},
                headers=headers,
            )
        ).json()["id"]

        res = await client.patch(
            f"/api/v1/nodes/{node_id}",
            json={"hostname": "nas2.lan", "notes": "moved to the garage"},
            headers=headers,
        )
        assert res.status_code == 200

        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert device.hostname == "nas2.lan"
        assert device.notes == "moved to the garage"

    @pytest.mark.asyncio
    async def test_patching_one_list_leaves_the_other_alone(self, client: AsyncClient, headers, db_session):
        """Replace applies list by list — an unsent list is not blanked."""
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
                properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            )
        )
        await db_session.commit()
        node_id = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "force": True},
                headers=headers,
            )
        ).json()["id"]

        # properties only: services must survive untouched.
        res = await client.patch(
            f"/api/v1/nodes/{node_id}",
            json={"properties": [{"key": "Owner", "value": "me", "icon": None, "visible": True}]},
            headers=headers,
        )
        assert res.status_code == 200
        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert [p["key"] for p in device.properties] == ["Owner"]
        assert [s["port"] for s in device.services] == [22]

        # services only: the properties just written must survive in turn.
        res = await client.patch(
            f"/api/v1/nodes/{node_id}",
            json={"services": [{"port": 443, "protocol": "tcp", "service_name": "https"}]},
            headers=headers,
        )
        assert res.status_code == 200
        await db_session.refresh(device)
        assert [s["port"] for s in device.services] == [443]
        assert [p["key"] for p in device.properties] == ["Owner"]

    @pytest.mark.asyncio
    async def test_patching_a_list_empty_still_clears_it(self, client: AsyncClient, headers, db_session):
        """An explicit empty list is a deletion, not an omission."""
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            )
        )
        await db_session.commit()
        node_id = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "force": True},
                headers=headers,
            )
        ).json()["id"]

        res = await client.patch(f"/api/v1/nodes/{node_id}", json={"properties": []}, headers=headers)
        assert res.status_code == 200
        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert device.properties == []

    @pytest.mark.asyncio
    async def test_a_canvas_save_does_not_revert_an_inventory_edit(
        self, client: AsyncClient, headers, db_session
    ):
        """Regression: a save carries this canvas' edit, not its stale snapshot.

        The canvas payload holds a full copy of the device, hydrated when it
        loaded. Editing the device elsewhere and then saving the still-open
        canvas — for nothing but a moved node — must not roll the row back.
        """
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                label="NAS",
                type="nas",
                notes="old note",
                status="approved",
                properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            )
        )
        await db_session.commit()
        design_id = (await client.post("/api/v1/designs", json={"name": "A"}, headers=headers)).json()["id"]

        # What the canvas loaded and still holds in memory.
        stale = {
            "id": str(uuid.uuid4()),
            "type": "nas",
            "label": "NAS",
            "status": "unknown",
            "pos_x": 0,
            "pos_y": 0,
            "ip": "10.0.0.5",
            "notes": "old note",
            "properties": [{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
        }
        res = await client.post(
            "/api/v1/canvas/save",
            json={"design_id": design_id, "nodes": [stale], "edges": [], "viewport": {}},
            headers=headers,
        )
        assert res.status_code == 200

        # Meanwhile, in the Device Inventory modal.
        res = await client.patch(
            "/api/v1/scan/pending/d-1",
            json={
                "notes": "moved to the loft",
                "properties": [
                    {"key": "Rack", "value": "A1", "icon": None, "visible": True},
                    {"key": "Owner", "value": "me", "icon": None, "visible": True},
                ],
            },
            headers=headers,
        )
        assert res.status_code == 200

        # The canvas saves again — only the node position changed, so it claims
        # no device edit at all.
        res = await client.post(
            "/api/v1/canvas/save",
            json={
                "design_id": design_id,
                "nodes": [{**stale, "pos_x": 240, "changed_facts": []}],
                "edges": [],
                "viewport": {},
            },
            headers=headers,
        )
        assert res.status_code == 200

        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert device.notes == "moved to the loft"
        assert [p["key"] for p in device.properties] == ["Rack", "Owner"]

    @pytest.mark.asyncio
    async def test_a_canvas_save_still_writes_what_that_canvas_changed(
        self, client: AsyncClient, headers, db_session
    ):
        """The narrowing must not cost the write-through: an edit still lands."""
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", label="NAS", type="nas", notes="old note"))
        await db_session.commit()
        design_id = (await client.post("/api/v1/designs", json={"name": "A"}, headers=headers)).json()["id"]
        node = {
            "id": str(uuid.uuid4()),
            "type": "nas",
            "label": "NAS",
            "status": "unknown",
            "pos_x": 0,
            "pos_y": 0,
            "ip": "10.0.0.5",
            "notes": "old note",
        }
        await client.post(
            "/api/v1/canvas/save",
            json={"design_id": design_id, "nodes": [node], "edges": [], "viewport": {}},
            headers=headers,
        )

        res = await client.post(
            "/api/v1/canvas/save",
            json={
                "design_id": design_id,
                "nodes": [
                    {
                        **node,
                        "notes": "edited on the canvas",
                        "hostname": "nas.lan",
                        "changed_facts": ["notes", "hostname"],
                    }
                ],
                "edges": [],
                "viewport": {},
            },
            headers=headers,
        )
        assert res.status_code == 200

        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert device.notes == "edited on the canvas"
        assert device.hostname == "nas.lan"

    @pytest.mark.asyncio
    async def test_an_edit_writes_without_dragging_the_rest_of_the_snapshot(
        self, client: AsyncClient, headers, db_session
    ):
        """One edited fact lands; the stale fields beside it stay out of the write."""
        db_session.add(
            InventoryDevice(id="d-1", ip="10.0.0.5", label="NAS", type="nas", notes="old note")
        )
        await db_session.commit()
        design_id = (await client.post("/api/v1/designs", json={"name": "A"}, headers=headers)).json()["id"]
        node = {
            "id": str(uuid.uuid4()),
            "type": "nas",
            "label": "NAS",
            "status": "unknown",
            "pos_x": 0,
            "pos_y": 0,
            "ip": "10.0.0.5",
            "notes": "old note",
        }
        await client.post(
            "/api/v1/canvas/save",
            json={"design_id": design_id, "nodes": [node], "edges": [], "viewport": {}},
            headers=headers,
        )
        await client.patch("/api/v1/scan/pending/d-1", json={"notes": "moved to the loft"}, headers=headers)

        # The canvas renames the node; its `notes` copy is stale but unedited.
        await client.post(
            "/api/v1/canvas/save",
            json={
                "design_id": design_id,
                "nodes": [{**node, "label": "Big NAS", "changed_facts": ["label"]}],
                "edges": [],
                "viewport": {},
            },
            headers=headers,
        )

        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert device.label == "Big NAS"
        assert device.notes == "moved to the loft"

    @pytest.mark.asyncio
    async def test_a_client_that_tracks_no_changes_still_writes_its_facts(
        self, client: AsyncClient, headers, db_session
    ):
        """Backward compatible: an import or older client omits the field entirely."""
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", notes="old note"))
        await db_session.commit()
        design_id = (await client.post("/api/v1/designs", json={"name": "A"}, headers=headers)).json()["id"]

        await client.post(
            "/api/v1/canvas/save",
            json={
                "design_id": design_id,
                "nodes": [
                    {
                        "id": str(uuid.uuid4()),
                        "type": "nas",
                        "label": "NAS",
                        "status": "unknown",
                        "pos_x": 0,
                        "pos_y": 0,
                        "ip": "10.0.0.5",
                        "notes": "from the import",
                    }
                ],
                "edges": [],
                "viewport": {},
            },
            headers=headers,
        )

        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert device.notes == "from the import"

    @pytest.mark.asyncio
    async def test_the_second_canvas_sees_the_first_canvas_edit(self, client: AsyncClient, headers, db_session):
        """No per-node overrides: one device, one set of facts, every canvas."""
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5"))
        await db_session.commit()
        design_a = (await client.post("/api/v1/designs", json={"name": "A"}, headers=headers)).json()["id"]
        design_b = (await client.post("/api/v1/designs", json={"name": "B"}, headers=headers)).json()["id"]
        node_a = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "design_id": design_a, "force": True},
                headers=headers,
            )
        ).json()["id"]
        await client.post(
            "/api/v1/nodes",
            json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "design_id": design_b, "force": True},
            headers=headers,
        )

        await client.patch(f"/api/v1/nodes/{node_a}", json={"ip": "10.0.0.9"}, headers=headers)

        canvas_b = (await client.get(f"/api/v1/canvas?design_id={design_b}", headers=headers)).json()
        assert canvas_b["nodes"][0]["ip"] == "10.0.0.9"

    @pytest.mark.asyncio
    async def test_the_wire_shape_the_mcp_server_reads_is_unchanged(
        self, client: AsyncClient, headers, db_session
    ):
        """`mcp/app/tools.py` reads the facts flat on the node — keep it that way.

        The MCP server is a thin proxy over these routes: `_slim_canvas` keeps
        `NODE_KEEP`, `_slim_node_summary` keeps label/type/status, and `get_node`
        looks a node up by label. None of it knows the inventory row exists, so
        the split must not show on the wire.
        """
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                hostname="nas.lan",
                mac="aa:bb:cc:dd:ee:ff",
                os="TrueNAS",
                notes="in the garage",
                cpu_count=8,
                cpu_model="Xeon",
                ram_gb=32.0,
                disk_gb=4000.0,
                services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
                properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
                status_live="online",
            )
        )
        await db_session.commit()
        design_id = (await client.post("/api/v1/designs", json={"name": "Net"}, headers=headers)).json()["id"]
        created = (
            await client.post(
                "/api/v1/nodes",
                json={
                    "type": "nas", "label": "NAS", "ip": "10.0.0.5",
                    "design_id": design_id, "force": True,
                },
                headers=headers,
            )
        ).json()

        # mcp `_slim_canvas` NODE_KEEP, plus what `_slim_node_summary` reads.
        expected = {
            "type": "nas",
            "label": "NAS",
            "ip": "10.0.0.5",
            "hostname": "nas.lan",
            "mac": "aa:bb:cc:dd:ee:ff",
            "os": "TrueNAS",
            "status": "online",
            "notes": "in the garage",
            "cpu_count": 8,
            "cpu_model": "Xeon",
            "ram_gb": 32.0,
            "disk_gb": 4000.0,
        }
        for source in (
            created,
            (await client.get(f"/api/v1/nodes/{created['id']}", headers=headers)).json(),
            (await client.get("/api/v1/nodes", headers=headers)).json()[0],
            (await client.get("/api/v1/canvas", headers=headers)).json()["nodes"][0],
            # mcp `get_node` falls back to a label lookup when given no id.
            (await client.get("/api/v1/nodes?label=NAS", headers=headers)).json()[0],
        ):
            assert {k: source[k] for k in expected} == expected
            assert source["services"] == [{"port": 22, "protocol": "tcp", "service_name": "ssh"}]
            assert source["properties"] == [
                {"key": "Rack", "value": "A1", "icon": None, "visible": True}
            ]
            assert "parent_id" in source

    @pytest.mark.asyncio
    async def test_deleting_a_node_keeps_the_device(self, client: AsyncClient, headers, db_session):
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5"))
        await db_session.commit()
        node_id = (
            await client.post(
                "/api/v1/nodes",
                json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "force": True},
                headers=headers,
            )
        ).json()["id"]

        assert (await client.delete(f"/api/v1/nodes/{node_id}", headers=headers)).status_code == 204
        assert await db_session.get(InventoryDevice, "d-1") is not None

    @pytest.mark.asyncio
    async def test_approving_a_device_links_instead_of_copying(self, client: AsyncClient, headers, db_session):
        db_session.add(
            InventoryDevice(id="d-1", ip="10.0.0.5", hostname="nas", suggested_type="nas", status="pending")
        )
        await db_session.commit()

        res = await client.post(
            "/api/v1/scan/pending/d-1/approve",
            json={"type": "nas", "label": "NAS", "ip": "10.0.0.5", "status": "unknown"},
            headers=headers,
        )
        assert res.status_code == 200
        node = await db_session.get(Node, res.json()["node_id"])
        assert node is not None and node.device_id == "d-1"


class TestPerNodeView:
    """Order and visibility belong to the node, the facts to the row.

    The same device drawn on two canvases is one inventory row, so without a
    per-node view every canvas showing it inherits every service a scan ever
    fingerprinted and every property any other canvas added.
    """

    async def _node_on(self, client, headers, design_id: str, **payload) -> dict:
        body = {"type": "nas", "label": "NAS", "ip": "10.0.0.5", "design_id": design_id, "force": True}
        body.update(payload)
        res = await client.post("/api/v1/nodes", json=body, headers=body.pop("headers", None) or headers)
        assert res.status_code == 201
        return res.json()

    @pytest.mark.asyncio
    async def test_a_new_node_shows_what_the_row_already_holds(
        self, client: AsyncClient, headers, db_session
    ):
        """An empty payload list means "I have nothing to say", not "hide it all"."""
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
                properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            )
        )
        await db_session.commit()
        design = await _design(db_session)

        node = await self._node_on(client, headers, design)
        assert [s["service_name"] for s in node["services"]] == ["ssh"]
        assert all(s.get("visible", True) for s in node["services"])
        assert node["properties"][0]["visible"] is True

    @pytest.mark.asyncio
    async def test_hiding_a_service_on_one_node_leaves_the_other_alone(
        self, client: AsyncClient, headers, db_session
    ):
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                services=[
                    {"port": 22, "protocol": "tcp", "service_name": "ssh"},
                    {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"},
                ],
            )
        )
        await db_session.commit()
        one, two = await _design(db_session, "Net"), await _design(db_session, "Rack")
        node_a = await self._node_on(client, headers, one)
        node_b = await self._node_on(client, headers, two)

        hidden = [
            {"port": 22, "protocol": "tcp", "service_name": "ssh"},
            {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma", "visible": False},
        ]
        res = await client.patch(
            f"/api/v1/nodes/{node_a['id']}", json={"services": hidden}, headers=headers
        )
        assert res.status_code == 200
        assert [(s["service_name"], s.get("visible", True)) for s in res.json()["services"]] == [
            ("ssh", True), ("Uptime Kuma", False),
        ]

        other = (await client.get(f"/api/v1/nodes/{node_b['id']}", headers=headers)).json()
        assert [s.get("visible", True) for s in other["services"]] == [True, True]
        # The service itself is untouched — hiding is not deleting.
        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert len(device.services) == 2

    @pytest.mark.asyncio
    async def test_the_order_is_per_node_too(self, client: AsyncClient, headers, db_session):
        db_session.add(
            InventoryDevice(
                id="d-1",
                ip="10.0.0.5",
                properties=[
                    {"key": "Rack", "value": "A1", "icon": None, "visible": True},
                    {"key": "Owner", "value": "me", "icon": None, "visible": True},
                ],
            )
        )
        await db_session.commit()
        one, two = await _design(db_session, "Net"), await _design(db_session, "Rack")
        node_a = await self._node_on(client, headers, one)
        node_b = await self._node_on(client, headers, two)

        flipped = [
            {"key": "Owner", "value": "me", "icon": None, "visible": True},
            {"key": "Rack", "value": "A1", "icon": None, "visible": True},
        ]
        res = await client.patch(
            f"/api/v1/nodes/{node_a['id']}", json={"properties": flipped}, headers=headers
        )
        assert [p["key"] for p in res.json()["properties"]] == ["Owner", "Rack"]

        other = (await client.get(f"/api/v1/nodes/{node_b['id']}", headers=headers)).json()
        assert [p["key"] for p in other["properties"]] == ["Rack", "Owner"]

    @pytest.mark.asyncio
    async def test_a_service_the_row_gains_later_stays_off_the_canvas(
        self, client: AsyncClient, headers, db_session
    ):
        """The leak this column exists to stop: a scan must not redraw every canvas."""
        db_session.add(
            InventoryDevice(
                id="d-1", ip="10.0.0.5",
                services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
            )
        )
        await db_session.commit()
        design = await _design(db_session)
        node = await self._node_on(client, headers, design)

        device = await db_session.get(InventoryDevice, "d-1")
        device.services = [
            *device.services,
            {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"},
        ]
        await db_session.commit()

        after = (await client.get(f"/api/v1/nodes/{node['id']}", headers=headers)).json()
        assert [(s["service_name"], s.get("visible", True)) for s in after["services"]] == [
            ("ssh", True), ("Uptime Kuma", False),
        ]

    @pytest.mark.asyncio
    async def test_removing_a_service_removes_it_from_the_device(
        self, client: AsyncClient, headers, db_session
    ):
        """Delete is device-wide — hiding is what a single canvas does."""
        db_session.add(
            InventoryDevice(
                id="d-1", ip="10.0.0.5",
                services=[
                    {"port": 22, "protocol": "tcp", "service_name": "ssh"},
                    {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"},
                ],
            )
        )
        await db_session.commit()
        one, two = await _design(db_session, "Net"), await _design(db_session, "Rack")
        node_a = await self._node_on(client, headers, one)
        node_b = await self._node_on(client, headers, two)

        await client.patch(
            f"/api/v1/nodes/{node_a['id']}",
            json={"services": [{"port": 22, "protocol": "tcp", "service_name": "ssh"}]},
            headers=headers,
        )
        other = (await client.get(f"/api/v1/nodes/{node_b['id']}", headers=headers)).json()
        assert [s["service_name"] for s in other["services"]] == ["ssh"]

    @pytest.mark.asyncio
    async def test_a_canvas_save_records_the_view_even_when_no_fact_changed(
        self, client: AsyncClient, headers, db_session
    ):
        """`changed_facts` guards the shared row, not the node's own view.

        A canvas save reporting no edited fact is exactly what hiding a service
        looks like from the row's side — nothing about the device changed. The
        view still has to land, or the toggle would not survive the save.
        """
        db_session.add(
            InventoryDevice(
                id="d-1", ip="10.0.0.5",
                services=[
                    {"port": 22, "protocol": "tcp", "service_name": "ssh"},
                    {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"},
                ],
            )
        )
        await db_session.commit()
        design = await _design(db_session)
        node = await self._node_on(client, headers, design)

        res = await client.post(
            "/api/v1/canvas/save",
            json={
                "design_id": design,
                "nodes": [{
                    "id": node["id"], "type": "nas", "label": "NAS", "ip": "10.0.0.5",
                    "device_id": "d-1", "changed_facts": [], "pos_x": 10.0, "pos_y": 20.0,
                    "services": [
                        {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma", "visible": False},
                        {"port": 22, "protocol": "tcp", "service_name": "ssh"},
                    ],
                }],
                "edges": [],
                "viewport": {"x": 0, "y": 0, "zoom": 1},
            },
            headers=headers,
        )
        assert res.status_code == 200

        loaded = (await client.get(f"/api/v1/canvas?design_id={design}", headers=headers)).json()
        assert [(s["service_name"], s.get("visible", True)) for s in loaded["nodes"][0]["services"]] == [
            ("Uptime Kuma", False), ("ssh", True),
        ]
        device = await db_session.get(InventoryDevice, "d-1")
        await db_session.refresh(device)
        assert [s["service_name"] for s in device.services] == ["ssh", "Uptime Kuma"]

    @pytest.mark.asyncio
    async def test_seeding_freezes_what_a_pre_upgrade_node_showed(self, db_session):
        """`display_view` arrives NULL on every existing node; the seed fills it."""
        design = await _design(db_session)
        db_session.add(
            InventoryDevice(
                id="d-1", ip="10.0.0.5",
                services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
            )
        )
        node = _node(design, device_id="d-1")
        db_session.add(node)
        await db_session.commit()

        assert await seed_node_views(db_session) == 1
        await db_session.commit()
        assert node.display_view == {
            "services": [{"key": "22|tcp|ssh", "visible": True}],
            "properties": [],
        }
        # Idempotent: a second boot finds nothing without a view.
        assert await seed_node_views(db_session) == 0

    @pytest.mark.asyncio
    async def test_seeding_leaves_furniture_alone(self, db_session):
        design = await _design(db_session)
        node = _node(design, type="groupRect")
        db_session.add(node)
        await db_session.commit()

        assert await seed_node_views(db_session) == 0
        assert node.display_view is None

    @pytest.mark.asyncio
    async def test_a_node_without_a_view_still_shows_everything(self, db_session):
        """No view — furniture, or a node an older version linked — is not "hide all"."""
        device = InventoryDevice(
            id="d-1", services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}]
        )
        node = _node(await _design(db_session), device_id="d-1")
        assert hydrated_node(node, device)["services"] == [
            {"port": 22, "protocol": "tcp", "service_name": "ssh"}
        ]
