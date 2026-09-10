"""API + persistence tests for /api/v1/unifi/*."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.unifi import _find_existing, _persist_devices
from app.core.config import settings
from app.db.models import InventoryDevice


@pytest.fixture(autouse=True)
def _clear_unifi_env():
    host = settings.unifi_host
    url = settings.unifi_url
    user = settings.unifi_username
    pw = settings.unifi_password
    settings.unifi_host = ""
    settings.unifi_url = ""
    settings.unifi_username = ""
    settings.unifi_password = ""
    yield
    settings.unifi_host = host
    settings.unifi_url = url
    settings.unifi_username = user
    settings.unifi_password = pw
# --- auth ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_requires_auth_sync_now(client: AsyncClient) -> None:
    res = await client.post("/api/v1/unifi/sync-now")
    assert res.status_code == 401
@pytest.mark.asyncio
async def test_requires_auth_config_get(client: AsyncClient) -> None:
    res = await client.get("/api/v1/unifi/config")
    assert res.status_code == 401
# --- config endpoint -------------------------------------------------------

@pytest.mark.asyncio
async def test_config_omits_credentials(client: AsyncClient, headers: dict) -> None:
    settings.unifi_host = "unifi.local"
    settings.unifi_username = "admin"
    settings.unifi_password = "supersecret"
    res = await client.get("/api/v1/unifi/config", headers=headers)
    assert res.status_code == 200
    body = res.text
    assert "supersecret" not in body
    assert res.json()["credentials_configured"] is True
@pytest.mark.asyncio
async def test_config_credentials_configured_false_when_empty(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/unifi/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["credentials_configured"] is False
# --- sync-now --------------------------------------------------------------

@pytest.mark.asyncio
async def test_sync_now_rejected_without_credentials(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/unifi/sync-now", headers=headers)
    assert res.status_code == 400
@pytest.mark.asyncio
async def test_enable_sync_without_credentials_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/unifi/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400
# --- _find_existing --------------------------------------------------------

@pytest.mark.asyncio
async def test_find_existing_by_ieee(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="unifi-aa:bb:cc:dd:ee:ff",
        mac="aa:bb:cc:dd:ee:ff",
        status="pending",
        discovery_source="unifi",
    )
    db_session.add(row)
    await db_session.commit()

    found = await _find_existing(db_session, "unifi-aa:bb:cc:dd:ee:ff", "aa:bb:cc:dd:ee:ff")
    assert found is not None
    assert found.ieee_address == "unifi-aa:bb:cc:dd:ee:ff"
@pytest.mark.asyncio
async def test_find_existing_mac_not_stolen_from_ieee_device(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="scan-device-xyz",
        mac="11:22:33:44:55:66",
        status="approved",
        discovery_source="scan",
    )
    db_session.add(row)
    await db_session.commit()

    found = await _find_existing(db_session, "unifi-11:22:33:44:55:66", "11:22:33:44:55:66")
    assert found is None
# --- approved status preserved ---------------------------------------------

@pytest.mark.asyncio
async def test_approved_device_stays_approved(db_session: AsyncSession) -> None:
    ieee = "unifi-aa:00:11:22:33:44"
    row = InventoryDevice(
        ieee_address=ieee,
        mac="aa:00:11:22:33:44",
        status="approved",
        discovery_source="unifi",
        discovery_sources=["unifi"],
    )
    db_session.add(row)
    await db_session.commit()

    devices = [{
        "ieee_address": ieee,
        "mac": "aa:00:11:22:33:44",
        "ip": "10.1.1.5",
        "hostname": "ap-living",
        "label": "ap-living",
        "type": "device",
        "vendor": "Ubiquiti",
        "model": "UAP-AC-PRO",
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
        f"Status changed to '{updated.status}'; auto-sync must not un-approve devices"
    )
