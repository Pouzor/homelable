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
