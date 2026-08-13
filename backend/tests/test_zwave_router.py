"""API endpoint tests for /api/v1/zwave/*."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# /api/v1/zwave/test-connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_test_connection_success(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.test_zwave_connection") as mock_conn:
        mock_conn.return_value = True
        res = await client.post(
            "/api/v1/zwave/test-connection",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["connected"] is True
    assert "success" in data["message"].lower()


@pytest.mark.asyncio
async def test_test_connection_failure(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.test_zwave_connection") as mock_conn:
        mock_conn.side_effect = ConnectionError("Connection refused")
        res = await client.post(
            "/api/v1/zwave/test-connection",
            json={"mqtt_host": "bad-host", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["connected"] is False
    assert "refused" in data["message"].lower()


@pytest.mark.asyncio
async def test_test_connection_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zwave/test-connection",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_test_connection_invalid_port(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zwave/test-connection",
        json={"mqtt_host": "localhost", "mqtt_port": 99999},
        headers=headers,
    )
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# /api/v1/zwave/import
# ---------------------------------------------------------------------------

_SAMPLE_NODES = [
    {
        "id": "zwave-0xh-1",
        "label": "Controller",
        "type": "zwave_coordinator",
        "ieee_address": "zwave-0xh-1",
        "friendly_name": "Controller",
        "device_type": "Controller",
        "model": None,
        "vendor": None,
        "lqi": None,
        "parent_id": None,
    },
    {
        "id": "zwave-0xh-2",
        "label": "Wall Plug",
        "type": "zwave_router",
        "ieee_address": "zwave-0xh-2",
        "friendly_name": "Wall Plug",
        "device_type": "Router",
        "model": "ZW100",
        "vendor": "Aeotec",
        "lqi": None,
        "parent_id": "zwave-0xh-1",
    },
]

_SAMPLE_EDGES = [{"source": "zwave-0xh-1", "target": "zwave-0xh-2"}]


@pytest.mark.asyncio
async def test_import_success(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.fetch_zwave_network") as mock_fetch:
        mock_fetch.return_value = (_SAMPLE_NODES, _SAMPLE_EDGES)
        res = await client.post(
            "/api/v1/zwave/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["device_count"] == 2
    assert len(data["edges"]) == 1
    coordinator = next(n for n in data["nodes"] if n["type"] == "zwave_coordinator")
    assert coordinator["ieee_address"] == "zwave-0xh-1"


@pytest.mark.asyncio
async def test_import_passes_gateway_and_prefix(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.fetch_zwave_network") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zwave/import",
            json={
                "mqtt_host": "localhost",
                "mqtt_port": 1883,
                "prefix": "myzwave",
                "gateway_name": "gw1",
                "mqtt_username": "admin",
                "mqtt_password": "secret",
            },
            headers=headers,
        )
    assert res.status_code == 200
    mock_fetch.assert_called_once_with(
        mqtt_host="localhost",
        mqtt_port=1883,
        prefix="myzwave",
        gateway_name="gw1",
        username="admin",
        password="secret",
        tls=False,
        tls_insecure=False,
    )


@pytest.mark.asyncio
async def test_import_connection_error_returns_502(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.fetch_zwave_network") as mock_fetch:
        mock_fetch.side_effect = ConnectionError("broker unreachable")
        res = await client.post(
            "/api/v1/zwave/import",
            json={"mqtt_host": "bad-host", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 502
    assert "broker unreachable" in res.json()["detail"]


@pytest.mark.asyncio
async def test_import_timeout_returns_504(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.fetch_zwave_network") as mock_fetch:
        mock_fetch.side_effect = TimeoutError("timed out")
        res = await client.post(
            "/api/v1/zwave/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 504


@pytest.mark.asyncio
async def test_import_malformed_payload_returns_422(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.fetch_zwave_network") as mock_fetch:
        mock_fetch.side_effect = ValueError("malformed response")
        res = await client.post(
            "/api/v1/zwave/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_import_unexpected_returns_500(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zwave.fetch_zwave_network") as mock_fetch:
        mock_fetch.side_effect = RuntimeError("boom")
        res = await client.post(
            "/api/v1/zwave/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 500


@pytest.mark.asyncio
async def test_import_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zwave/import",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_import_tls_insecure_requires_tls(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zwave/import",
        json={
            "mqtt_host": "broker.example.com",
            "mqtt_port": 1883,
            "mqtt_tls": False,
            "mqtt_tls_insecure": True,
        },
        headers=headers,
    )
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# /api/v1/zwave/import-pending
# ---------------------------------------------------------------------------

_PENDING_NODES = [
    {
        "id": "zwave-0xh-1",
        "label": "Controller",
        "type": "zwave_coordinator",
        "ieee_address": "zwave-0xh-1",
        "friendly_name": "Controller",
        "device_type": "Controller",
        "model": None,
        "vendor": None,
        "lqi": None,
        "parent_id": None,
    },
    {
        "id": "zwave-0xh-2",
        "label": "Wall Plug",
        "type": "zwave_router",
        "ieee_address": "zwave-0xh-2",
        "friendly_name": "Wall Plug",
        "device_type": "Router",
        "model": "ZW100",
        "vendor": "Aeotec",
        "lqi": None,
        "parent_id": "zwave-0xh-1",
    },
    {
        "id": "zwave-0xh-3",
        "label": "Door Sensor",
        "type": "zwave_enddevice",
        "ieee_address": "zwave-0xh-3",
        "friendly_name": "Door Sensor",
        "device_type": "EndDevice",
        "model": "ZW120",
        "vendor": "Aeotec",
        "lqi": None,
        "parent_id": "zwave-0xh-2",
    },
]

_PENDING_EDGES = [
    {"source": "zwave-0xh-1", "target": "zwave-0xh-2"},
    {"source": "zwave-0xh-2", "target": "zwave-0xh-3"},
]


@pytest.mark.asyncio
async def test_import_pending_creates_zwave_scan_run(client: AsyncClient, headers: dict) -> None:
    from unittest.mock import AsyncMock

    with patch("app.api.routes.zwave._background_zwave_import", new_callable=AsyncMock):
        res = await client.post(
            "/api/v1/zwave/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    run = res.json()
    assert run["kind"] == "zwave"
    assert run["status"] == "running"
    assert run["ranges"] == ["localhost:1883"]


@pytest.mark.asyncio
async def test_import_pending_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zwave/import-pending",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_persist_coordinator_goes_to_pending(db_session) -> None:
    """Coordinator is no longer auto-placed — it lands in pending like the rest."""
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import InventoryDevice, Node

    result = await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    assert result.device_count == 3
    assert result.pending_created == 3          # coordinator included now
    assert result.pending_updated == 0
    assert result.coordinator is None           # not auto-placed
    assert result.coordinator_already_existed is False
    assert result.links_recorded == 2

    nodes = (await db_session.execute(select(Node))).scalars().all()
    assert nodes == []
    coord = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == "zwave-0xh-1")
        )
    ).scalar_one()
    assert coord.status == "pending"
    assert coord.suggested_type == "zwave_coordinator"


@pytest.mark.asyncio
async def test_persist_idempotent_updates_existing(db_session) -> None:
    from app.api.routes.zwave import _persist_pending_import

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["model"] = "ZW111"
    result = await _persist_pending_import(db_session, bumped, _PENDING_EDGES)
    assert result.pending_created == 0
    assert result.pending_updated == 3          # coordinator upserts too
    assert result.coordinator_already_existed is False


@pytest.mark.asyncio
async def test_persist_replaces_links(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import InventoryDeviceLink

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    new_edges = [{"source": "zwave-0xh-1", "target": "zwave-0xh-2"}]
    await _persist_pending_import(db_session, _PENDING_NODES[:2], new_edges)
    rows = (await db_session.execute(select(InventoryDeviceLink))).scalars().all()
    assert len(rows) == 1
    assert (rows[0].source_ieee, rows[0].target_ieee) == ("zwave-0xh-1", "zwave-0xh-2")


@pytest.mark.asyncio
async def test_persist_sets_coordinator_pending_fields(db_session) -> None:
    """Coordinator lands in pending carrying its vendor/model metadata."""
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import InventoryDevice

    nodes = [dict(n) for n in _PENDING_NODES]
    nodes[0]["vendor"] = "Aeotec"
    nodes[0]["model"] = "ZW090"
    await _persist_pending_import(db_session, nodes, _PENDING_EDGES)
    coord = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == "zwave-0xh-1")
        )
    ).scalar_one()
    assert coord.vendor == "Aeotec"
    assert coord.model == "ZW090"
    assert coord.suggested_type == "zwave_coordinator"


@pytest.mark.asyncio
async def test_persist_backfills_inventory_for_approved_node(db_session) -> None:
    """On-canvas device missing its inventory row gets one backfilled
    (status="approved"); Node props still refresh."""
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import InventoryDevice, Node

    drawn = InventoryDevice(
        ieee_address="zwave-0xh-2", friendly_name="Wall Plug",
        suggested_type="zwave_router", status="approved", status_live="online",
        check_method="none",
    )
    db_session.add(drawn)
    await db_session.flush()
    db_session.add(Node(label="Wall Plug", type="zwave_router", device_id=drawn.id))
    await db_session.commit()

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    inv = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalar_one()
    assert inv.status == "approved"
    assert inv.suggested_type == "zwave_router"
    refreshed = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in refreshed.properties}
    assert keys == {"Z-Wave ID": "zwave-0xh-2", "Vendor": "Aeotec", "Model": "ZW100"}


@pytest.mark.asyncio
async def test_persist_revives_orphaned_approved_device(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import InventoryDevice

    orphan = InventoryDevice(
        ieee_address="zwave-0xh-2",
        friendly_name="Wall Plug",
        suggested_type="zwave_router",
        device_subtype="Router",
        status="approved",
        discovery_source="zwave",
    )
    db_session.add(orphan)
    await db_session.commit()

    result = await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    revived = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalar_one()
    assert revived.status == "pending"
    # Coordinator + end device are brand new → created; router was revived.
    assert result.pending_created == 2
    assert result.pending_updated == 1


@pytest.mark.asyncio
async def test_persist_keeps_hidden_hidden(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import InventoryDevice

    hidden = InventoryDevice(
        ieee_address="zwave-0xh-2",
        friendly_name="Wall Plug",
        suggested_type="zwave_router",
        device_subtype="Router",
        status="hidden",
        discovery_source="zwave",
    )
    db_session.add(hidden)
    await db_session.commit()

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    still_hidden = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalar_one()
    assert still_hidden.status == "hidden"


@pytest.mark.asyncio
async def test_persist_device_on_multiple_canvases(db_session) -> None:
    """Regression: a device on TWO designs (one Node each) must not crash
    re-import with MultipleResultsFound — props refresh on both nodes."""
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import Design, InventoryDevice, Node

    d1 = Design(name="d1")
    d2 = Design(name="d2")
    drawn = InventoryDevice(
        ieee_address="zwave-0xh-2", friendly_name="Wall Plug",
        suggested_type="zwave_router", status="approved", status_live="online",
        check_method="none",
    )
    db_session.add_all([d1, d2, drawn])
    await db_session.flush()
    for d in (d1, d2):
        db_session.add(Node(
            label="Wall Plug", type="zwave_router", device_id=drawn.id, design_id=d.id,
        ))
    await db_session.commit()

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["model"] = "ZW200"
    # Must not raise.
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    nodes = (
        await db_session.execute(select(Node).where(Node.device_id == drawn.id))
    ).scalars().all()
    assert len(nodes) == 2  # both canvas placements preserved
    # One row behind them, so one refresh serves every canvas.
    await db_session.refresh(drawn)
    model = {p["key"]: p["value"] for p in drawn.properties}.get("Model")
    assert model == "ZW200"


# ---------------------------------------------------------------------------
# /api/v1/zwave/config + /sync-now (auto-sync)
# ---------------------------------------------------------------------------

from unittest.mock import AsyncMock  # noqa: E402

from app.core.config import settings  # noqa: E402


@pytest.fixture
def _restore_zwave_env():
    """Snapshot + restore the env-only Z-Wave connection/activation settings."""
    keys = (
        "zwave_mqtt_host", "zwave_mqtt_port", "zwave_mqtt_username",
        "zwave_mqtt_password", "zwave_prefix", "zwave_gateway_name",
        "zwave_sync_enabled", "zwave_sync_interval",
    )
    saved = {k: getattr(settings, k) for k in keys}
    yield
    for k, v in saved.items():
        setattr(settings, k, v)


@pytest.mark.asyncio
async def test_config_omits_credentials(
    client: AsyncClient, headers: dict, _restore_zwave_env
) -> None:
    settings.zwave_mqtt_host = "broker"
    settings.zwave_mqtt_username = "user"
    settings.zwave_mqtt_password = "supersecret"
    res = await client.get("/api/v1/zwave/config", headers=headers)
    assert res.status_code == 200
    assert "supersecret" not in res.text
    assert "user" not in res.text
    assert res.json()["host_configured"] is True


@pytest.mark.asyncio
async def test_config_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/api/v1/zwave/config")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_enable_sync_without_host_rejected(
    client: AsyncClient, headers: dict, _restore_zwave_env
) -> None:
    settings.zwave_mqtt_host = ""
    res = await client.post(
        "/api/v1/zwave/config",
        json={"sync_enabled": True, "sync_interval": 600},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_save_config_persists_only_sync_fields(
    client: AsyncClient, headers: dict, _restore_zwave_env
) -> None:
    settings.zwave_mqtt_host = "broker"
    saved: dict = {}
    with patch.object(type(settings), "save_overrides", lambda self: saved.update(
        host=self.zwave_mqtt_host, enabled=self.zwave_sync_enabled,
        interval=self.zwave_sync_interval,
    )), patch("app.api.routes.zwave.set_zwave_sync_enabled"), \
            patch("app.api.routes.zwave.reschedule_zwave_sync"):
        res = await client.post(
            "/api/v1/zwave/config",
            json={"mqtt_host": "attacker", "sync_enabled": True, "sync_interval": 900},
            headers=headers,
        )
    assert res.status_code == 200
    assert settings.zwave_mqtt_host == "broker"  # body host ignored
    assert saved == {"host": "broker", "enabled": True, "interval": 900}


@pytest.mark.asyncio
async def test_sync_now_creates_scan_run(
    client: AsyncClient, headers: dict, _restore_zwave_env
) -> None:
    settings.zwave_mqtt_host = "broker"
    with patch("app.api.routes.zwave._background_zwave_import", new_callable=AsyncMock):
        res = await client.post("/api/v1/zwave/sync-now", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "zwave"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_host(
    client: AsyncClient, headers: dict, _restore_zwave_env
) -> None:
    settings.zwave_mqtt_host = ""
    res = await client.post("/api/v1/zwave/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_sync_now_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/zwave/sync-now")
    assert res.status_code == 401
