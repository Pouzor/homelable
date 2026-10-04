"""Duplicating an inventory row: POST /scan/pending/{id}/duplicate (issue #481).

A redundant pair is two identical boxes — the copy carries the specs and the
front panel, never the identity of the unit it was copied from.
"""
import pytest
from httpx import AsyncClient

from app.db.models import InventoryDevice


async def _seed(db_session, **kwargs) -> InventoryDevice:
    fields = {
        "ip": "192.168.1.20",
        "mac": "aa:bb:cc:44:55:66",
        "hostname": "sw-core-1",
        "ieee_address": None,
        "os": "RouterOS",
        "services": [{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
        "suggested_type": "switch",
        "status": "approved",
        "discovery_source": "arp",
        "discovery_sources": ["arp"],
        "properties": [{"key": "PoE", "value": "370W", "icon": None, "visible": True}],
        "label": "Core switch",
        "type": "switch",
        "model": "CRS326",
        "vendor": "MikroTik",
        "notes": "top of rack",
        "ram_gb": 0.5,
        "show_hardware": True,
        "check_method": "ping",
        "check_target": "192.168.1.20",
        "rack_faceplate_id": "switch-24",
        "rack_u_height": 1,
        "rack_col_span": 12,
        "rack_color": "#00d4ff",
        "rack_ports": [
            {"id": "p1", "label": "eth1", "type": "rj45", "x": 0.1, "y": 0.5},
            {"id": "p2", "label": "sfp1", "type": "sfp", "x": 0.9, "y": 0.5},
        ],
    }
    fields.update(kwargs)
    device = InventoryDevice(**fields)
    db_session.add(device)
    await db_session.commit()
    return device


@pytest.mark.asyncio
async def test_duplicate_requires_auth(client: AsyncClient, db_session):
    device = await _seed(db_session)
    res = await client.post(f"/api/v1/scan/pending/{device.id}/duplicate")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_duplicate_unknown_id(client: AsyncClient, headers):
    res = await client.post("/api/v1/scan/pending/nope/duplicate", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_duplicate_copies_the_device_facts(client: AsyncClient, headers, db_session):
    device = await _seed(db_session)
    res = await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["id"] != device.id
    assert data["label"] == "Core switch (copy)"
    assert data["type"] == "switch"
    assert data["model"] == "CRS326"
    assert data["vendor"] == "MikroTik"
    assert data["os"] == "RouterOS"
    assert data["notes"] == "top of rack"
    assert data["ram_gb"] == 0.5
    assert data["show_hardware"] is True
    assert data["check_method"] == "ping"
    assert data["properties"] == [{"key": "PoE", "value": "370W", "icon": None, "visible": True}]


@pytest.mark.asyncio
async def test_duplicate_carries_the_front_panel_with_fresh_port_ids(
    client: AsyncClient, headers, db_session
):
    """The port layout is the point of the copy, but a cable names a port by id —
    the twin's ports must not answer to the source's ids."""
    device = await _seed(db_session)
    data = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    assert data["rack_faceplate_id"] == "switch-24"
    assert data["rack_u_height"] == 1
    assert data["rack_col_span"] == 12
    assert data["rack_color"] == "#00d4ff"
    ports = data["rack_ports"]
    assert [(p["label"], p["type"], p["x"], p["y"]) for p in ports] == [
        ("eth1", "rj45", 0.1, 0.5),
        ("sfp1", "sfp", 0.9, 0.5),
    ]
    ids = [p["id"] for p in ports]
    assert len(set(ids)) == 2
    assert not {"p1", "p2"} & set(ids)


@pytest.mark.asyncio
async def test_duplicate_leaves_the_identity_behind(client: AsyncClient, headers, db_session):
    """Copied addresses would make dedup fold the twin back into the source."""
    device = await _seed(db_session, ieee_address="0xABCD")
    data = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    assert data["ip"] is None
    assert data["mac"] is None
    assert data["ieee_address"] is None
    assert data["hostname"] is None
    assert data["check_target"] is None
    assert data["services"] == []
    assert data["status"] == "pending"
    assert data["discovery_source"] == "manual"
    assert data["discovery_sources"] == ["manual"]


@pytest.mark.asyncio
async def test_duplicate_leaves_the_source_untouched(client: AsyncClient, headers, db_session):
    device = await _seed(db_session)
    await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)
    await db_session.refresh(device)
    assert device.ip == "192.168.1.20"
    assert device.status == "approved"
    assert [p["id"] for p in device.rack_ports] == ["p1", "p2"]


@pytest.mark.asyncio
async def test_duplicate_twice_gives_two_rows(client: AsyncClient, headers, db_session):
    device = await _seed(db_session, status="pending")
    first = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    second = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    assert first["id"] != second["id"]
    listed = (await client.get("/api/v1/scan/pending", headers=headers)).json()
    assert {device.id, first["id"], second["id"]} <= {d["id"] for d in listed}


@pytest.mark.asyncio
async def test_duplicate_of_rack_gear_stays_rack_gear(client: AsyncClient, headers, db_session):
    """A rack-only row is never approved onto a logical canvas; its twin neither."""
    device = await _seed(
        db_session, ip=None, mac=None, discovery_source="rack", discovery_sources=["rack"]
    )
    data = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    assert data["discovery_source"] == "rack"
    assert data["discovery_sources"] == ["rack"]


@pytest.mark.asyncio
async def test_duplicate_names_an_unlabelled_row_after_its_hostname(
    client: AsyncClient, headers, db_session
):
    device = await _seed(db_session, label=None, friendly_name=None)
    data = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    assert data["label"] == "sw-core-1 (copy)"


@pytest.mark.asyncio
async def test_duplicate_of_an_unmodelled_row_stays_unmodelled(
    client: AsyncClient, headers, db_session
):
    device = await _seed(
        db_session, rack_faceplate_id=None, rack_u_height=None, rack_col_span=None,
        rack_color=None, rack_ports=None,
    )
    data = (await client.post(f"/api/v1/scan/pending/{device.id}/duplicate", headers=headers)).json()
    assert data["rack_faceplate_id"] is None
    assert data["rack_ports"] == []
