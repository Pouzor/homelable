"""API + persistence tests for /api/v1/opnsense/*."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.opnsense import _find_existing, _persist_devices
from app.core.config import settings
from app.db.models import InventoryDevice


@pytest.fixture(autouse=True)
def _clear_opnsense_env():
    url = settings.opnsense_url
    key = settings.opnsense_api_key
    secret = settings.opnsense_api_secret
    settings.opnsense_url = ""
    settings.opnsense_api_key = ""
    settings.opnsense_api_secret = ""
    yield
    settings.opnsense_url = url
    settings.opnsense_api_key = key
    settings.opnsense_api_secret = secret


# --- auth ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_requires_auth_sync_now(client: AsyncClient) -> None:
    res = await client.post("/api/v1/opnsense/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_requires_auth_config_get(client: AsyncClient) -> None:
    res = await client.get("/api/v1/opnsense/config")
    assert res.status_code == 401


# --- config endpoint -------------------------------------------------------

@pytest.mark.asyncio
async def test_config_omits_credentials(client: AsyncClient, headers: dict) -> None:
    settings.opnsense_url = "https://opnsense.local"
    settings.opnsense_api_key = "mykey"
    settings.opnsense_api_secret = "supersecret"
    res = await client.get("/api/v1/opnsense/config", headers=headers)
    assert res.status_code == 200
    body = res.text
    assert "supersecret" not in body
    assert "mykey" not in body
    assert res.json()["credentials_configured"] is True


@pytest.mark.asyncio
async def test_config_credentials_configured_false_when_empty(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/opnsense/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["credentials_configured"] is False


# --- sync-now --------------------------------------------------------------

@pytest.mark.asyncio
async def test_sync_now_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    settings.opnsense_url = "https://opnsense.local"
    settings.opnsense_api_key = "k"
    settings.opnsense_api_secret = "s"
    with patch("app.api.routes.opnsense._background_opnsense_sync", new_callable=AsyncMock):
        res = await client.post("/api/v1/opnsense/sync-now", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "opnsense"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_credentials(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/opnsense/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_enable_sync_without_credentials_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/opnsense/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400


# --- _find_existing --------------------------------------------------------

@pytest.mark.asyncio
async def test_find_existing_by_ieee(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="opnsense-aa:bb:cc:dd:ee:ff",
        mac="aa:bb:cc:dd:ee:ff",
        status="pending",
        discovery_source="opnsense",
    )
    db_session.add(row)
    await db_session.commit()

    found = await _find_existing(db_session, "opnsense-aa:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:ff")
    assert found is not None
    assert found.ieee_address == "opnsense-aa:bb:cc:dd:ee:ff"


@pytest.mark.asyncio
async def test_find_existing_mac_not_stolen_from_ieee_device(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="scan-device-original",
        mac="11:22:33:44:55:66",
        status="approved",
        discovery_source="scan",
    )
    db_session.add(row)
    await db_session.commit()

    found = await _find_existing(db_session, "opnsense-11:22:33:44:55:66", "11:22:33:44:55:66")
    assert found is None


# --- approved status regression --------------------------------------------

@pytest.mark.asyncio
async def test_approved_device_not_reset_to_pending(db_session: AsyncSession) -> None:
    ieee = "opnsense-aa:bb:cc:00:11:22"
    row = InventoryDevice(
        ieee_address=ieee,
        mac="aa:bb:cc:00:11:22",
        status="approved",
        discovery_source="opnsense",
        discovery_sources=["opnsense"],
    )
    db_session.add(row)
    await db_session.commit()

    devices = [{
        "ieee_address": ieee,
        "mac": "aa:bb:cc:00:11:22",
        "ip": "10.0.0.5",
        "hostname": "myhost",
        "label": "myhost",
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
