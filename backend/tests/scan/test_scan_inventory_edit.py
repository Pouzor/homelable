"""Editing an inventory row: PATCH /scan/pending/{id} and the widened create.

The inventory row owns the device facts, so it has to be editable on its own —
not only through a canvas node.
"""
import pytest
from httpx import AsyncClient

from app.db.models import InventoryDevice


async def _seed(db_session, **kwargs) -> InventoryDevice:
    device = InventoryDevice(
        ip="192.168.1.10",
        mac="aa:bb:cc:11:22:33",
        hostname="nas",
        services=[{"port": 22, "protocol": "tcp", "service_name": "ssh"}],
        suggested_type="nas",
        status="pending",
        discovery_source="arp",
        discovery_sources=["arp"],
        properties=[{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
        **kwargs,
    )
    db_session.add(device)
    await db_session.commit()
    return device


@pytest.mark.asyncio
async def test_update_pending_requires_auth(client: AsyncClient, db_session):
    device = await _seed(db_session)
    res = await client.patch(f"/api/v1/scan/pending/{device.id}", json={"hostname": "x"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_update_pending_edits_curated_fields(client: AsyncClient, headers, db_session):
    device = await _seed(db_session)
    res = await client.patch(
        f"/api/v1/scan/pending/{device.id}",
        headers=headers,
        json={
            "label": "Big NAS",
            "type": "nas",
            "notes": "in the garage rack",
            "cpu_count": 4,
            "cpu_model": "N5105",
            "ram_gb": 16.0,
            "disk_gb": 4000.0,
            "show_hardware": True,
            "check_method": "http",
            "check_target": "http://192.168.1.10:5000",
            "properties": [
                {"key": "Rack", "value": "B2", "icon": None, "visible": True},
                {"key": "Owner", "value": "me", "icon": None, "visible": False},
            ],
            "services": [
                {"port": 22, "protocol": "tcp", "service_name": "ssh"},
                {"port": 5000, "protocol": "tcp", "service_name": "http"},
            ],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["label"] == "Big NAS"
    assert data["notes"] == "in the garage rack"
    assert data["cpu_count"] == 4
    assert data["ram_gb"] == 16.0
    assert data["show_hardware"] is True
    assert data["check_method"] == "http"
    assert len(data["properties"]) == 2
    assert len(data["services"]) == 2


@pytest.mark.asyncio
async def test_update_pending_is_partial(client: AsyncClient, headers, db_session):
    """Sending one field must not clear the others."""
    device = await _seed(db_session)
    res = await client.patch(
        f"/api/v1/scan/pending/{device.id}", headers=headers, json={"notes": "only this"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["notes"] == "only this"
    assert data["hostname"] == "nas"
    assert data["ip"] == "192.168.1.10"
    assert data["mac"] == "aa:bb:cc:11:22:33"
    assert data["suggested_type"] == "nas"
    assert len(data["services"]) == 1
    assert data["properties"][0]["key"] == "Rack"


@pytest.mark.asyncio
async def test_update_pending_normalizes_mac(client: AsyncClient, headers, db_session):
    device = await _seed(db_session)
    res = await client.patch(
        f"/api/v1/scan/pending/{device.id}", headers=headers, json={"mac": "AA-BB-CC-99-88-77"}
    )
    assert res.status_code == 200
    assert res.json()["mac"] == "aa:bb:cc:99:88:77"


@pytest.mark.asyncio
async def test_update_pending_leaves_lifecycle_alone(client: AsyncClient, headers, db_session):
    """`status` is owned by approve/hide, not by the edit modal."""
    device = await _seed(db_session)
    res = await client.patch(
        f"/api/v1/scan/pending/{device.id}",
        headers=headers,
        json={"label": "x", "status": "approved", "discovery_source": "manual"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["label"] == "x"
    assert data["status"] == "pending"
    assert data["discovery_source"] == "arp"


@pytest.mark.asyncio
async def test_update_pending_unknown_id(client: AsyncClient, headers):
    res = await client.patch("/api/v1/scan/pending/nope", headers=headers, json={"notes": "x"})
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_create_pending_accepts_curated_fields(client: AsyncClient, headers):
    """A hand-made entry carries everything the modal shows, no PATCH round trip."""
    res = await client.post(
        "/api/v1/scan/pending",
        headers=headers,
        json={
            "hostname": "patch-panel",
            "os": "n/a",
            "label": "Patch panel 24p",
            "type": "switch",
            "notes": "passive",
            "services": [{"port": 80, "protocol": "tcp", "service_name": "http"}],
            "friendly_name": "PP-1",
            "device_subtype": "passive",
            "check_method": "none",
            "discovery_source": "manual",
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["label"] == "Patch panel 24p"
    assert data["type"] == "switch"
    assert data["os"] == "n/a"
    assert data["notes"] == "passive"
    assert data["friendly_name"] == "PP-1"
    assert data["services"][0]["port"] == 80
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_legacy_row_defaults_are_coerced(client: AsyncClient, headers, db_session):
    """Rows predating the 3.3.0 columns read back with defaults, not nulls."""
    device = await _seed(db_session)
    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.status_code == 200
    row = next(d for d in res.json() if d["id"] == device.id)
    assert row["status_live"] == "unknown"
    assert row["show_hardware"] is False
    assert row["label"] is None
