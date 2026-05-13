"""API endpoint tests for /api/v1/zigbee/*."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# /api/v1/zigbee/test-connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_test_connection_success(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.test_mqtt_connection") as mock_conn:
        mock_conn.return_value = True
        res = await client.post(
            "/api/v1/zigbee/test-connection",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["connected"] is True
    assert "success" in data["message"].lower()


@pytest.mark.asyncio
async def test_test_connection_failure(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.test_mqtt_connection") as mock_conn:
        mock_conn.side_effect = ConnectionError("Connection refused")
        res = await client.post(
            "/api/v1/zigbee/test-connection",
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
        "/api/v1/zigbee/test-connection",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_test_connection_invalid_port(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zigbee/test-connection",
        json={"mqtt_host": "localhost", "mqtt_port": 99999},
        headers=headers,
    )
    assert res.status_code == 422  # pydantic validation error


# ---------------------------------------------------------------------------
# /api/v1/zigbee/import
# ---------------------------------------------------------------------------

_SAMPLE_NODES = [
    {
        "id": "0x00000000",
        "label": "Coordinator",
        "type": "zigbee_coordinator",
        "ieee_address": "0x00000000",
        "friendly_name": "Coordinator",
        "device_type": "Coordinator",
        "model": None,
        "vendor": None,
        "lqi": None,
        "parent_id": None,
    },
    {
        "id": "0x00000001",
        "label": "router_1",
        "type": "zigbee_router",
        "ieee_address": "0x00000001",
        "friendly_name": "router_1",
        "device_type": "Router",
        "model": "CC2530",
        "vendor": "Texas Instruments",
        "lqi": 230,
        "parent_id": "0x00000000",
    },
]

_SAMPLE_EDGES = [
    {"source": "0x00000000", "target": "0x00000001"},
]


@pytest.mark.asyncio
async def test_import_success(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = (_SAMPLE_NODES, _SAMPLE_EDGES)
        res = await client.post(
            "/api/v1/zigbee/import",
            json={
                "mqtt_host": "localhost",
                "mqtt_port": 1883,
                "base_topic": "zigbee2mqtt",
            },
            headers=headers,
        )

    assert res.status_code == 200
    data = res.json()
    assert data["device_count"] == 2
    assert len(data["nodes"]) == 2
    assert len(data["edges"]) == 1
    coordinator = next(n for n in data["nodes"] if n["type"] == "zigbee_coordinator")
    assert coordinator["ieee_address"] == "0x00000000"


@pytest.mark.asyncio
async def test_import_with_credentials(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zigbee/import",
            json={
                "mqtt_host": "localhost",
                "mqtt_port": 1883,
                "mqtt_username": "admin",
                "mqtt_password": "secret",
                "base_topic": "z2m",
            },
            headers=headers,
        )
    assert res.status_code == 200
    mock_fetch.assert_called_once_with(
        mqtt_host="localhost",
        mqtt_port=1883,
        base_topic="z2m",
        username="admin",
        password="secret",
        tls=False,
        tls_insecure=False,
    )


@pytest.mark.asyncio
async def test_import_connection_error_returns_502(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.side_effect = ConnectionError("broker unreachable")
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "bad-host", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 502
    assert "broker unreachable" in res.json()["detail"]


@pytest.mark.asyncio
async def test_import_timeout_returns_504(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.side_effect = TimeoutError("timed out")
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 504


@pytest.mark.asyncio
async def test_import_malformed_payload_returns_422(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.side_effect = ValueError("malformed response")
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_import_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zigbee/import",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_import_empty_network(client: AsyncClient, headers: dict) -> None:
    """An empty Zigbee network (coordinator only) is a valid response."""
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["device_count"] == 0
    assert data["nodes"] == []
    assert data["edges"] == []


@pytest.mark.asyncio
async def test_import_missing_mqtt_host(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zigbee/import",
        json={"mqtt_port": 1883},
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_import_with_tls_passes_flags(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zigbee/import",
            json={
                "mqtt_host": "broker.example.com",
                "mqtt_port": 8883,
                "mqtt_tls": True,
            },
            headers=headers,
        )
    assert res.status_code == 200
    kwargs = mock_fetch.call_args.kwargs
    assert kwargs["tls"] is True
    assert kwargs["tls_insecure"] is False


@pytest.mark.asyncio
async def test_import_tls_insecure_requires_tls(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zigbee/import",
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
# /api/v1/zigbee/import-pending
# ---------------------------------------------------------------------------

_PENDING_NODES = [
    {
        "id": "0xCOORD",
        "label": "Coordinator",
        "type": "zigbee_coordinator",
        "ieee_address": "0xCOORD",
        "friendly_name": "Coordinator",
        "device_type": "Coordinator",
        "model": None,
        "vendor": None,
        "lqi": None,
        "parent_id": None,
    },
    {
        "id": "0xR1",
        "label": "router_1",
        "type": "zigbee_router",
        "ieee_address": "0xR1",
        "friendly_name": "router_1",
        "device_type": "Router",
        "model": "CC2530",
        "vendor": "TI",
        "lqi": 220,
        "parent_id": "0xCOORD",
    },
    {
        "id": "0xE1",
        "label": "bulb_kitchen",
        "type": "zigbee_enddevice",
        "ieee_address": "0xE1",
        "friendly_name": "bulb_kitchen",
        "device_type": "EndDevice",
        "model": "TRADFRI",
        "vendor": "IKEA",
        "lqi": 180,
        "parent_id": "0xR1",
    },
]

_PENDING_EDGES = [
    {"source": "0xCOORD", "target": "0xR1"},
    {"source": "0xR1", "target": "0xE1"},
]


@pytest.mark.asyncio
async def test_import_pending_endpoint_creates_zigbee_scan_run(
    client: AsyncClient, headers: dict
) -> None:
    """Endpoint returns a ScanRun (kind=zigbee, status=running) immediately;
    the actual networkmap fetch + pending persist runs in the background."""
    from unittest.mock import AsyncMock

    with patch(
        "app.api.routes.zigbee._background_zigbee_import",
        new_callable=AsyncMock,
    ):
        res = await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    run = res.json()
    assert run["kind"] == "zigbee"
    assert run["status"] == "running"
    assert run["ranges"] == ["localhost:1883"]


@pytest.mark.asyncio
async def test_persist_pending_import_creates_coordinator_and_pending(
    db_session,
) -> None:
    from app.api.routes.zigbee import _persist_pending_import

    result = await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    assert result.device_count == 3
    assert result.pending_created == 2
    assert result.pending_updated == 0
    assert result.coordinator is not None
    assert result.coordinator.ieee_address == "0xCOORD"
    assert result.coordinator_already_existed is False
    assert result.links_recorded == 2


@pytest.mark.asyncio
async def test_persist_pending_import_idempotent_updates_existing(
    db_session,
) -> None:
    from app.api.routes.zigbee import _persist_pending_import

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["lqi"] = 99
    result = await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    assert result.pending_created == 0
    assert result.pending_updated == 2
    assert result.coordinator_already_existed is True
    assert result.links_recorded == 2


@pytest.mark.asyncio
async def test_persist_pending_import_replaces_links(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import PendingDeviceLink

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    new_edges = [{"source": "0xCOORD", "target": "0xR1"}]
    await _persist_pending_import(db_session, _PENDING_NODES[:2], new_edges)

    rows = (await db_session.execute(select(PendingDeviceLink))).scalars().all()
    assert len(rows) == 1
    assert (rows[0].source_ieee, rows[0].target_ieee) == ("0xCOORD", "0xR1")


@pytest.mark.asyncio
async def test_persist_pending_import_sets_coordinator_properties(db_session) -> None:
    """Coordinator Node is created with IEEE/Vendor/Model/LQI in properties."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node

    nodes_with_meta = [dict(n) for n in _PENDING_NODES]
    nodes_with_meta[0]["vendor"] = "TI"
    nodes_with_meta[0]["model"] = "CC2652"

    await _persist_pending_import(db_session, nodes_with_meta, _PENDING_EDGES)

    coord = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xCOORD"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in coord.properties}
    assert keys == {"IEEE": "0xCOORD", "Vendor": "TI", "Model": "CC2652"}


@pytest.mark.asyncio
async def test_persist_pending_import_skips_pending_for_approved_node(
    db_session,
) -> None:
    """A device already approved as a canvas Node must not reappear in pending.

    Its properties must still be refreshed with the latest Vendor/Model/LQI.
    """
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node, PendingDevice

    # Simulate: router was approved earlier → exists as a canvas Node.
    approved = Node(
        label="router_1",
        type="zigbee_router",
        status="online",
        check_method="none",
        ieee_address="0xR1",
        services=[],
        properties=[],
    )
    db_session.add(approved)
    await db_session.commit()

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["lqi"] = 250  # new LQI from re-import
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    # No PendingDevice row was created for the approved router.
    pendings = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xR1")
        )
    ).scalars().all()
    assert pendings == []

    # Node properties got refreshed.
    refreshed = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xR1"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in refreshed.properties}
    assert keys == {"IEEE": "0xR1", "Vendor": "TI", "Model": "CC2530", "LQI": "250"}


@pytest.mark.asyncio
async def test_persist_pending_import_refreshes_existing_coordinator_properties(
    db_session,
) -> None:
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[0]["vendor"] = "TI"
    bumped[0]["model"] = "CC2652"
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    coord = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xCOORD"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in coord.properties}
    assert keys["Vendor"] == "TI"
    assert keys["Model"] == "CC2652"


@pytest.mark.asyncio
async def test_import_pending_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zigbee/import-pending",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_test_connection_with_tls(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.test_mqtt_connection") as mock_conn:
        mock_conn.return_value = True
        res = await client.post(
            "/api/v1/zigbee/test-connection",
            json={
                "mqtt_host": "broker.example.com",
                "mqtt_port": 8883,
                "mqtt_tls": True,
                "mqtt_tls_insecure": True,
            },
            headers=headers,
        )
    assert res.status_code == 200
    kwargs = mock_conn.call_args.kwargs
    assert kwargs["tls"] is True
    assert kwargs["tls_insecure"] is True
