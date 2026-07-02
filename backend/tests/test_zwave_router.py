"""API endpoint tests for /api/v1/zwave/*."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import AsyncClient


@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


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
async def test_persist_creates_coordinator_and_pending(db_session) -> None:
    from app.api.routes.zwave import _persist_pending_import

    result = await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    assert result.device_count == 3
    assert result.pending_created == 2
    assert result.pending_updated == 0
    assert result.coordinator is not None
    assert result.coordinator.ieee_address == "zwave-0xh-1"
    assert result.coordinator_already_existed is False
    assert result.links_recorded == 2


@pytest.mark.asyncio
async def test_persist_idempotent_updates_existing(db_session) -> None:
    from app.api.routes.zwave import _persist_pending_import

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["model"] = "ZW111"
    result = await _persist_pending_import(db_session, bumped, _PENDING_EDGES)
    assert result.pending_created == 0
    assert result.pending_updated == 2
    assert result.coordinator_already_existed is True


@pytest.mark.asyncio
async def test_persist_replaces_links(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import PendingDeviceLink

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    new_edges = [{"source": "zwave-0xh-1", "target": "zwave-0xh-2"}]
    await _persist_pending_import(db_session, _PENDING_NODES[:2], new_edges)
    rows = (await db_session.execute(select(PendingDeviceLink))).scalars().all()
    assert len(rows) == 1
    assert (rows[0].source_ieee, rows[0].target_ieee) == ("zwave-0xh-1", "zwave-0xh-2")


@pytest.mark.asyncio
async def test_persist_sets_coordinator_properties(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import Node

    nodes = [dict(n) for n in _PENDING_NODES]
    nodes[0]["vendor"] = "Aeotec"
    nodes[0]["model"] = "ZW090"
    await _persist_pending_import(db_session, nodes, _PENDING_EDGES)
    coord = (
        await db_session.execute(select(Node).where(Node.ieee_address == "zwave-0xh-1"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in coord.properties}
    assert keys == {"Z-Wave ID": "zwave-0xh-1", "Vendor": "Aeotec", "Model": "ZW090"}
    assert all(p["visible"] is False for p in coord.properties)


@pytest.mark.asyncio
async def test_persist_skips_pending_for_approved_node(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import Node, PendingDevice

    approved = Node(
        label="Wall Plug",
        type="zwave_router",
        status="online",
        check_method="none",
        ieee_address="zwave-0xh-2",
        services=[],
        properties=[],
    )
    db_session.add(approved)
    await db_session.commit()

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    pendings = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalars().all()
    assert pendings == []
    refreshed = (
        await db_session.execute(select(Node).where(Node.ieee_address == "zwave-0xh-2"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in refreshed.properties}
    assert keys == {"Z-Wave ID": "zwave-0xh-2", "Vendor": "Aeotec", "Model": "ZW100"}


@pytest.mark.asyncio
async def test_persist_revives_orphaned_approved_device(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import PendingDevice

    orphan = PendingDevice(
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
            select(PendingDevice).where(PendingDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalar_one()
    assert revived.status == "pending"
    assert result.pending_created == 1
    assert result.pending_updated == 1


@pytest.mark.asyncio
async def test_persist_keeps_hidden_hidden(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zwave import _persist_pending_import
    from app.db.models import PendingDevice

    hidden = PendingDevice(
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
            select(PendingDevice).where(PendingDevice.ieee_address == "zwave-0xh-2")
        )
    ).scalar_one()
    assert still_hidden.status == "hidden"
