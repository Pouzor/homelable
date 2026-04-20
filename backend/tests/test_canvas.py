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


async def test_save_canvas_persists_zone_label_position_and_text_size(client: AsyncClient, headers: dict):
    """label_position and text_size are stored in custom_colors and returned unchanged."""
    n1 = node_payload(custom_colors={
        "border": "#00d4ff",
        "border_style": "solid",
        "border_width": 3,
        "label_position": "outside",
        "text_size": 16,
        "text_color": "#e6edf3",
    })
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    cc = canvas["nodes"][0]["custom_colors"]
    assert cc["label_position"] == "outside"
    assert cc["text_size"] == 16
    assert cc["border_width"] == 3


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


# ── properties ────────────────────────────────────────────────────────────────

async def test_save_canvas_properties_default_empty(client: AsyncClient, headers: dict):
    n1 = node_payload()
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["properties"] == []


async def test_save_canvas_persists_properties(client: AsyncClient, headers: dict):
    props = [
        {"key": "RAM", "value": "32 GB", "icon": "MemoryStick", "visible": True},
        {"key": "CPU", "value": "Intel i9", "icon": "Cpu", "visible": False},
    ]
    n1 = node_payload(properties=props)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    returned = canvas["nodes"][0]["properties"]
    assert len(returned) == 2
    assert returned[0] == {"key": "RAM", "value": "32 GB", "icon": "MemoryStick", "visible": True}
    assert returned[1] == {"key": "CPU", "value": "Intel i9", "icon": "Cpu", "visible": False}


async def test_save_canvas_properties_updated_on_second_save(client: AsyncClient, headers: dict):
    n1 = node_payload(properties=[{"key": "RAM", "value": "16 GB", "icon": None, "visible": True}])
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_updated = {**n1, "properties": [
        {"key": "RAM", "value": "64 GB", "icon": "MemoryStick", "visible": True},
        {"key": "Disk", "value": "2 TB", "icon": "HardDrive", "visible": True},
    ]}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_updated], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    props = canvas["nodes"][0]["properties"]
    assert len(props) == 2
    assert props[0]["value"] == "64 GB"
    assert props[1]["key"] == "Disk"


async def test_save_canvas_properties_with_null_icon(client: AsyncClient, headers: dict):
    props = [{"key": "Note", "value": "custom rack", "icon": None, "visible": True}]
    n1 = node_payload(properties=props)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["properties"][0]["icon"] is None


async def test_save_canvas_properties_cleared_to_empty(client: AsyncClient, headers: dict):
    n1 = node_payload(properties=[{"key": "RAM", "value": "32 GB", "icon": None, "visible": True}])
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    n1_cleared = {**n1, "properties": []}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1_cleared], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["properties"] == []


# ── edge waypoints & handles ──────────────────────────────────────────────────

async def test_save_canvas_edge_waypoints_default_null(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"])
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["edges"][0]["waypoints"] is None


async def test_save_canvas_persists_waypoints_on_edge(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    waypoints = [{"x": 100.0, "y": 200.0}, {"x": 300.0, "y": 150.0}]
    e1 = edge_payload(n1["id"], n2["id"], waypoints=waypoints)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    returned = canvas["edges"][0]["waypoints"]
    assert returned == [{"x": 100.0, "y": 200.0}, {"x": 300.0, "y": 150.0}]


async def test_save_canvas_waypoints_updated_on_second_save(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], waypoints=[{"x": 10.0, "y": 20.0}])
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    e1_updated = {**e1, "waypoints": [{"x": 50.0, "y": 60.0}, {"x": 70.0, "y": 80.0}]}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1_updated], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["edges"][0]["waypoints"] == [{"x": 50.0, "y": 60.0}, {"x": 70.0, "y": 80.0}]


async def test_save_canvas_persists_edge_handles(client: AsyncClient, headers: dict):
    n1 = node_payload(bottom_handles=3)
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], source_handle="bottom-1", target_handle="top")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    edge = canvas["edges"][0]
    assert edge["source_handle"] == "bottom-1"
    assert edge["target_handle"] == "top"


async def test_save_canvas_persists_animated_edge(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], animated="snake")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["edges"][0]["animated"] == "snake"


async def test_save_canvas_persists_animated_basic(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], animated="basic")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["edges"][0]["animated"] == "basic"


# ── node fields ───────────────────────────────────────────────────────────────

async def test_save_canvas_persists_all_node_fields(client: AsyncClient, headers: dict):
    n1 = node_payload(
        type="server",
        label="Main Server",
        hostname="server.local",
        ip="192.168.1.10",
        mac="aa:bb:cc:dd:ee:ff",
        os="Ubuntu 22.04",
        status="online",
        check_method="http",
        check_target="http://192.168.1.10",
        services=[{"name": "nginx", "port": 80}],
        notes="Primary web server",
        pos_x=150.0,
        pos_y=250.0,
        bottom_handles=2,
    )
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["hostname"] == "server.local"
    assert node["ip"] == "192.168.1.10"
    assert node["mac"] == "aa:bb:cc:dd:ee:ff"
    assert node["os"] == "Ubuntu 22.04"
    assert node["status"] == "online"
    assert node["check_method"] == "http"
    assert node["check_target"] == "http://192.168.1.10"
    assert node["services"] == [{"name": "nginx", "port": 80}]
    assert node["notes"] == "Primary web server"
    assert node["pos_x"] == 150.0
    assert node["pos_y"] == 250.0
    assert node["bottom_handles"] == 2


async def test_save_canvas_persists_bottom_handles(client: AsyncClient, headers: dict):
    n1 = node_payload(bottom_handles=4)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["bottom_handles"] == 4


async def test_save_canvas_bottom_handles_defaults_one(client: AsyncClient, headers: dict):
    n1 = node_payload()
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["bottom_handles"] == 1


async def test_save_canvas_persists_services_and_notes(client: AsyncClient, headers: dict):
    services = [{"name": "ssh", "port": 22}, {"name": "http", "port": 80}]
    n1 = node_payload(services=services, notes="My NAS device")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["services"] == services
    assert node["notes"] == "My NAS device"


async def test_save_canvas_persists_service_paths(client: AsyncClient, headers: dict):
    services = [{"service_name": "Grafana", "protocol": "tcp", "port": 3000, "path": "/login"}]
    n1 = node_payload(ip="192.168.1.50:8080", services=services)
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"][0]["services"] == services


async def test_save_canvas_persists_check_fields(client: AsyncClient, headers: dict):
    n1 = node_payload(check_method="ping", check_target="192.168.1.1")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node = canvas["nodes"][0]
    assert node["check_method"] == "ping"
    assert node["check_target"] == "192.168.1.1"


# ── parent/child nodes ────────────────────────────────────────────────────────

async def test_save_canvas_persists_parent_child_nodes(client: AsyncClient, headers: dict):
    parent = node_payload(type="proxmox", label="PVE Host")
    child = node_payload(type="vm", label="VM-100", parent_id=parent["id"])
    await client.post("/api/v1/canvas/save", json={"nodes": [parent, child], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node_map = {n["id"]: n for n in canvas["nodes"]}
    assert node_map[child["id"]]["parent_id"] == parent["id"]
    assert node_map[parent["id"]]["parent_id"] is None


async def test_save_canvas_child_removed_with_parent(client: AsyncClient, headers: dict):
    parent = node_payload(type="proxmox", label="PVE Host")
    child = node_payload(type="lxc", label="LXC-101", parent_id=parent["id"])
    await client.post("/api/v1/canvas/save", json={"nodes": [parent, child], "edges": [], "viewport": {}}, headers=headers)

    # Remove both parent and child
    await client.post("/api/v1/canvas/save", json={"nodes": [], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["nodes"] == []


# ── groupRect / group node ────────────────────────────────────────────────────

async def test_save_canvas_persists_group_node(client: AsyncClient, headers: dict):
    group = node_payload(type="group", label="Network Zone", width=400.0, height=300.0)
    member = node_payload(type="server", label="Member", parent_id=group["id"])
    await client.post("/api/v1/canvas/save", json={"nodes": [group, member], "edges": [], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    node_map = {n["id"]: n for n in canvas["nodes"]}
    assert node_map[group["id"]]["type"] == "group"
    assert node_map[group["id"]]["width"] == 400.0
    assert node_map[group["id"]]["height"] == 300.0
    assert node_map[member["id"]]["parent_id"] == group["id"]


# ── viewport ──────────────────────────────────────────────────────────────────

async def test_load_canvas_returns_default_viewport_when_no_state(client: AsyncClient, headers: dict):
    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["viewport"] == {"x": 0, "y": 0, "zoom": 1}


async def test_save_canvas_updates_existing_canvas_state(client: AsyncClient, headers: dict):
    """Second save updates the existing CanvasState row (exercises the state.viewport branch)."""
    await client.post("/api/v1/canvas/save", json={"nodes": [], "edges": [], "viewport": {"x": 1, "y": 2, "zoom": 1}}, headers=headers)
    await client.post("/api/v1/canvas/save", json={"nodes": [], "edges": [], "viewport": {"x": 99, "y": 88, "zoom": 0.75}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    assert canvas["viewport"] == {"x": 99, "y": 88, "zoom": 0.75}


# ── edge types ────────────────────────────────────────────────────────────────

async def test_save_canvas_persists_edge_type_vlan(client: AsyncClient, headers: dict):
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], type="vlan", vlan_id=10, label="VLAN 10")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    edge = canvas["edges"][0]
    assert edge["type"] == "vlan"
    assert edge["vlan_id"] == 10
    assert edge["label"] == "VLAN 10"


async def test_save_canvas_edge_update_existing(client: AsyncClient, headers: dict):
    """Second save updates an existing edge (exercises the db_edge branch)."""
    n1 = node_payload()
    n2 = node_payload()
    e1 = edge_payload(n1["id"], n2["id"], label="original")
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1], "viewport": {}}, headers=headers)

    e1_updated = {**e1, "label": "updated", "custom_color": "#ff0000"}
    await client.post("/api/v1/canvas/save", json={"nodes": [n1, n2], "edges": [e1_updated], "viewport": {}}, headers=headers)

    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    edge = canvas["edges"][0]
    assert edge["label"] == "updated"
    assert edge["custom_color"] == "#ff0000"
