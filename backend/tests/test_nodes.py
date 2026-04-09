import pytest
from httpx import AsyncClient


@pytest.fixture
async def headers(client: AsyncClient):
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


async def test_update_node_not_found(client: AsyncClient, headers: dict):
    res = await client.patch("/api/v1/nodes/nonexistent", json={"label": "X"}, headers=headers)
    assert res.status_code == 404


async def test_delete_node_not_found(client: AsyncClient, headers: dict):
    res = await client.delete("/api/v1/nodes/nonexistent", headers=headers)
    assert res.status_code == 404


async def test_create_node_with_custom_colors(client: AsyncClient, headers: dict):
    payload = {"type": "server", "label": "Styled", "status": "unknown", "custom_colors": {"border": "#ff0000", "background": "#001122", "icon": "#ffffff"}}
    res = await client.post("/api/v1/nodes", json=payload, headers=headers)
    assert res.status_code == 201
    assert res.json()["custom_colors"] == {"border": "#ff0000", "background": "#001122", "icon": "#ffffff"}


async def test_update_node_custom_colors(client: AsyncClient, headers: dict):
    create = await client.post("/api/v1/nodes", json={"type": "server", "label": "N", "status": "unknown"}, headers=headers)
    node_id = create.json()["id"]
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"custom_colors": {"border": "#a855f7"}}, headers=headers)
    assert res.status_code == 200
    assert res.json()["custom_colors"] == {"border": "#a855f7"}


async def test_create_proxmox_node_with_container_mode(client: AsyncClient, headers: dict):
    payload = {"type": "proxmox", "label": "PVE", "status": "unknown", "container_mode": True}
    res = await client.post("/api/v1/nodes", json=payload, headers=headers)
    assert res.status_code == 201
    assert res.json()["container_mode"] is True


async def test_update_node_container_mode(client: AsyncClient, headers: dict):
    create = await client.post("/api/v1/nodes", json={"type": "proxmox", "label": "PVE", "status": "unknown"}, headers=headers)
    node_id = create.json()["id"]
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"container_mode": True}, headers=headers)
    assert res.status_code == 200
    assert res.json()["container_mode"] is True


async def test_update_node_parent_id(client: AsyncClient, headers: dict):
    parent = await client.post("/api/v1/nodes", json={"type": "proxmox", "label": "PVE", "status": "unknown"}, headers=headers)
    parent_id = parent.json()["id"]
    child = await client.post("/api/v1/nodes", json={"type": "lxc", "label": "Child", "status": "unknown"}, headers=headers)
    child_id = child.json()["id"]
    res = await client.patch(f"/api/v1/nodes/{child_id}", json={"parent_id": parent_id}, headers=headers)
    assert res.status_code == 200
    assert res.json()["parent_id"] == parent_id


async def test_create_node_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/nodes", json={"type": "server", "label": "N", "status": "unknown"})
    assert res.status_code == 401


# --- Properties tests ---

async def test_create_node_default_properties_empty(client: AsyncClient, headers: dict):
    """New node has an empty properties list by default."""
    res = await client.post("/api/v1/nodes", json={"type": "server", "label": "Srv", "status": "unknown"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["properties"] == []


async def test_create_node_with_properties(client: AsyncClient, headers: dict):
    """Node created with properties round-trips correctly."""
    props = [
        {"key": "CPU Model", "value": "i7-12700K", "icon": "Cpu", "visible": True},
        {"key": "RAM", "value": "32 GB", "icon": "MemoryStick", "visible": False},
    ]
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "Srv", "status": "unknown", "properties": props},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["properties"] == props


async def test_patch_node_properties(client: AsyncClient, headers: dict):
    """PATCH with properties replaces the full properties array."""
    create = await client.post("/api/v1/nodes", json={"type": "server", "label": "Srv", "status": "unknown"}, headers=headers)
    node_id = create.json()["id"]

    props = [{"key": "Disk", "value": "2 TB", "icon": "HardDrive", "visible": True}]
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"properties": props}, headers=headers)
    assert res.status_code == 200
    assert res.json()["properties"] == props


async def test_patch_node_without_properties_does_not_wipe(client: AsyncClient, headers: dict):
    """PATCH that omits properties leaves existing properties untouched."""
    props = [{"key": "GPU", "value": "RTX 4090", "icon": "Monitor", "visible": True}]
    create = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "Srv", "status": "unknown", "properties": props},
        headers=headers,
    )
    node_id = create.json()["id"]

    # PATCH only the label — properties must survive
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"label": "Updated"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["properties"] == props
    assert res.json()["label"] == "Updated"


async def test_patch_node_clears_properties_with_empty_array(client: AsyncClient, headers: dict):
    """PATCH with properties=[] explicitly clears all properties."""
    props = [{"key": "CPU Model", "value": "i5", "icon": "Cpu", "visible": True}]
    create = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "Srv", "status": "unknown", "properties": props},
        headers=headers,
    )
    node_id = create.json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"properties": []}, headers=headers)
    assert res.status_code == 200
    assert res.json()["properties"] == []


async def test_get_node_returns_properties(client: AsyncClient, headers: dict):
    """GET /nodes/:id returns the properties field."""
    props = [{"key": "OS", "value": "Debian 12", "icon": "Server", "visible": True}]
    create = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "Srv", "status": "unknown", "properties": props},
        headers=headers,
    )
    node_id = create.json()["id"]

    res = await client.get(f"/api/v1/nodes/{node_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["properties"] == props


async def test_properties_icon_can_be_null(client: AsyncClient, headers: dict):
    """A property with icon=null is valid and round-trips correctly."""
    props = [{"key": "Notes", "value": "custom value", "icon": None, "visible": False}]
    create = await client.post(
        "/api/v1/nodes",
        json={"type": "generic", "label": "G", "status": "unknown", "properties": props},
        headers=headers,
    )
    assert create.status_code == 201
    assert create.json()["properties"] == props
