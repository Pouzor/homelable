from unittest.mock import patch

import pytest
from httpx import AsyncClient

TOKEN_HASH = "$2b$12$o/LWyvmBc978CNpSsHxcveXN0WqjAGW/gBR0.U.HURWbaYD3GCDqS"


@pytest.fixture
async def headers(client: AsyncClient):
    with patch("app.api.routes.auth._load_credentials", return_value=("admin", TOKEN_HASH)):
        res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_list_nodes_empty(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/nodes", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


async def test_create_node(client: AsyncClient, headers: dict):
    payload = {"type": "server", "label": "My Server", "ip": "192.168.1.10", "status": "unknown"}
    res = await client.post("/api/v1/nodes", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["label"] == "My Server"
    assert data["ip"] == "192.168.1.10"
    assert "id" in data


async def test_get_node(client: AsyncClient, headers: dict):
    create = await client.post("/api/v1/nodes", json={"type": "router", "label": "Router", "status": "online"}, headers=headers)
    node_id = create.json()["id"]
    res = await client.get(f"/api/v1/nodes/{node_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["id"] == node_id


async def test_get_node_not_found(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/nodes/nonexistent-id", headers=headers)
    assert res.status_code == 404


async def test_update_node(client: AsyncClient, headers: dict):
    create = await client.post("/api/v1/nodes", json={"type": "server", "label": "Old", "status": "unknown"}, headers=headers)
    node_id = create.json()["id"]
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"label": "New", "ip": "10.0.0.1"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["label"] == "New"
    assert res.json()["ip"] == "10.0.0.1"


async def test_delete_node(client: AsyncClient, headers: dict):
    create = await client.post("/api/v1/nodes", json={"type": "switch", "label": "Switch", "status": "unknown"}, headers=headers)
    node_id = create.json()["id"]
    res = await client.delete(f"/api/v1/nodes/{node_id}", headers=headers)
    assert res.status_code == 204
    assert (await client.get(f"/api/v1/nodes/{node_id}", headers=headers)).status_code == 404


async def test_list_nodes_returns_all(client: AsyncClient, headers: dict):
    for i in range(3):
        await client.post("/api/v1/nodes", json={"type": "generic", "label": f"Node {i}", "status": "unknown"}, headers=headers)
    res = await client.get("/api/v1/nodes", headers=headers)
    assert len(res.json()) == 3
