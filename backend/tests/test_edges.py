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


@pytest.fixture
async def two_nodes(client: AsyncClient, headers: dict):
    n1 = (await client.post("/api/v1/nodes", json={"type": "router", "label": "R1", "status": "online"}, headers=headers)).json()
    n2 = (await client.post("/api/v1/nodes", json={"type": "switch", "label": "SW1", "status": "online"}, headers=headers)).json()
    return n1["id"], n2["id"]


async def test_create_edge(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)
    assert res.status_code == 201
    data = res.json()
    assert data["source"] == src
    assert data["target"] == tgt
    assert data["type"] == "ethernet"


async def test_create_vlan_edge(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "vlan", "vlan_id": 20, "label": "VLAN 20"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["vlan_id"] == 20


async def test_list_edges(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)
    res = await client.get("/api/v1/edges", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


async def test_delete_edge(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    edge_id = (await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "wifi"}, headers=headers)).json()["id"]
    res = await client.delete(f"/api/v1/edges/{edge_id}", headers=headers)
    assert res.status_code == 204
    assert len((await client.get("/api/v1/edges", headers=headers)).json()) == 0
