"""API + persistence tests for /api/v1/synology/*."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.routes.synology import _background_synology_import, _persist_pending_import
from app.core.config import settings
from app.db.models import InventoryDevice, Node


@pytest.fixture(autouse=True)
def _clear_env_credentials():
    """Ensure a clean credential state per test; restore afterwards."""
    user, pw = settings.synology_username, settings.synology_password
    settings.synology_username = ""
    settings.synology_password = ""
    yield
    settings.synology_username, settings.synology_password = user, pw


def _nas_node(ip: str | None = "192.168.1.20", mac: str | None = "aa:bb:cc:dd:ee:ff") -> dict:
    return {
        "id": "syno-1230ABC",
        "label": "nas",
        "type": "nas",
        "ieee_address": "syno-1230ABC",
        "hostname": "nas",
        "ip": ip,
        "mac": mac,
        "status": "online",
        "ram_gb": 16.0,
        "disk_gb": 32.0,
        "vendor": "Synology",
        "model": "DS1821+",
        "serial": "1230ABC",
        "firmware": "DSM 7.2.1",
        "volume_lines": ["Volume 1: 8/32 GB (25%)"],
        "volume_health": "healthy",
        "disk_health": "4 healthy",
        "check_method": "https",
        "check_target": "https://192.168.1.20:5001",
    }


# --- endpoints -------------------------------------------------------------

@pytest.mark.asyncio
async def test_test_connection_uses_body_credentials(client: AsyncClient, headers: dict) -> None:
    with patch(
        "app.api.routes.synology.test_synology_connection",
        new=AsyncMock(return_value=(True, "ok")),
    ):
        res = await client.post(
            "/api/v1/synology/test-connection",
            json={"host": "nas", "port": 5001, "username": "hl", "password": "s"},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["connected"] is True


@pytest.mark.asyncio
async def test_missing_credentials_is_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/synology/test-connection",
        json={"host": "nas", "port": 5001},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_import_pending_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.synology._background_synology_import", new_callable=AsyncMock):
        res = await client.post(
            "/api/v1/synology/import-pending",
            json={"host": "nas", "port": 5001, "username": "hl", "password": "s"},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "synology"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    settings.synology_host = "nas"
    settings.synology_username = "hl"
    settings.synology_password = "s"
    with patch("app.api.routes.synology._background_synology_import", new_callable=AsyncMock):
        res = await client.post("/api/v1/synology/sync-now", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "synology"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_credentials(client: AsyncClient, headers: dict) -> None:
    settings.synology_host = "nas"
    res = await client.post("/api/v1/synology/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_sync_now_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/synology/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/synology/import-pending", json={"host": "nas"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_config_omits_password(client: AsyncClient, headers: dict) -> None:
    settings.synology_username = "hl"
    settings.synology_password = "supersecret"
    res = await client.get("/api/v1/synology/config", headers=headers)
    assert res.status_code == 200
    body = res.text
    assert "supersecret" not in body
    assert res.json()["credentials_configured"] is True


@pytest.mark.asyncio
async def test_enable_sync_without_credentials_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/synology/config",
        json={"sync_enabled": True, "sync_interval": 600},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_save_config_persists_only_sync_fields(client: AsyncClient, headers: dict) -> None:
    settings.synology_host = "nas"
    settings.synology_username = "hl"
    settings.synology_password = "s"
    saved: dict = {}
    with patch.object(type(settings), "save_overrides", lambda self: saved.update(
        host=self.synology_host, enabled=self.synology_sync_enabled, interval=self.synology_sync_interval
    )), patch("app.api.routes.synology.set_synology_sync_enabled"), \
            patch("app.api.routes.synology.reschedule_synology_sync"):
        res = await client.post(
            "/api/v1/synology/config",
            json={"host": "attacker", "port": 1, "verify_tls": False, "sync_enabled": True, "sync_interval": 900},
            headers=headers,
        )
    assert res.status_code == 200
    assert settings.synology_host == "nas"
    assert saved == {"host": "nas", "enabled": True, "interval": 900}


@pytest.mark.asyncio
async def test_background_import_broadcasts_refresh() -> None:
    fake_db = AsyncMock()
    fake_db.get = AsyncMock(return_value=None)
    cm = AsyncMock()
    cm.__aenter__.return_value = fake_db
    cm.__aexit__.return_value = False

    with patch("app.api.routes.synology.AsyncSessionLocal", MagicMock(return_value=cm)), \
         patch("app.api.routes.synology.fetch_synology_inventory", new=AsyncMock(return_value=[])), \
         patch("app.api.routes.synology._persist_pending_import",
               new=AsyncMock(return_value=SimpleNamespace(device_count=1))), \
         patch("app.api.routes.status.broadcast_scan_update", new=AsyncMock()) as bcast:
        await _background_synology_import("run1", "h", 5001, "u", "s", True, None)

    bcast.assert_awaited_once()
    assert bcast.await_args.kwargs["devices_found"] == 1


# --- persistence / dedupe --------------------------------------------------

@pytest.mark.asyncio
async def test_persist_creates_pending(db_session) -> None:
    result = await _persist_pending_import(db_session, [_nas_node()])
    assert result.pending_created == 1
    row = (await db_session.execute(select(InventoryDevice))).scalars().one()
    assert row.suggested_type == "nas"
    assert row.discovery_source == "synology"
    assert row.check_method == "https"
    assert any(p["key"] == "Model" for p in row.properties)


@pytest.mark.asyncio
async def test_persist_merges_existing_scanned_node_by_ip(db_session) -> None:
    scanned_device = InventoryDevice(
        id=str(uuid.uuid4()), ip="192.168.1.20", suggested_type="generic",
        status="approved", discovery_source="arp", discovery_sources=["arp"],
    )
    db_session.add(scanned_device)
    await db_session.flush()
    scanned = Node(
        id=str(uuid.uuid4()), type="generic", label="192.168.1.20",
        device_id=scanned_device.id, pos_x=0, pos_y=0,
    )
    db_session.add(scanned)
    await db_session.commit()

    await _persist_pending_import(db_session, [_nas_node("192.168.1.20")])

    nodes = (await db_session.execute(select(Node))).scalars().all()
    assert len(nodes) == 1
    merged = await db_session.get(InventoryDevice, nodes[0].device_id)
    assert merged is not None
    assert merged.ieee_address == "syno-1230ABC"
    assert merged.status == "approved"
    assert set(merged.discovery_sources) == {"arp", "synology"}


@pytest.mark.asyncio
async def test_persist_merges_pending_scan_row_by_mac(db_session) -> None:
    db_session.add(InventoryDevice(
        id=str(uuid.uuid4()), ip="192.168.1.20", mac="aa:bb:cc:dd:ee:ff",
        suggested_type="generic", status="pending",
        discovery_source="arp", discovery_sources=["arp"],
    ))
    await db_session.commit()

    await _persist_pending_import(db_session, [_nas_node(ip=None, mac="AA:BB:CC:DD:EE:FF")])

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.ieee_address == "syno-1230ABC"
    assert row.suggested_type == "nas"
    assert set(row.discovery_sources) == {"arp", "synology"}


@pytest.mark.asyncio
async def test_persist_preserves_ip_tag_for_legacy_null_source_row(db_session) -> None:
    db_session.add(InventoryDevice(
        id=str(uuid.uuid4()), ip="192.168.1.20", mac="aa:bb:cc:dd:ee:ff",
        suggested_type="nas", status="pending",
        discovery_source=None, discovery_sources=[],
    ))
    await db_session.commit()

    await _persist_pending_import(db_session, [_nas_node()])

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 1
    assert set(rows[0].discovery_sources) == {"arp", "synology"}


@pytest.mark.asyncio
async def test_persist_does_not_add_ip_tag_to_pure_synology_nas(db_session) -> None:
    await _persist_pending_import(db_session, [_nas_node()])
    await _persist_pending_import(db_session, [_nas_node()])
    row = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.ieee_address == "syno-1230ABC")
    )).scalar_one()
    assert set(row.discovery_sources) == {"synology"}


@pytest.mark.asyncio
async def test_persist_resync_updates_in_place(db_session) -> None:
    await _persist_pending_import(db_session, [_nas_node("192.168.1.20")])
    await _persist_pending_import(db_session, [_nas_node("192.168.1.21")])
    rows = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.ieee_address == "syno-1230ABC")
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].ip == "192.168.1.21"


@pytest.mark.asyncio
async def test_persist_keeps_hidden_hidden(db_session) -> None:
    db_session.add(InventoryDevice(
        id=str(uuid.uuid4()), ieee_address="syno-1230ABC", ip="192.168.1.20",
        suggested_type="nas", status="hidden", discovery_source="synology",
    ))
    await db_session.commit()
    await _persist_pending_import(db_session, [_nas_node()])
    row = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.ieee_address == "syno-1230ABC")
    )).scalar_one()
    assert row.status == "hidden"


@pytest.mark.asyncio
async def test_persist_never_deletes(db_session) -> None:
    await _persist_pending_import(db_session, [_nas_node()])
    other = {**_nas_node(), "ieee_address": "syno-OTHER", "id": "syno-OTHER", "serial": "OTHER"}
    await _persist_pending_import(db_session, [other])
    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    ieees = {r.ieee_address for r in rows}
    assert "syno-1230ABC" in ieees and "syno-OTHER" in ieees
