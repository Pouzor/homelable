from httpx import AsyncClient


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


async def test_create_node_without_design_id_falls_back_to_first_design(client: AsyncClient, headers: dict):
    # Regression for #225: MCP create_node sent no design_id, so nodes were
    # persisted with design_id=null and never rendered on the canvas until a
    # container restart reconciled them. They must attach to a design on create.
    design = await client.post("/api/v1/designs", json={"name": "Primary"}, headers=headers)
    design_id = design.json()["id"]

    res = await client.post(
        "/api/v1/nodes",
        json={"type": "generic", "label": "mcp-node", "ip": "192.168.18.99"},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["design_id"] == design_id


async def test_create_node_respects_explicit_design_id(client: AsyncClient, headers: dict):
    # When a design_id is supplied it must win over the first-design fallback.
    first = await client.post("/api/v1/designs", json={"name": "First"}, headers=headers)
    second = await client.post("/api/v1/designs", json={"name": "Second"}, headers=headers)
    second_id = second.json()["id"]
    assert first.json()["id"] != second_id

    res = await client.post(
        "/api/v1/nodes",
        json={"type": "generic", "label": "n", "design_id": second_id},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["design_id"] == second_id


async def test_create_node_rejects_duplicate_ip_on_same_design(client: AsyncClient, headers: dict):
    # A second node with the same ip on the same design is a silent duplicate —
    # scripts/MCP clients get 409 with the existing node id instead. (#260)
    design = await client.post("/api/v1/designs", json={"name": "D"}, headers=headers)
    design_id = design.json()["id"]
    first = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "srv", "ip": "192.168.1.5", "design_id": design_id},
        headers=headers,
    )
    assert first.status_code == 201
    existing_id = first.json()["id"]

    dup = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "srv-again", "ip": "192.168.1.5", "design_id": design_id},
        headers=headers,
    )
    assert dup.status_code == 409
    detail = dup.json()["detail"]
    assert detail["duplicate"] is True
    assert detail["existing_node_id"] == existing_id
    assert detail["match"] == "ip"


async def test_create_node_force_bypasses_duplicate_guard(client: AsyncClient, headers: dict):
    design = await client.post("/api/v1/designs", json={"name": "D"}, headers=headers)
    design_id = design.json()["id"]
    await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "srv", "ip": "192.168.1.5", "design_id": design_id},
        headers=headers,
    )
    forced = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "srv", "ip": "192.168.1.5", "design_id": design_id, "force": True},
        headers=headers,
    )
    assert forced.status_code == 201


async def test_create_node_without_any_design_stays_null(client: AsyncClient, headers: dict):
    # No designs exist yet: fallback can't invent one, so design_id stays null
    # rather than erroring.
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "generic", "label": "orphan"},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["design_id"] is None


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
