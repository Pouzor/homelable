"""The node ↔ Device Inventory link: matching, merging, and the 3.3.0 backfill.

The inventory row owns the device facts; a node owns how the device is drawn.
These tests pin the rules that make one device end up as one row even when it
was drawn on several canvases.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models import Design, InventoryDevice, Node
from app.services.inventory_sync import (
    backfill_node_devices,
    find_device_for,
    merge_properties,
    merge_services,
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
        "status": "unknown",
        "services": [],
        "properties": [],
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


# --- the backfill -----------------------------------------------------------


class TestBackfill:
    @pytest.mark.asyncio
    async def test_links_a_node_to_its_existing_row(self, db_session):
        design = await _design(db_session)
        db_session.add(InventoryDevice(id="d-1", ip="10.0.0.5", hostname="nas"))
        node = _node(design, ip="10.0.0.5", label="NAS")
        db_session.add(node)
        await db_session.commit()

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats == {"linked": 1, "created": 0, "merged": 1}
        assert node.device_id == "d-1"

    @pytest.mark.asyncio
    async def test_creates_a_row_for_a_node_no_scan_ever_saw(self, db_session):
        design = await _design(db_session)
        node = _node(design, label="Dumb switch", type="switch", notes="under the desk")
        db_session.add(node)
        await db_session.commit()

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats == {"linked": 1, "created": 1, "merged": 0}
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
        design_a = await _design(db_session, "A")
        design_b = await _design(db_session, "B")
        older = _node(
            design_a,
            ip="10.0.0.5",
            label="nas-old",
            hostname="nas.lan",
            notes="older note",
            properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
            services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
            updated_at=_now(0),
        )
        newer = _node(
            design_b,
            ip="10.0.0.5",
            label="nas-new",
            os="TrueNAS",
            properties=[{"key": "Owner", "value": "me", "icon": None, "visible": True}],
            services=[{"port": 80, "protocol": "tcp", "service_name": "http"}],
            updated_at=_now(30),
        )
        db_session.add_all([older, newer])
        await db_session.commit()

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 2
        assert older.device_id == newer.device_id
        device = await db_session.get(InventoryDevice, older.device_id)
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
        design = await _design(db_session)
        for kind in ("group", "groupRect", "text"):
            db_session.add(_node(design, type=kind, label=kind))
        await db_session.commit()

        stats = await backfill_node_devices(db_session)
        await db_session.commit()

        assert stats["linked"] == 0
        assert (await db_session.execute(select(InventoryDevice))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_is_a_no_op_on_a_second_run(self, db_session):
        design = await _design(db_session)
        db_session.add(_node(design, ip="10.0.0.5"))
        await db_session.commit()

        first = await backfill_node_devices(db_session)
        await db_session.commit()
        second = await backfill_node_devices(db_session)
        await db_session.commit()

        assert first["linked"] == 1
        assert second == {"linked": 0, "created": 0, "merged": 0}
        rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
        assert len(rows) == 1


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
