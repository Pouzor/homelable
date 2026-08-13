"""API tests for /api/v1/stats/* (gethomepage widget)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import InventoryDevice, Node, ScanRun


@pytest.fixture(autouse=True)
def _reset_homepage_key():
    original = settings.homepage_api_key
    settings.homepage_api_key = ""
    yield
    settings.homepage_api_key = original


@pytest.mark.asyncio
async def test_summary_disabled_when_key_unset(client: AsyncClient) -> None:
    res = await client.get("/api/v1/stats/summary")
    assert res.status_code == 403
    assert "disabled" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_summary_rejects_missing_header(client: AsyncClient) -> None:
    settings.homepage_api_key = "topsecret"
    res = await client.get("/api/v1/stats/summary")
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_summary_rejects_wrong_key(client: AsyncClient) -> None:
    settings.homepage_api_key = "topsecret"
    res = await client.get(
        "/api/v1/stats/summary", headers={"X-API-Key": "wrong"}
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_summary_empty_db(client: AsyncClient) -> None:
    settings.homepage_api_key = "topsecret"
    res = await client.get(
        "/api/v1/stats/summary", headers={"X-API-Key": "topsecret"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "nodes": 0,
        "online": 0,
        "offline": 0,
        "unknown": 0,
        "pending_devices": 0,
        "zigbee_devices": 0,
        "last_scan_at": None,
    }


@pytest.mark.asyncio
async def test_summary_aggregates_counts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    settings.homepage_api_key = "topsecret"
    finished = datetime(2026, 5, 14, 10, 0, tzinfo=timezone.utc)
    # Reachability and the ieee live on the inventory row each node draws.
    drawn = [
        ("A", "server", "online", None),
        ("B", "server", "online", None),
        ("C", "server", "offline", None),
        ("D", "server", "unknown", None),
        ("Z1", "iot", "online", "0x1"),
        ("Z2", "iot", "online", "0x2"),
    ]
    for label, node_type, status_live, ieee in drawn:
        device = InventoryDevice(status="approved", status_live=status_live, ieee_address=ieee)
        db_session.add(device)
        await db_session.flush()
        db_session.add(Node(type=node_type, label=label, device_id=device.id))
    db_session.add_all([
        InventoryDevice(ip="10.0.0.1", status="pending"),
        InventoryDevice(ip="10.0.0.2", status="pending"),
        InventoryDevice(ip="10.0.0.3", status="hidden"),  # excluded
        ScanRun(status="success", finished_at=finished),
        ScanRun(status="success",
                finished_at=datetime(2026, 5, 13, 10, 0, tzinfo=timezone.utc)),
    ])
    await db_session.commit()

    res = await client.get(
        "/api/v1/stats/summary", headers={"X-API-Key": "topsecret"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["nodes"] == 6
    assert body["online"] == 4
    assert body["offline"] == 1
    assert body["unknown"] == 1
    assert body["pending_devices"] == 2
    assert body["zigbee_devices"] == 2
    # SQLite returns naive datetimes; compare prefix only.
    assert body["last_scan_at"] is not None
    assert body["last_scan_at"].startswith("2026-05-14T10:00:00")
