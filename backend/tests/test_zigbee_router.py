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
async def test_import_pending_creates_coordinator_and_pending(
    client: AsyncClient, headers: dict
) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = (_PENDING_NODES, _PENDING_EDGES)
        res = await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["device_count"] == 3
    assert data["pending_created"] == 2  # router + enddevice
    assert data["pending_updated"] == 0
    assert data["coordinator"] is not None
    assert data["coordinator"]["ieee_address"] == "0xCOORD"
    assert data["coordinator_already_existed"] is False
    assert data["links_recorded"] == 2

    pending = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending.status_code == 200
    rows = pending.json()
    ieees = {r["ieee_address"] for r in rows}
    assert ieees == {"0xR1", "0xE1"}
    router = next(r for r in rows if r["ieee_address"] == "0xR1")
    assert router["model"] == "CC2530"
    assert router["lqi"] == 220
    assert router["device_subtype"] == "Router"
    assert router["discovery_source"] == "zigbee"


@pytest.mark.asyncio
async def test_import_pending_idempotent_updates_existing(
    client: AsyncClient, headers: dict
) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = (_PENDING_NODES, _PENDING_EDGES)
        await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )

        bumped = [dict(n) for n in _PENDING_NODES]
        bumped[1]["lqi"] = 99
        res = await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
        # second call: returns the bumped data
        mock_fetch.return_value = (bumped, _PENDING_EDGES)
        res = await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )

    assert res.status_code == 200
    data = res.json()
    assert data["pending_created"] == 0
    assert data["pending_updated"] == 2
    assert data["coordinator_already_existed"] is True
    assert data["links_recorded"] == 2

    pending = await client.get("/api/v1/scan/pending", headers=headers)
    router = next(r for r in pending.json() if r["ieee_address"] == "0xR1")
    assert router["lqi"] == 99


@pytest.mark.asyncio
async def test_import_pending_replaces_links(
    client: AsyncClient, headers: dict, db_session
) -> None:
    """Re-importing wipes old zigbee links and inserts only the fresh set."""
    from sqlalchemy import select

    from app.db.models import PendingDeviceLink

    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = (_PENDING_NODES, _PENDING_EDGES)
        await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )

        new_edges = [{"source": "0xCOORD", "target": "0xR1"}]
        mock_fetch.return_value = (_PENDING_NODES[:2], new_edges)
        await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )

    result = await db_session.execute(select(PendingDeviceLink))
    links = result.scalars().all()
    assert len(links) == 1
    assert (links[0].source_ieee, links[0].target_ieee) == ("0xCOORD", "0xR1")


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
