"""API + persistence tests for /api/v1/pfsense/*."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.pfsense import _find_existing, _persist_devices
from app.core.config import settings
from app.db.models import InventoryDevice


@pytest.fixture(autouse=True)
def _clear_pfsense_env():
    url = settings.pfsense_url
    key = settings.pfsense_api_key
    settings.pfsense_url = ""
    settings.pfsense_api_key = ""
    yield
    settings.pfsense_url = url
    settings.pfsense_api_key = key


# --- auth ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_requires_auth_sync_now(client: AsyncClient) -> None:
    res = await client.post("/api/v1/pfsense/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_requires_auth_config_get(client: AsyncClient) -> None:
    res = await client.get("/api/v1/pfsense/config")
    assert res.status_code == 401


# --- config endpoint -------------------------------------------------------

@pytest.mark.asyncio
async def test_config_omits_credentials(client: AsyncClient, headers: dict) -> None:
    settings.pfsense_url = "https://pfsense.local"
    settings.pfsense_api_key = "supersecretkey"
    res = await client.get("/api/v1/pfsense/config", headers=headers)
    assert res.status_code == 200
    body = res.text
    assert "supersecretkey" not in body
    assert res.json()["credentials_configured"] is True


@pytest.mark.asyncio
async def test_config_credentials_configured_false_when_empty(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/pfsense/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["credentials_configured"] is False


# --- sync-now --------------------------------------------------------------

@pytest.mark.asyncio
async def test_sync_now_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    settings.pfsense_url = "https://pfsense.local"
    settings.pfsense_api_key = "k"
    with patch("app.api.routes.pfsense._background_pfsense_sync", new_callable=AsyncMock):
        res = await client.post("/api/v1/pfsense/sync-now", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "pfsense"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_credentials(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/pfsense/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_enable_sync_without_credentials_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/pfsense/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400


# --- _find_existing --------------------------------------------------------

@pytest.mark.asyncio
async def test_find_existing_by_ieee(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="pfsense-aa:bb:cc:dd:ee:ff",
        mac="aa:bb:cc:dd:ee:ff",
        status="pending",
        discovery_source="pfsense",
    )
    db_session.add(row)
    await db_session.commit()

    found = await _find_existing(db_session, "pfsense-aa:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:ff")
    assert found is not None
    assert found.ieee_address == "pfsense-aa:bb:cc:dd:ee:ff"


@pytest.mark.asyncio
async def test_find_existing_mac_not_stolen_from_ieee_device(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="scan-device-xyz",
        mac="aa:11:22:33:44:55",
        status="approved",
        discovery_source="scan",
    )
    db_session.add(row)
    await db_session.commit()

    found = await _find_existing(db_session, "pfsense-aa:11:22:33:44:55", "aa:11:22:33:44:55")
    assert found is None


# --- approved status regression --------------------------------------------

@pytest.mark.asyncio
async def test_approved_device_not_reset_to_pending(db_session: AsyncSession) -> None:
    ieee = "pfsense-cc:dd:ee:ff:00:11"
    row = InventoryDevice(
        ieee_address=ieee,
        mac="cc:dd:ee:ff:00:11",
        status="approved",
        discovery_source="pfsense",
        discovery_sources=["pfsense"],
    )
    db_session.add(row)
    await db_session.commit()

    devices = [{
        "ieee_address": ieee,
        "mac": "cc:dd:ee:ff:00:11",
        "ip": "192.168.1.20",
        "hostname": "fw-host",
        "label": "fw-host",
        "type": "device",
        "vendor": None,
        "model": None,
        "properties": [],
    }]
    await _persist_devices(db_session, devices)

    updated = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == ieee)
        )
    ).scalars().first()
    assert updated is not None
    assert updated.status == "approved", (
        f"Status reset to '{updated.status}'; auto-sync must not un-approve devices"
    )
