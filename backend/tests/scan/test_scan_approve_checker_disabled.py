"""With STATUS_CHECKER_ENABLED=false an approval must not store a probe."""
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import settings
from app.db.models import InventoryDevice, Node


@pytest.mark.asyncio
async def test_bulk_approve_leaves_check_method_null(
    client: AsyncClient, headers, two_device_inventory, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "status_checker_enabled", False)
    ids = [d.id for d in two_device_inventory]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    nodes = (await db_session.execute(select(Node))).scalars().all()
    assert nodes
    for node in nodes:
        device = await db_session.get(InventoryDevice, node.device_id)
        assert device is not None
        assert device.check_method is None


@pytest.mark.asyncio
async def test_single_approve_leaves_check_method_null(
    client: AsyncClient, headers, pending_device, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "status_checker_enabled", False)
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "h", "type": "generic", "ip": "192.168.1.10", "status": "unknown", "services": []},
        headers=headers,
    )
    assert res.status_code == 200
    node = (await db_session.execute(select(Node))).scalars().first()
    device = await db_session.get(InventoryDevice, node.device_id)
    assert device.check_method is None
