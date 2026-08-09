"""MAC-property builders and Zigbee/Z-Wave property population on approve."""
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models import InventoryDevice, Node
from tests.scan.helpers import _add_design, _seed_zigbee_pending_pair


@pytest.mark.asyncio
async def test_approve_zigbee_device_populates_properties(
    client: AsyncClient, headers, zigbee_pending_device, db_session
):
    """Approving a zigbee device must populate IEEE/Vendor/Model/LQI in properties."""
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    payload = {
        "label": "bulb_1",
        "type": "zigbee_enddevice",
        "status": "online",
        "services": [],
        "check_method": "none",
    }
    res = await client.post(
        f"/api/v1/scan/pending/{zigbee_pending_device.id}/approve",
        json=payload,
        headers=headers,
    )
    assert res.status_code == 200
    node = (
        await db_session.execute(select(NodeModel).where(NodeModel.ieee_address == "0xABCDEF"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in node.properties}
    assert keys == {
        "IEEE": "0xABCDEF",
        "Vendor": "IKEA",
        "Model": "TRADFRI",
        "LQI": "180",
    }


@pytest.mark.asyncio
async def test_bulk_approve_zigbee_populates_properties(
    client: AsyncClient, headers, zigbee_pending_device, db_session
):
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    res = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": [zigbee_pending_device.id]},
        headers=headers,
    )
    assert res.status_code == 200
    node = (
        await db_session.execute(select(NodeModel).where(NodeModel.ieee_address == "0xABCDEF"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in node.properties}
    assert keys["IEEE"] == "0xABCDEF"
    assert keys["Vendor"] == "IKEA"
    assert keys["Model"] == "TRADFRI"
    assert keys["LQI"] == "180"
    assert node.check_method == "none"


def test_build_mac_property_returns_hidden_row():
    from app.api.routes.scan import build_mac_property

    assert build_mac_property("aa:bb:cc:dd:ee:ff") == [
        {"key": "MAC", "value": "aa:bb:cc:dd:ee:ff", "icon": None, "visible": False}
    ]


def test_build_mac_property_empty_when_no_mac():
    from app.api.routes.scan import build_mac_property

    assert build_mac_property(None) == []
    assert build_mac_property("") == []


def test_merge_mac_property_appends_when_absent():
    from app.api.routes.scan import merge_mac_property

    existing = [{"key": "Custom", "value": "x", "icon": None, "visible": True}]
    merged = merge_mac_property(existing, "aa:bb:cc:dd:ee:ff")
    assert {"key": "MAC", "value": "aa:bb:cc:dd:ee:ff", "icon": None, "visible": False} in merged
    # Existing prop preserved untouched.
    assert existing[0] in merged


def test_merge_mac_property_idempotent_and_preserves_visibility():
    from app.api.routes.scan import merge_mac_property

    existing = [{"key": "MAC", "value": "aa:bb:cc:dd:ee:ff", "icon": None, "visible": True}]
    merged = merge_mac_property(existing, "aa:bb:cc:dd:ee:ff")
    # No duplicate MAC row; user's visible=True choice kept.
    macs = [p for p in merged if p["key"] == "MAC"]
    assert len(macs) == 1
    assert macs[0]["visible"] is True


def test_merge_mac_property_noop_without_mac():
    from app.api.routes.scan import merge_mac_property

    existing = [{"key": "Custom", "value": "x", "icon": None, "visible": True}]
    assert merge_mac_property(existing, None) == existing


@pytest.mark.asyncio
async def test_approve_device_does_not_duplicate_mac_property(
    client: AsyncClient, headers, pending_device, db_session
):
    """If the approve payload already carries a MAC prop, don't add a second one."""
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={
            "label": "My Server",
            "type": "server",
            "ip": "192.168.1.100",
            "status": "unknown",
            "services": [],
            "properties": [
                {"key": "MAC", "value": "aa:bb:cc:dd:ee:ff", "icon": None, "visible": True}
            ],
        },
        headers=headers,
    )
    assert res.status_code == 200
    node = (
        await db_session.execute(select(NodeModel).where(NodeModel.ip == "192.168.1.100"))
    ).scalar_one()
    mac_props = [p for p in node.properties if p["key"] == "MAC"]
    assert len(mac_props) == 1
    # User's visibility choice is preserved.
    assert mac_props[0]["visible"] is True


@pytest.mark.asyncio
async def test_approve_zigbee_creates_edge_when_other_endpoint_is_node(
    client: AsyncClient, headers, db_session
):
    from sqlalchemy import select

    from app.db.models import Edge

    coord, pending = await _seed_zigbee_pending_pair(db_session)

    res = await client.post(
        f"/api/v1/scan/pending/{pending.id}/approve",
        json={
            "label": "router_1",
            "type": "zigbee_router",
            "ip": None,
            "status": "unknown",
            "services": [],
        },
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] is True
    assert data["edges_created"] == 1

    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 1
    assert edges[0].source == coord.id
    assert edges[0].target == data["node_id"]
    assert edges[0].source_handle == "bottom"
    # Bare side name (canonical stored form); renders at the top like before.
    assert edges[0].target_handle == "top"
    assert edges[0].type == "iot"


@pytest.mark.asyncio
async def test_approve_zigbee_skips_duplicate_edge(
    client: AsyncClient, headers, db_session
):
    """Re-running the resolution does not create a second edge for the same pair."""
    from sqlalchemy import select

    from app.db.models import Edge, InventoryDevice, InventoryDeviceLink

    coord, pending = await _seed_zigbee_pending_pair(db_session)
    body = {"label": "router_1", "type": "zigbee_router", "ip": None, "status": "unknown", "services": []}
    await client.post(f"/api/v1/scan/pending/{pending.id}/approve", json=body, headers=headers)

    # Simulate a second pending row + link between same coord and a new device,
    # but keep an existing edge in place to verify dedupe also handles
    # the swapped-direction case.
    new_pending = InventoryDevice(
        ieee_address="0xR1B",
        friendly_name="r1b",
        suggested_type="zigbee_router",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add(new_pending)
    db_session.add(
        InventoryDeviceLink(source_ieee="0xCOORD", target_ieee="0xR1B", discovery_source="zigbee")
    )
    await db_session.commit()
    res = await client.post(
        f"/api/v1/scan/pending/{new_pending.id}/approve", json=body, headers=headers
    )
    assert res.json()["edges_created"] == 1  # only the new pair
    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 2  # original + new, no duplicate


@pytest.mark.asyncio
async def test_approve_zigbee_skips_when_other_endpoint_still_pending(
    client: AsyncClient, headers, db_session
):
    """Both endpoints pending → no edge yet, link row preserved for later."""
    from sqlalchemy import select

    from app.db.models import Edge, InventoryDevice, InventoryDeviceLink

    a = InventoryDevice(
        ieee_address="0xA",
        friendly_name="a",
        suggested_type="zigbee_router",
        status="pending",
        discovery_source="zigbee",
    )
    b = InventoryDevice(
        ieee_address="0xB",
        friendly_name="b",
        suggested_type="zigbee_enddevice",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add_all([a, b])
    db_session.add(
        InventoryDeviceLink(source_ieee="0xA", target_ieee="0xB", discovery_source="zigbee")
    )
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{a.id}/approve",
        json={
            "label": "a",
            "type": "zigbee_router",
            "ip": None,
            "status": "unknown",
            "services": [],
        },
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["edges_created"] == 0

    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert edges == []
    links = (await db_session.execute(select(InventoryDeviceLink))).scalars().all()
    assert len(links) == 1  # preserved for later resolution


@pytest.mark.asyncio
async def test_approve_zigbee_resolves_link_after_second_approval(
    client: AsyncClient, headers, db_session
):
    """First approval keeps link (other endpoint pending); second approval
    creates the edge. The link row is retained afterwards so the same pair can
    be re-approved onto another canvas — it's topology, wiped only on reimport."""
    from sqlalchemy import select

    from app.db.models import Edge, InventoryDevice, InventoryDeviceLink

    a = InventoryDevice(
        ieee_address="0xA",
        friendly_name="a",
        suggested_type="zigbee_router",
        status="pending",
        discovery_source="zigbee",
    )
    b = InventoryDevice(
        ieee_address="0xB",
        friendly_name="b",
        suggested_type="zigbee_enddevice",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add_all([a, b])
    db_session.add(
        InventoryDeviceLink(source_ieee="0xA", target_ieee="0xB", discovery_source="zigbee")
    )
    await db_session.commit()

    body = {"label": "x", "type": "zigbee_router", "ip": None, "status": "unknown", "services": []}
    await client.post(f"/api/v1/scan/pending/{a.id}/approve", json=body, headers=headers)
    res = await client.post(f"/api/v1/scan/pending/{b.id}/approve", json=body, headers=headers)
    assert res.json()["edges_created"] == 1

    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 1
    links = (await db_session.execute(select(InventoryDeviceLink))).scalars().all()
    assert len(links) == 1  # retained for re-approval onto other canvases


@pytest.mark.asyncio
async def test_single_approve_zwave_sets_wireless_fields(client, headers, db_session):
    active = await _add_design(db_session, "zwave")
    dev = InventoryDevice(
        id=str(uuid.uuid4()),
        ieee_address="zwave-H-9",
        friendly_name="Door Sensor",
        suggested_type="zwave_enddevice",
        vendor="Aeotec",
        model="ZW120",
        status="pending",
        discovery_source="zwave",
    )
    db_session.add(dev)
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{dev.id}/approve",
        json={"label": "Door Sensor", "type": "zwave_enddevice", "design_id": active},
        headers=headers,
    )
    assert res.status_code == 200

    node = (
        await db_session.execute(select(Node).where(Node.ieee_address == "zwave-H-9"))
    ).scalar_one()
    assert node.design_id == active
    assert node.status == "online"
    assert node.check_method == "none"
    assert any(p["key"] == "Z-Wave ID" for p in node.properties)
