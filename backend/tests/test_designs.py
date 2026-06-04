import uuid

import pytest
from httpx import AsyncClient


@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def node_payload(**kwargs):
    return {"id": str(uuid.uuid4()), "type": "server", "label": "N", "status": "unknown", "pos_x": 0, "pos_y": 0, **kwargs}


def edge_payload(src, tgt, **kwargs):
    return {"id": str(uuid.uuid4()), "source": src, "target": tgt, "type": "ethernet", **kwargs}


async def _create(client: AsyncClient, headers: dict, **body) -> dict:
    res = await client.post("/api/v1/designs", json={"name": "D", **body}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ── auth ──────────────────────────────────────────────────────────────────────

async def test_list_designs_requires_auth(client: AsyncClient):
    res = await client.get("/api/v1/designs")
    assert res.status_code == 401


async def test_create_design_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/designs", json={"name": "X"})
    assert res.status_code == 401


# ── list / create ─────────────────────────────────────────────────────────────

async def test_list_designs_empty(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/designs", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


async def test_create_design_defaults(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Workshop")
    assert design["name"] == "Workshop"
    assert design["design_type"] == "network"
    assert design["icon"] == "dashboard"
    assert "id" in design and design["id"]


async def test_create_design_explicit_type(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Net", design_type="network")
    assert design["design_type"] == "network"


async def test_create_design_with_custom_icon(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Power", icon="zap")
    assert design["icon"] == "zap"


async def test_update_design_changes_icon(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="D", icon="dashboard")
    res = await client.put(f"/api/v1/designs/{design['id']}", json={"icon": "server"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["icon"] == "server"
    # Name left untouched when only icon is sent.
    assert res.json()["name"] == "D"


async def test_update_design_name_and_icon_together(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Old", icon="dashboard")
    res = await client.put(
        f"/api/v1/designs/{design['id']}", json={"name": "New", "icon": "network"}, headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "New"
    assert body["icon"] == "network"


async def test_create_design_creates_empty_canvas_state(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Has Canvas")
    # Loading the new design returns an (empty) canvas without falling back to another design.
    res = await client.get("/api/v1/canvas", params={"design_id": design["id"]}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["nodes"] == []
    assert body["edges"] == []


async def test_list_returns_created_designs_ordered(client: AsyncClient, headers: dict):
    a = await _create(client, headers, name="First")
    b = await _create(client, headers, name="Second")
    listed = (await client.get("/api/v1/designs", headers=headers)).json()
    ids = [d["id"] for d in listed]
    assert ids == [a["id"], b["id"]]


# ── update ────────────────────────────────────────────────────────────────────

async def test_update_design_renames(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Old Name")
    res = await client.put(f"/api/v1/designs/{design['id']}", json={"name": "New Name"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "New Name"


async def test_update_design_missing_returns_404(client: AsyncClient, headers: dict):
    res = await client.put(f"/api/v1/designs/{uuid.uuid4()}", json={"name": "X"}, headers=headers)
    assert res.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────────

async def test_delete_last_design_blocked(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Only One")
    res = await client.delete(f"/api/v1/designs/{design['id']}", headers=headers)
    assert res.status_code == 400


async def test_delete_design_missing_returns_404(client: AsyncClient, headers: dict):
    # Need >1 design so we get past nothing; 404 path is checked before the count guard.
    await _create(client, headers, name="Keep")
    res = await client.delete(f"/api/v1/designs/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


async def test_delete_design_removes_its_nodes_edges_and_canvas(client: AsyncClient, headers: dict):
    keep = await _create(client, headers, name="Keep")
    victim = await _create(client, headers, name="Victim")

    # Populate the victim design with nodes + an edge via canvas save.
    n1 = node_payload(label="A")
    n2 = node_payload(label="B")
    e1 = edge_payload(n1["id"], n2["id"])
    save = await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [n1, n2], "edges": [e1], "viewport": {}, "design_id": victim["id"]},
        headers=headers,
    )
    assert save.status_code == 200

    # Populate the kept design too, to prove scoping.
    k1 = node_payload(label="K")
    await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [k1], "edges": [], "viewport": {}, "design_id": keep["id"]},
        headers=headers,
    )

    res = await client.delete(f"/api/v1/designs/{victim['id']}", headers=headers)
    assert res.status_code == 204

    # Victim gone from list.
    listed = (await client.get("/api/v1/designs", headers=headers)).json()
    assert [d["id"] for d in listed] == [keep["id"]]

    # Kept design's node survives untouched.
    kept_canvas = (await client.get("/api/v1/canvas", params={"design_id": keep["id"]}, headers=headers)).json()
    assert len(kept_canvas["nodes"]) == 1
    assert kept_canvas["nodes"][0]["label"] == "K"
