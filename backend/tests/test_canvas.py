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


# ── load_canvas ───────────────────────────────────────────────────────────────

async def test_load_canvas_empty(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/canvas", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["nodes"] == []
    assert data["edges"] == []
    assert data["viewport"] == {"x": 0, "y": 0, "zoom": 1}


async def test_load_canvas_requires_auth(client: AsyncClient):
    res = await client.get("/api/v1/canvas")
    assert res.status_code == 401


# ── save_canvas ───────────────────────────────────────────────────────────────

async def test_save_canvas_creates_nodes_and_edges(client: AsyncClient, headers: dict):
    n1 = node_payload(label="Router", type="router")
    n2 = node_payload(label="Switch", type="switch")
    e1 = edge_payload(n1["id"], n2["id"])

    res = await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {"x": 1, "y": 2, "zoom": 1.5}}, headers=headers)
    assert res.status_code == 200
    assert res.json() == {"saved": True}

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert len(canvas["nodes"]) == 2
    assert len(canvas["edges"]) == 1
    assert canvas["viewport"] == {"x": 1, "y": 2, "zoom": 1.5}


async def test_save_canvas_updates_existing_node(client: AsyncClient, headers: dict):
    n1 = node_payload(label="Old Label")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_updated = {**n1, "label": "New Label", "ip": "10.0.0.1"}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_updated], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert len(canvas["nodes"]) == 1
    assert canvas["nodes"][0]["label"] == "New Label"
    assert canvas["nodes"][0]["ip"] == "10.0.0.1"


async def test_save_canvas_deletes_removed_nodes(client: AsyncClient, headers: dict):
    n1 = node_payload(label="Keep")
    n2 = node_payload(label="Remove")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [], "viewport": {}}, headers=headers)

    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert len(canvas["nodes"]) == 1
    assert canvas["nodes"][0]["label"] == "Keep"


async def test_save_canvas_deletes_removed_edges(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"])
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["edges"] == []


async def test_save_canvas_persists_viewport_on_update(client: AsyncClient, headers: dict):
    await client.post("/api/v1/canvas/save", json={"nodes": [], "edges": [], "viewport": {"x": 10, "y": 20, "zoom": 2}}, headers=headers)
    await client.post("/api/v1/canvas/save", json={"nodes": [], "edges": [], "viewport": {"x": 5, "y": 5, "zoom": 0.5}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["viewport"] == {"x": 5, "y": 5, "zoom": 0.5}


async def test_save_canvas_persists_custom_colors(client: AsyncClient, headers: dict):
    n1 = node_payload(custom_colors={"border": "#ff0000", "icon": "#00ff00"})
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["custom_colors"] == {"border": "#ff0000", "icon": "#00ff00"}


async def test_save_canvas_persists_edge_custom_color_and_path_style(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], custom_color="#a855f7", path_style="smooth")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    edge = canvas["edges"][0]
    assert edge["custom_color"] == "#a855f7"
    assert edge["path_style"] == "smooth"


async def test_save_canvas_persists_custom_icon(client: AsyncClient, headers: dict):
    n1 = node_payload(custom_icon="cctv")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["custom_icon"] == "cctv"


async def test_save_canvas_custom_icon_cleared_when_null(client: AsyncClient, headers: dict):
    n1 = node_payload(custom_icon="cctv")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_cleared = {**n1, "custom_icon": None}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_cleared], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["custom_icon"] is None


async def test_save_canvas_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/canvas/save", json={"nodes": [], "edges": [], "viewport": {}})
    assert res.status_code == 401


async def test_save_canvas_persists_hardware_fields(client: AsyncClient, headers: dict):
    n1 = node_payload(cpu_count=8, cpu_model="Intel i7-12700K", ram_gb=32.0, disk_gb=500.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["cpu_count"] == 8
    assert node["cpu_model"] == "Intel i7-12700K"
    assert node["ram_gb"] == 32.0
    assert node["disk_gb"] == 500.0


async def test_save_canvas_hardware_fields_nullable(client: AsyncClient, headers: dict):
    n1 = node_payload(cpu_count=4, ram_gb=16.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["cpu_count"] == 4
    assert node["ram_gb"] == 16.0
    assert node["cpu_model"] is None
    assert node["disk_gb"] is None


async def test_save_canvas_persists_show_hardware(client: AsyncClient, headers: dict):
    n1 = node_payload(show_hardware=True, cpu_count=4, ram_gb=16.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["show_hardware"] is True


async def test_save_canvas_show_hardware_defaults_false(client: AsyncClient, headers: dict):
    n1 = node_payload()
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["show_hardware"] is False


async def test_save_canvas_hardware_fields_cleared_on_update(client: AsyncClient, headers: dict):
    n1 = node_payload(cpu_count=8, ram_gb=32.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_cleared = {**n1, "cpu_count": None, "ram_gb": None}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_cleared], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["cpu_count"] is None
    assert node["ram_gb"] is None


# ── node width / height (resizable nodes) ─────────────────────────────────────

async def test_save_canvas_persists_node_dimensions(client: AsyncClient, headers: dict):
    n1 = node_payload(width=320.0, height=180.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["width"] == 320.0
    assert node["height"] == 180.0


async def test_save_canvas_dimensions_default_null(client: AsyncClient, headers: dict):
    n1 = node_payload()
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["width"] is None
    assert canvas["nodes"][0]["height"] is None


async def test_save_canvas_dimensions_updated_on_resize(client: AsyncClient, headers: dict):
    n1 = node_payload(width=140.0, height=50.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_resized = {**n1, "width": 280.0, "height": 120.0}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_resized], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["width"] == 280.0
    assert node["height"] == 120.0


async def test_save_canvas_dimensions_cleared_when_null(client: AsyncClient, headers: dict):
    n1 = node_payload(width=300.0, height=200.0)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_cleared = {**n1, "width": None, "height": None}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_cleared], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["width"] is None
    assert canvas["nodes"][0]["height"] is None
