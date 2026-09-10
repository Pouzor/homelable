"""API + persistence tests for /api/v1/xcpng/*."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.xcpng import _find_pending, _persist_pending_import
from app.core.config import settings
from app.db.models import InventoryDevice


@pytest.fixture(autouse=True)
def _clear_xcpng_env():
    """Reset xcpng credentials per-test."""
    host = settings.xcpng_host
    user = settings.xcpng_username
    pw = settings.xcpng_password
    settings.xcpng_host = ""
    settings.xcpng_username = ""
    settings.xcpng_password = ""
    yield
    settings.xcpng_host = host
    settings.xcpng_username = user
    settings.xcpng_password = pw


# --- auth ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_requires_auth_import_pending(client: AsyncClient) -> None:
    res = await client.post("/api/v1/xcpng/import-pending", json={"host": "xo.local"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_requires_auth_sync_now(client: AsyncClient) -> None:
    res = await client.post("/api/v1/xcpng/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_requires_auth_config_get(client: AsyncClient) -> None:
    res = await client.get("/api/v1/xcpng/config")
    assert res.status_code == 401


# --- config endpoint -------------------------------------------------------

@pytest.mark.asyncio
async def test_config_omits_credentials(client: AsyncClient, headers: dict) -> None:
    settings.xcpng_username = "admin"
    settings.xcpng_password = "supersecret"
    settings.xcpng_host = "xo.local"
    res = await client.get("/api/v1/xcpng/config", headers=headers)
    assert res.status_code == 200
    body = res.text
    assert "supersecret" not in body
    assert "admin" not in body
    assert res.json()["credentials_configured"] is True


@pytest.mark.asyncio
async def test_config_credentials_configured_false_when_empty(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/xcpng/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["credentials_configured"] is False


# --- sync-now / import-pending ---------------------------------------------

@pytest.mark.asyncio
async def test_import_pending_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    settings.xcpng_username = "u"
    settings.xcpng_password = "p"
    with patch("app.api.routes.xcpng._background_xcpng_import", new_callable=AsyncMock):
        res = await client.post(
            "/api/v1/xcpng/import-pending",
            json={"host": "xo.local", "username": "u", "password": "p"},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "xcpng"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    settings.xcpng_host = "xo.local"
    settings.xcpng_username = "u"
    settings.xcpng_password = "p"
    with patch("app.api.routes.xcpng._background_xcpng_import", new_callable=AsyncMock):
        res = await client.post("/api/v1/xcpng/sync-now", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "xcpng"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_credentials(client: AsyncClient, headers: dict) -> None:
    # _clear_xcpng_env leaves all empty
    res = await client.post("/api/v1/xcpng/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_enable_sync_without_credentials_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/xcpng/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400


# --- _find_pending ---------------------------------------------------------

@pytest.mark.asyncio
async def test_find_pending_matches_ieee_first(db_session: AsyncSession) -> None:
    """ieee_address match takes priority; IP match on a different device is ignored."""
    target = InventoryDevice(
        ieee_address="xcpng-host-uuid-aaa",
        ip="10.0.0.1",
        status="pending",
        discovery_source="xcpng",
    )
    decoy = InventoryDevice(
        ieee_address="xcpng-host-uuid-bbb",
        ip="10.0.0.1",
        status="pending",
        discovery_source="xcpng",
    )
    db_session.add_all([target, decoy])
    await db_session.commit()

    found = await _find_pending(db_session, "xcpng-host-uuid-aaa", "10.0.0.1", None)
    assert found is not None
    assert found.ieee_address == "xcpng-host-uuid-aaa"


@pytest.mark.asyncio
async def test_find_pending_mac_fallback_skips_ieee_devices(db_session: AsyncSession) -> None:
    """MAC fallback must not match a row that already has ieee_address set."""
    existing = InventoryDevice(
        ieee_address="xcpng-host-uuid-ccc",
        mac="aa:bb:cc:dd:ee:ff",
        status="approved",
        discovery_source="scan",
    )
    db_session.add(existing)
    await db_session.commit()

    # Different ieee, same MAC: must not steal the existing device.
    found = await _find_pending(db_session, "xcpng-host-uuid-ddd", None, "aa:bb:cc:dd:ee:ff")
    assert found is None


@pytest.mark.asyncio
async def test_find_pending_mac_fallback_matches_when_no_ieee(db_session: AsyncSession) -> None:
    """MAC fallback works when the candidate row has no ieee_address yet."""
    existing = InventoryDevice(
        ieee_address=None,
        mac="11:22:33:44:55:66",
        status="pending",
        discovery_source="scan",
    )
    db_session.add(existing)
    await db_session.commit()

    found = await _find_pending(db_session, "xcpng-vm-uuid-eee", None, "11:22:33:44:55:66")
    assert found is not None
    assert found.mac == "11:22:33:44:55:66"


# --- _persist_pending_import approved-status regression --------------------

@pytest.mark.asyncio
async def test_approved_device_status_not_reset_to_pending(db_session: AsyncSession) -> None:
    """Regression: auto-sync must not flip approved devices back to pending."""
    ieee = "xcpng-host-uuid-fff"
    approved = InventoryDevice(
        ieee_address=ieee,
        ip="192.168.1.10",
        status="approved",
        discovery_source="xcpng",
        discovery_sources=["xcpng"],
    )
    db_session.add(approved)
    await db_session.commit()

    nodes_raw = [
        {
            "id": f"xcpng-host-{ieee}",
            "label": "myhost",
            "type": "xcpng",
            "ieee_address": ieee,
            "hostname": "myhost",
            "ip": "192.168.1.10",
            "mac": None,
            "status": "online",
            "cpu_count": 4,
            "ram_gb": 8.0,
            "vendor": "XCP-ng",
            "model": "Hypervisor",
            "vmid": None,
            "parent_ieee": None,
        }
    ]

    await _persist_pending_import(db_session, nodes_raw, [])

    row = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == ieee)
        )
    ).scalars().first()
    assert row is not None
    assert row.status == "approved", (
        f"Status was reset to '{row.status}'; auto-sync must not un-approve devices"
    )
