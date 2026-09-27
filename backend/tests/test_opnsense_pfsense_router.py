"""API + persistence tests for /api/v1/opnsense/* and /api/v1/pfsense/*."""

from __future__ import annotations

from contextlib import suppress
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.opnsense import _find_existing as opn_find_existing
from app.api.routes.opnsense import _persist_devices as opn_persist_devices
from app.api.routes.pfsense import _find_existing as pfs_find_existing
from app.api.routes.pfsense import _persist_devices as pfs_persist_devices
from app.core.config import settings
from app.db.models import InventoryDevice

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_opnsense_settings():
    orig = {
        "opnsense_url": settings.opnsense_url,
        "opnsense_api_key": settings.opnsense_api_key,
        "opnsense_api_secret": getattr(settings, "opnsense_api_secret", ""),
        "opnsense_verify_tls": settings.opnsense_verify_tls,
        "opnsense_sync_enabled": settings.opnsense_sync_enabled,
        "opnsense_sync_interval": settings.opnsense_sync_interval,
        "pfsense_url": settings.pfsense_url,
        "pfsense_api_key": settings.pfsense_api_key,
        "pfsense_verify_tls": settings.pfsense_verify_tls,
        "pfsense_sync_enabled": settings.pfsense_sync_enabled,
        "pfsense_sync_interval": settings.pfsense_sync_interval,
    }
    yield
    for k, v in orig.items():
        with suppress(Exception):
            setattr(settings, k, v)


def _set_opnsense_creds(url: str = "https://opnsense.local") -> None:
    settings.opnsense_url = url
    settings.opnsense_api_key = "key"
    settings.opnsense_api_secret = "secret"


def _set_pfsense_creds(url: str = "https://pfsense.local") -> None:
    settings.pfsense_url = url
    settings.pfsense_api_key = "key"


# ===========================================================================
# OPNsense
# ===========================================================================

# ---------------------------------------------------------------------------
# Auth guards
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_test_connection_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/opnsense/test-connection")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_opnsense_sync_now_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/opnsense/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_opnsense_config_get_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/api/v1/opnsense/config")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_opnsense_config_post_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/opnsense/config", json={})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# test-connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_test_connection_400_no_creds(
    client: AsyncClient, headers: dict
) -> None:
    settings.opnsense_url = ""
    settings.opnsense_api_key = ""
    res = await client.post("/api/v1/opnsense/test-connection", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_opnsense_test_connection_success(
    client: AsyncClient, headers: dict
) -> None:
    _set_opnsense_creds()
    with patch(
        "app.api.routes.opnsense.test_opnsense_connection",
        new=AsyncMock(return_value=(True, "Connected")),
    ):
        res = await client.post("/api/v1/opnsense/test-connection", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["connected"] is True
    assert body["message"] == "Connected"


@pytest.mark.asyncio
async def test_opnsense_test_connection_failure(
    client: AsyncClient, headers: dict
) -> None:
    _set_opnsense_creds()
    with patch(
        "app.api.routes.opnsense.test_opnsense_connection",
        new=AsyncMock(return_value=(False, "Connection refused")),
    ):
        res = await client.post("/api/v1/opnsense/test-connection", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["connected"] is False


# ---------------------------------------------------------------------------
# sync-now
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_sync_now_400_no_creds(
    client: AsyncClient, headers: dict
) -> None:
    settings.opnsense_url = ""
    settings.opnsense_api_key = ""
    res = await client.post("/api/v1/opnsense/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_opnsense_sync_now_creates_scan_run(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    _set_opnsense_creds()
    with patch("app.api.routes.opnsense._background_opnsense_sync", new=AsyncMock()):
        res = await client.post("/api/v1/opnsense/sync-now", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "running"
    assert body["kind"] == "opnsense"


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_config_get_no_creds(
    client: AsyncClient, headers: dict
) -> None:
    settings.opnsense_url = ""
    settings.opnsense_api_key = ""
    res = await client.get("/api/v1/opnsense/config", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["credentials_configured"] is False


@pytest.mark.asyncio
async def test_opnsense_config_get_with_creds(
    client: AsyncClient, headers: dict
) -> None:
    _set_opnsense_creds("https://opnsense.local")
    res = await client.get("/api/v1/opnsense/config", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["credentials_configured"] is True
    assert body["url"] == "https://opnsense.local"


@pytest.mark.asyncio
async def test_opnsense_config_omits_api_secret(
    client: AsyncClient, headers: dict
) -> None:
    _set_opnsense_creds()
    settings.opnsense_api_secret = "supersecret"
    res = await client.get("/api/v1/opnsense/config", headers=headers)
    assert res.status_code == 200
    assert "supersecret" not in res.text


# ---------------------------------------------------------------------------
# POST /config
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_config_post_enable_without_creds_rejected(
    client: AsyncClient, headers: dict
) -> None:
    settings.opnsense_url = ""
    settings.opnsense_api_key = ""
    res = await client.post(
        "/api/v1/opnsense/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_opnsense_config_post_disable_without_creds_ok(
    client: AsyncClient, headers: dict
) -> None:
    settings.opnsense_url = ""
    settings.opnsense_api_key = ""
    with (
        patch("app.api.routes.opnsense.set_opnsense_sync_enabled"),
        patch("app.api.routes.opnsense.reschedule_opnsense_sync"),
        patch.object(type(settings), "save_overrides", lambda self: None, create=True),
    ):
        res = await client.post(
            "/api/v1/opnsense/config",
            json={"sync_enabled": False, "sync_interval": 3600},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["sync_enabled"] is False


@pytest.mark.asyncio
async def test_opnsense_config_post_updates_interval(
    client: AsyncClient, headers: dict
) -> None:
    _set_opnsense_creds()
    with (
        patch("app.api.routes.opnsense.set_opnsense_sync_enabled"),
        patch("app.api.routes.opnsense.reschedule_opnsense_sync"),
        patch.object(type(settings), "save_overrides", lambda self: None, create=True),
    ):
        res = await client.post(
            "/api/v1/opnsense/config",
            json={"sync_enabled": True, "sync_interval": 1800},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["sync_interval"] == 1800


# ---------------------------------------------------------------------------
# _find_existing (OPNsense)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_find_existing_by_ieee(db_session: AsyncSession) -> None:
    dev = InventoryDevice(ieee_address="opnsense-aa:bb:cc:dd:ee:ff", status="pending",
                          discovery_source="opnsense", discovery_sources=["opnsense"])
    db_session.add(dev)
    await db_session.flush()

    result = await opn_find_existing(db_session, "opnsense-aa:bb:cc:dd:ee:ff", None)
    assert result is not None
    assert result.ieee_address == "opnsense-aa:bb:cc:dd:ee:ff"


@pytest.mark.asyncio
async def test_opnsense_find_existing_by_mac_fallback(db_session: AsyncSession) -> None:
    dev = InventoryDevice(mac="aa:bb:cc:dd:ee:ff", status="pending",
                          discovery_source="ip_scan", discovery_sources=["ip_scan"])
    db_session.add(dev)
    await db_session.flush()

    result = await opn_find_existing(db_session, "opnsense-unknown", "aa:bb:cc:dd:ee:ff")
    assert result is not None
    assert result.mac == "aa:bb:cc:dd:ee:ff"


@pytest.mark.asyncio
async def test_opnsense_find_existing_returns_none_when_missing(
    db_session: AsyncSession,
) -> None:
    result = await opn_find_existing(db_session, "opnsense-ghost", None)
    assert result is None


# ---------------------------------------------------------------------------
# _persist_devices (OPNsense)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_opnsense_persist_creates_new_device(db_session: AsyncSession) -> None:
    devices = [
        {
            "ieee_address": "opnsense-192.168.1.1",
            "ip": "192.168.1.1",
            "mac": "aa:00:00:00:00:01",
            "hostname": "router",
            "label": "OPNsense Router",
            "type": "firewall",
            "vendor": "Deciso",
            "model": "DEC750",
            "properties": [],
        }
    ]
    result = await opn_persist_devices(db_session, devices)
    assert result.device_count == 1
    assert result.pending_created == 1
    assert result.pending_updated == 0

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 1
    assert rows[0].ieee_address == "opnsense-192.168.1.1"
    assert rows[0].status == "pending"
    assert rows[0].discovery_source == "opnsense"


@pytest.mark.asyncio
async def test_opnsense_persist_skips_device_without_ieee(
    db_session: AsyncSession,
) -> None:
    devices = [{"ip": "10.0.0.1", "mac": "bb:00:00:00:00:01"}]  # no ieee_address
    result = await opn_persist_devices(db_session, devices)
    assert result.device_count == 1
    assert result.pending_created == 0

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 0


@pytest.mark.asyncio
async def test_opnsense_persist_updates_existing_device(db_session: AsyncSession) -> None:
    existing = InventoryDevice(
        ieee_address="opnsense-10.0.0.1",
        ip="10.0.0.1",
        status="approved",
        discovery_source="opnsense",
        discovery_sources=["opnsense"],
    )
    db_session.add(existing)
    await db_session.flush()

    devices = [
        {
            "ieee_address": "opnsense-10.0.0.1",
            "ip": "10.0.0.1",
            "hostname": "updated-host",
            "mac": None,
        }
    ]
    result = await opn_persist_devices(db_session, devices)
    assert result.pending_updated == 1
    assert result.pending_created == 0

    await db_session.refresh(existing)
    assert existing.hostname == "updated-host"
    assert existing.status == "approved"  # approved status preserved


@pytest.mark.asyncio
async def test_opnsense_persist_does_not_overwrite_approved_status(
    db_session: AsyncSession,
) -> None:
    existing = InventoryDevice(
        ieee_address="opnsense-approved",
        status="approved",
        discovery_source="opnsense",
        discovery_sources=["opnsense"],
    )
    db_session.add(existing)
    await db_session.flush()

    devices = [{"ieee_address": "opnsense-approved", "ip": "1.2.3.4"}]
    await opn_persist_devices(db_session, devices)

    await db_session.refresh(existing)
    assert existing.status == "approved"


@pytest.mark.asyncio
async def test_opnsense_persist_adds_source_on_merge(db_session: AsyncSession) -> None:
    existing = InventoryDevice(
        ieee_address="opnsense-merge",
        status="pending",
        discovery_source="ip_scan",
        discovery_sources=["ip_scan"],
    )
    db_session.add(existing)
    await db_session.flush()

    devices = [{"ieee_address": "opnsense-merge", "ip": "10.0.0.5"}]
    await opn_persist_devices(db_session, devices)

    await db_session.refresh(existing)
    assert "opnsense" in existing.discovery_sources


# ===========================================================================
# pfSense
# ===========================================================================

# ---------------------------------------------------------------------------
# Auth guards
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_test_connection_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/pfsense/test-connection")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_pfsense_sync_now_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/pfsense/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_pfsense_config_get_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/api/v1/pfsense/config")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_pfsense_config_post_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/pfsense/config", json={})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# test-connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_test_connection_400_no_creds(
    client: AsyncClient, headers: dict
) -> None:
    settings.pfsense_url = ""
    settings.pfsense_api_key = ""
    res = await client.post("/api/v1/pfsense/test-connection", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_pfsense_test_connection_success(
    client: AsyncClient, headers: dict
) -> None:
    _set_pfsense_creds()
    with patch(
        "app.api.routes.pfsense.test_pfsense_connection",
        new=AsyncMock(return_value=(True, "Connected")),
    ):
        res = await client.post("/api/v1/pfsense/test-connection", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["connected"] is True


@pytest.mark.asyncio
async def test_pfsense_test_connection_failure(
    client: AsyncClient, headers: dict
) -> None:
    _set_pfsense_creds()
    with patch(
        "app.api.routes.pfsense.test_pfsense_connection",
        new=AsyncMock(return_value=(False, "Timeout")),
    ):
        res = await client.post("/api/v1/pfsense/test-connection", headers=headers)
    assert res.status_code == 200
    assert res.json()["connected"] is False


# ---------------------------------------------------------------------------
# sync-now
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_sync_now_400_no_creds(
    client: AsyncClient, headers: dict
) -> None:
    settings.pfsense_url = ""
    settings.pfsense_api_key = ""
    res = await client.post("/api/v1/pfsense/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_pfsense_sync_now_creates_scan_run(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    _set_pfsense_creds()
    with patch("app.api.routes.pfsense._background_pfsense_sync", new=AsyncMock()):
        res = await client.post("/api/v1/pfsense/sync-now", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "running"
    assert body["kind"] == "pfsense"


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_config_get_no_creds(client: AsyncClient, headers: dict) -> None:
    settings.pfsense_url = ""
    settings.pfsense_api_key = ""
    res = await client.get("/api/v1/pfsense/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["credentials_configured"] is False


@pytest.mark.asyncio
async def test_pfsense_config_get_with_creds(client: AsyncClient, headers: dict) -> None:
    _set_pfsense_creds("https://pfsense.local")
    res = await client.get("/api/v1/pfsense/config", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["credentials_configured"] is True
    assert body["url"] == "https://pfsense.local"


@pytest.mark.asyncio
async def test_pfsense_config_omits_api_key(client: AsyncClient, headers: dict) -> None:
    _set_pfsense_creds()
    settings.pfsense_api_key = "verysecretkey"
    res = await client.get("/api/v1/pfsense/config", headers=headers)
    assert res.status_code == 200
    assert "verysecretkey" not in res.text


# ---------------------------------------------------------------------------
# POST /config
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_config_post_enable_without_creds_rejected(
    client: AsyncClient, headers: dict
) -> None:
    settings.pfsense_url = ""
    settings.pfsense_api_key = ""
    res = await client.post(
        "/api/v1/pfsense/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_pfsense_config_post_disable_without_creds_ok(
    client: AsyncClient, headers: dict
) -> None:
    settings.pfsense_url = ""
    settings.pfsense_api_key = ""
    with (
        patch("app.api.routes.pfsense.set_pfsense_sync_enabled"),
        patch("app.api.routes.pfsense.reschedule_pfsense_sync"),
        patch.object(type(settings), "save_overrides", lambda self: None, create=True),
    ):
        res = await client.post(
            "/api/v1/pfsense/config",
            json={"sync_enabled": False, "sync_interval": 3600},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["sync_enabled"] is False


@pytest.mark.asyncio
async def test_pfsense_config_post_updates_interval(
    client: AsyncClient, headers: dict
) -> None:
    _set_pfsense_creds()
    with (
        patch("app.api.routes.pfsense.set_pfsense_sync_enabled"),
        patch("app.api.routes.pfsense.reschedule_pfsense_sync"),
        patch.object(type(settings), "save_overrides", lambda self: None, create=True),
    ):
        res = await client.post(
            "/api/v1/pfsense/config",
            json={"sync_enabled": True, "sync_interval": 1800},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["sync_interval"] == 1800


# ---------------------------------------------------------------------------
# _find_existing (pfSense)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_find_existing_by_ieee(db_session: AsyncSession) -> None:
    dev = InventoryDevice(ieee_address="pfsense-10.0.0.1", status="pending",
                          discovery_source="pfsense", discovery_sources=["pfsense"])
    db_session.add(dev)
    await db_session.flush()

    result = await pfs_find_existing(db_session, "pfsense-10.0.0.1", None)
    assert result is not None
    assert result.ieee_address == "pfsense-10.0.0.1"


@pytest.mark.asyncio
async def test_pfsense_find_existing_by_mac_fallback(db_session: AsyncSession) -> None:
    dev = InventoryDevice(mac="cc:dd:ee:ff:00:01", status="pending",
                          discovery_source="ip_scan", discovery_sources=["ip_scan"])
    db_session.add(dev)
    await db_session.flush()

    result = await pfs_find_existing(db_session, "pfsense-ghost", "cc:dd:ee:ff:00:01")
    assert result is not None
    assert result.mac == "cc:dd:ee:ff:00:01"


@pytest.mark.asyncio
async def test_pfsense_find_existing_returns_none(db_session: AsyncSession) -> None:
    result = await pfs_find_existing(db_session, "pfsense-ghost", None)
    assert result is None


# ---------------------------------------------------------------------------
# _persist_devices (pfSense)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pfsense_persist_creates_new_device(db_session: AsyncSession) -> None:
    devices = [
        {
            "ieee_address": "pfsense-192.168.0.1",
            "ip": "192.168.0.1",
            "mac": "dd:00:00:00:00:01",
            "hostname": "pfsense",
            "label": "pfSense FW",
            "type": "firewall",
            "vendor": "Netgate",
            "model": "SG-3100",
            "properties": [],
        }
    ]
    result = await pfs_persist_devices(db_session, devices)
    assert result.device_count == 1
    assert result.pending_created == 1

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 1
    assert rows[0].discovery_source == "pfsense"
    assert rows[0].status == "pending"


@pytest.mark.asyncio
async def test_pfsense_persist_skips_device_without_ieee(
    db_session: AsyncSession,
) -> None:
    devices = [{"ip": "10.0.0.2", "mac": "ee:00:00:00:00:01"}]
    result = await pfs_persist_devices(db_session, devices)
    assert result.pending_created == 0


@pytest.mark.asyncio
async def test_pfsense_persist_updates_existing_device(db_session: AsyncSession) -> None:
    existing = InventoryDevice(
        ieee_address="pfsense-10.0.0.2",
        ip="10.0.0.2",
        status="approved",
        discovery_source="pfsense",
        discovery_sources=["pfsense"],
    )
    db_session.add(existing)
    await db_session.flush()

    devices = [
        {
            "ieee_address": "pfsense-10.0.0.2",
            "ip": "10.0.0.2",
            "hostname": "pf-updated",
            "mac": None,
        }
    ]
    result = await pfs_persist_devices(db_session, devices)
    assert result.pending_updated == 1
    assert result.pending_created == 0

    await db_session.refresh(existing)
    assert existing.hostname == "pf-updated"
    assert existing.status == "approved"


@pytest.mark.asyncio
async def test_pfsense_persist_does_not_overwrite_approved_status(
    db_session: AsyncSession,
) -> None:
    existing = InventoryDevice(
        ieee_address="pfsense-approved",
        status="approved",
        discovery_source="pfsense",
        discovery_sources=["pfsense"],
    )
    db_session.add(existing)
    await db_session.flush()

    devices = [{"ieee_address": "pfsense-approved", "ip": "5.6.7.8"}]
    await pfs_persist_devices(db_session, devices)

    await db_session.refresh(existing)
    assert existing.status == "approved"


@pytest.mark.asyncio
async def test_pfsense_persist_adds_source_on_merge(db_session: AsyncSession) -> None:
    existing = InventoryDevice(
        ieee_address="pfsense-merge",
        status="pending",
        discovery_source="ip_scan",
        discovery_sources=["ip_scan"],
    )
    db_session.add(existing)
    await db_session.flush()

    devices = [{"ieee_address": "pfsense-merge", "ip": "10.0.1.1"}]
    await pfs_persist_devices(db_session, devices)

    await db_session.refresh(existing)
    assert "pfsense" in existing.discovery_sources
