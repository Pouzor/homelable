"""Drill-down links: a node that opens another design when clicked through."""

import uuid

from httpx import AsyncClient

from app.db.database import _NODE_COLUMNS_SQL, _NODE_KEPT
from app.schemas.utils import normalize_linked_design


async def _design(client: AsyncClient, headers: dict, name: str) -> str:
    res = await client.post("/api/v1/designs", json={"name": name}, headers=headers)
    assert res.status_code == 201
    return res.json()["id"]


def node_payload(**kwargs):
    return {"id": str(uuid.uuid4()), "type": "server", "label": "host", "status": "unknown", "pos_x": 0, "pos_y": 0, **kwargs}


async def _save_and_load(client: AsyncClient, headers: dict, design_id: str, node: dict) -> dict:
    res = await client.post(
        "/api/v1/canvas/save",
        json={"design_id": design_id, "nodes": [node], "edges": [], "viewport": {}},
        headers=headers,
    )
    assert res.status_code == 200
    canvas = (await client.get(f"/api/v1/canvas?design_id={design_id}", headers=headers)).json()
    return canvas["nodes"][0]


# ── normalize ─────────────────────────────────────────────────────────────────

def test_normalize_blank_link_is_none():
    assert normalize_linked_design("") is None
    assert normalize_linked_design("   ") is None
    assert normalize_linked_design(None) is None
    assert normalize_linked_design("abc") == "abc"


# ── canvas save ───────────────────────────────────────────────────────────────

async def test_save_canvas_persists_the_link(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    inside = await _design(client, headers, "Inside the host")
    node = await _save_and_load(client, headers, network, node_payload(linked_design_id=inside))
    assert node["linked_design_id"] == inside


async def test_save_canvas_link_defaults_to_null(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    node = await _save_and_load(client, headers, network, node_payload())
    assert node["linked_design_id"] is None


async def test_save_canvas_drops_links_that_lead_nowhere(client: AsyncClient, headers: dict):
    # A missing design or the canvas itself: dropped, never a 422 that costs the save.
    network = await _design(client, headers, "Network")
    node = await _save_and_load(client, headers, network, node_payload(linked_design_id="no-such-design"))
    assert node["linked_design_id"] is None
    node = await _save_and_load(client, headers, network, node_payload(linked_design_id=network))
    assert node["linked_design_id"] is None


# ── node routes ───────────────────────────────────────────────────────────────

async def test_create_node_with_link(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    inside = await _design(client, headers, "Inside")
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "host", "design_id": network, "linked_design_id": inside},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["linked_design_id"] == inside


async def test_create_node_rejects_a_missing_design(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "host", "design_id": network, "linked_design_id": "no-such-design"},
        headers=headers,
    )
    assert res.status_code == 404


async def test_patch_sets_and_clears_the_link(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    inside = await _design(client, headers, "Inside")
    node_id = (
        await client.post("/api/v1/nodes", json={"type": "server", "label": "host", "design_id": network}, headers=headers)
    ).json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"linked_design_id": inside}, headers=headers)
    assert res.status_code == 200
    assert res.json()["linked_design_id"] == inside

    # Another field alone keeps the link.
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"label": "kero"}, headers=headers)
    assert res.json()["linked_design_id"] == inside

    # Null and blank both clear it.
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"linked_design_id": None}, headers=headers)
    assert res.json()["linked_design_id"] is None
    await client.patch(f"/api/v1/nodes/{node_id}", json={"linked_design_id": inside}, headers=headers)
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"linked_design_id": ""}, headers=headers)
    assert res.json()["linked_design_id"] is None


async def test_patch_rejects_the_own_design_and_a_missing_one(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    node_id = (
        await client.post("/api/v1/nodes", json={"type": "server", "label": "host", "design_id": network}, headers=headers)
    ).json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"linked_design_id": network}, headers=headers)
    assert res.status_code == 400
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"linked_design_id": "no-such-design"}, headers=headers)
    assert res.status_code == 404


# ── design delete ─────────────────────────────────────────────────────────────

async def test_deleting_the_linked_design_clears_the_link(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    inside = await _design(client, headers, "Inside")
    node_id = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "server", "label": "host", "design_id": network, "linked_design_id": inside},
            headers=headers,
        )
    ).json()["id"]

    res = await client.delete(f"/api/v1/designs/{inside}", headers=headers)
    assert res.status_code == 204
    res = await client.get(f"/api/v1/nodes/{node_id}", headers=headers)
    assert res.json()["linked_design_id"] is None


async def test_copying_a_design_keeps_its_links(client: AsyncClient, headers: dict):
    network = await _design(client, headers, "Network")
    inside = await _design(client, headers, "Inside")
    await _save_and_load(client, headers, network, node_payload(linked_design_id=inside))

    copy = (await client.post(f"/api/v1/designs/{network}/copy", json={"name": "Copy"}, headers=headers)).json()
    canvas = (await client.get(f"/api/v1/canvas?design_id={copy['id']}", headers=headers)).json()
    assert canvas["nodes"][0]["linked_design_id"] == inside


# ── migration ─────────────────────────────────────────────────────────────────

def test_nodes_rebuild_keeps_the_link():
    kept = {c.strip() for c in _NODE_KEPT.split(",")}
    declared = {d.split()[0] for d in _NODE_COLUMNS_SQL.split(",")}
    assert "linked_design_id" in kept
    assert "linked_design_id" in declared
