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


# ---------------------------------------------------------------------------
# Auto-positioning (issue #265): omitting pos_x/pos_y snaps the node to the
# first free 200x100 grid slot instead of stacking everything at (0, 0).
# ---------------------------------------------------------------------------


async def test_create_node_auto_positions_first_at_origin(client: AsyncClient, headers: dict):
    """First root node with no coordinates lands at (0, 0)."""
    res = await client.post(
        "/api/v1/nodes", json={"type": "server", "label": "A", "status": "unknown"}, headers=headers
    )
    assert res.status_code == 201
    data = res.json()
    assert (data["pos_x"], data["pos_y"]) == (0.0, 0.0)


async def test_create_node_auto_position_avoids_collision(client: AsyncClient, headers: dict):
    """A second auto-placed root node takes the next free grid cell, not (0, 0)."""
    first = await client.post(
        "/api/v1/nodes", json={"type": "server", "label": "A", "status": "unknown"}, headers=headers
    )
    assert (first.json()["pos_x"], first.json()["pos_y"]) == (0.0, 0.0)

    second = await client.post(
        "/api/v1/nodes", json={"type": "server", "label": "B", "status": "unknown"}, headers=headers
    )
    assert second.status_code == 201
    # Next free cell in row 0 is column 1 -> x = 1 * 200.
    assert (second.json()["pos_x"], second.json()["pos_y"]) == (200.0, 0.0)


async def test_create_node_child_defaults_to_parent_origin(client: AsyncClient, headers: dict):
    """A child node (parent_id set) with no coordinates defaults to (0, 0) relative to its parent."""
    parent = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "proxmox", "label": "PVE", "status": "online", "container_mode": True},
            headers=headers,
        )
    ).json()
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "vm", "label": "VM1", "status": "online", "parent_id": parent["id"]},
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert (data["pos_x"], data["pos_y"]) == (0.0, 0.0)


async def test_create_node_explicit_position_preserved(client: AsyncClient, headers: dict):
    """Explicit coordinates are honored, never auto-placed."""
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "A", "status": "unknown", "pos_x": 512.0, "pos_y": 384.0},
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert (data["pos_x"], data["pos_y"]) == (512.0, 384.0)


async def test_create_node_explicit_zero_position_preserved(client: AsyncClient, headers: dict):
    """pos=0 is an explicit value, not 'omitted' — auto-position must not treat 0 as None."""
    await client.post(
        "/api/v1/nodes", json={"type": "server", "label": "A", "status": "unknown"}, headers=headers
    )
    # Second node explicitly pinned to (0, 0) even though the cell is taken.
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "server", "label": "B", "status": "unknown", "pos_x": 0, "pos_y": 0},
        headers=headers,
    )
    assert res.status_code == 201
    assert (res.json()["pos_x"], res.json()["pos_y"]) == (0.0, 0.0)


async def test_list_nodes_filters_by_label_exact(client: AsyncClient, headers: dict):
    await client.post("/api/v1/nodes", json={"type": "server", "label": "Proxmox", "status": "unknown"}, headers=headers)
    await client.post("/api/v1/nodes", json={"type": "router", "label": "Router", "status": "unknown"}, headers=headers)
    res = await client.get("/api/v1/nodes?label=Proxmox", headers=headers)
    assert res.status_code == 200
    assert [n["label"] for n in res.json()] == ["Proxmox"]


async def test_list_nodes_filters_by_label_substring(client: AsyncClient, headers: dict):
    await client.post("/api/v1/nodes", json={"type": "server", "label": "pve1-node", "status": "unknown"}, headers=headers)
    await client.post("/api/v1/nodes", json={"type": "server", "label": "pve2-node", "status": "unknown"}, headers=headers)
    await client.post("/api/v1/nodes", json={"type": "router", "label": "Router", "status": "unknown"}, headers=headers)
    res = await client.get("/api/v1/nodes?label=pve", headers=headers)
    assert res.status_code == 200
    assert sorted(n["label"] for n in res.json()) == ["pve1-node", "pve2-node"]


async def test_list_nodes_filters_by_label_case_insensitive(client: AsyncClient, headers: dict):
    await client.post("/api/v1/nodes", json={"type": "server", "label": "Proxmox", "status": "unknown"}, headers=headers)
    res = await client.get("/api/v1/nodes?label=PROXMOX", headers=headers)
    assert res.status_code == 200
    assert [n["label"] for n in res.json()] == ["Proxmox"]


async def test_list_nodes_filters_by_label_no_match(client: AsyncClient, headers: dict):
    await client.post("/api/v1/nodes", json={"type": "server", "label": "Proxmox", "status": "unknown"}, headers=headers)
    res = await client.get("/api/v1/nodes?label=nonexistent", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


async def test_list_nodes_without_label_param_returns_all(client: AsyncClient, headers: dict):
    """Omitting label is fully backward compatible with the old unfiltered behavior."""
    for label in ("A", "B", "C"):
        await client.post("/api/v1/nodes", json={"type": "generic", "label": label, "status": "unknown"}, headers=headers)
    res = await client.get("/api/v1/nodes", headers=headers)
    assert res.status_code == 200
    assert len(res.json()) == 3


# ── self-parent guard (#370) ─────────────────────────────────────────────────

async def test_update_node_ignores_a_parent_id_pointing_at_itself(client: AsyncClient, headers: dict):
    create = await client.post(
        "/api/v1/nodes", json={"type": "lxc", "label": "pihole", "status": "unknown"}, headers=headers
    )
    node_id = create.json()["id"]

    res = await client.patch(
        f"/api/v1/nodes/{node_id}", json={"parent_id": node_id, "label": "renamed"}, headers=headers
    )

    assert res.status_code == 200
    assert res.json()["parent_id"] is None
    # The key is dropped, not the whole edit.
    assert res.json()["label"] == "renamed"


async def test_update_node_self_parent_leaves_a_real_parent_alone(client: AsyncClient, headers: dict):
    host = await client.post(
        "/api/v1/nodes",
        json={"type": "proxmox", "label": "pve", "status": "unknown", "container_mode": True},
        headers=headers,
    )
    host_id = host.json()["id"]
    child = await client.post(
        "/api/v1/nodes",
        json={"type": "lxc", "label": "pihole", "status": "unknown", "parent_id": host_id},
        headers=headers,
    )
    child_id = child.json()["id"]

    res = await client.patch(f"/api/v1/nodes/{child_id}", json={"parent_id": child_id}, headers=headers)

    assert res.status_code == 200
    assert res.json()["parent_id"] == host_id


# ── text-parent guard (#446) ─────────────────────────────────────────────────

async def test_update_node_refuses_a_text_annotation_as_parent(client: AsyncClient, headers: dict):
    annotation = await client.post(
        "/api/v1/nodes", json={"type": "text", "label": "\u26a0 maintenance zone"}, headers=headers
    )
    node = await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)

    res = await client.patch(
        f"/api/v1/nodes/{node.json()['id']}",
        json={"parent_id": annotation.json()["id"], "label": "renamed"},
        headers=headers,
    )

    assert res.status_code == 400
    assert "text annotation" in res.json()["detail"]
    # Rejected whole: unlike the self-parent slip, the rest of the edit does not land.
    read = await client.get(f"/api/v1/nodes/{node.json()['id']}", headers=headers)
    assert read.json()["parent_id"] is None
    assert read.json()["label"] == "nas1"


async def test_update_node_still_accepts_a_group_as_parent(client: AsyncClient, headers: dict):
    group = await client.post("/api/v1/nodes", json={"type": "groupRect", "label": "Garage"}, headers=headers)
    node = await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)

    res = await client.patch(
        f"/api/v1/nodes/{node.json()['id']}", json={"parent_id": group.json()["id"]}, headers=headers
    )

    assert res.status_code == 200
    assert res.json()["parent_id"] == group.json()["id"]


# ── furniture descriptions ───────────────────────────────────────────────────

async def test_create_and_update_a_group_description(client: AsyncClient, headers: dict):
    create = await client.post(
        "/api/v1/nodes",
        json={"type": "group", "label": "Cluster", "description": "The three Proxmox boxes."},
        headers=headers,
    )
    assert create.status_code == 201
    assert create.json()["description"] == "The three Proxmox boxes."
    node_id = create.json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"description": "Now four."}, headers=headers)
    assert res.status_code == 200
    assert res.json()["description"] == "Now four."
    assert (await client.get(f"/api/v1/nodes/{node_id}", headers=headers)).json()["description"] == "Now four."


async def test_update_a_zone_description_leaves_the_label_alone(client: AsyncClient, headers: dict):
    create = await client.post("/api/v1/nodes", json={"type": "groupRect", "label": "Garage"}, headers=headers)
    node_id = create.json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"description": "Behind the door."}, headers=headers)
    assert res.json()["label"] == "Garage"
    assert res.json()["description"] == "Behind the door."


async def test_a_device_node_never_keeps_a_description(client: AsyncClient, headers: dict):
    # `description` is furniture-only: a node that draws a device writes what it
    # is for to the inventory row, as `notes`.
    create = await client.post(
        "/api/v1/nodes",
        json={"type": "nas", "label": "nas-01", "ip": "192.168.1.20", "description": "Not here."},
        headers=headers,
    )
    assert create.json()["description"] is None

    res = await client.patch(
        f"/api/v1/nodes/{create.json()['id']}",
        json={"description": "Still not here.", "notes": "Backs up nightly."},
        headers=headers,
    )
    assert res.json()["description"] is None
    assert res.json()["notes"] == "Backs up nightly."


# ---------------------------------------------------------------------------
# Connection points (#435)
# ---------------------------------------------------------------------------
# Handle counts became writable over the MCP, which reaches these fields without
# the canvas UI's own bounds and edge bookkeeping. Both now live server-side.


async def test_handle_count_is_clamped_on_create(client: AsyncClient, headers: dict):
    # The renderer clamps to 0..64 anyway (handleUtils.clampHandles), so an
    # unclamped row would draw a different node than it stores.
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "switch", "label": "sw1", "bottom_handles": 5000, "left_handles": -3},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["bottom_handles"] == 64
    assert res.json()["left_handles"] == 0


async def test_handle_count_is_clamped_on_update(client: AsyncClient, headers: dict):
    node_id = (
        await client.post("/api/v1/nodes", json={"type": "switch", "label": "sw1"}, headers=headers)
    ).json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"right_handles": 999}, headers=headers)

    assert res.status_code == 200
    assert res.json()["right_handles"] == 64


async def test_a_handle_count_of_zero_is_honoured(client: AsyncClient, headers: dict):
    # 0 is a real value, not a missing one: a side can have no connection point.
    node_id = (
        await client.post("/api/v1/nodes", json={"type": "switch", "label": "sw1"}, headers=headers)
    ).json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"top_handles": 0}, headers=headers)

    assert res.json()["top_handles"] == 0


async def _edge_by_id(client: AsyncClient, headers: dict, edge_id: str) -> dict:
    edges = (await client.get("/api/v1/edges", headers=headers)).json()
    return next(e for e in edges if e["id"] == edge_id)


async def test_shrinking_a_side_moves_its_edges_to_slot_zero(client: AsyncClient, headers: dict):
    # Regression: React Flow silently drops an edge whose handle no longer
    # exists, so the link vanishes from the canvas with no error.
    src = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw1", "bottom_handles": 4}, headers=headers
        )
    ).json()["id"]
    tgt = (await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)).json()["id"]
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": src, "target": tgt, "source_handle": "bottom-4", "target_handle": "top"},
            headers=headers,
        )
    ).json()["id"]

    await client.patch(f"/api/v1/nodes/{src}", json={"bottom_handles": 2}, headers=headers)

    edge = await _edge_by_id(client, headers, edge_id)
    assert edge["source_handle"] == "bottom"
    assert edge["target_handle"] == "top"


async def test_shrinking_a_side_leaves_the_surviving_handles_alone(client: AsyncClient, headers: dict):
    src = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw1", "bottom_handles": 4}, headers=headers
        )
    ).json()["id"]
    tgt = (await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)).json()["id"]
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": src, "target": tgt, "source_handle": "bottom-2", "target_handle": "top"},
            headers=headers,
        )
    ).json()["id"]

    await client.patch(f"/api/v1/nodes/{src}", json={"bottom_handles": 2}, headers=headers)

    assert (await _edge_by_id(client, headers, edge_id))["source_handle"] == "bottom-2"


async def test_a_side_dropped_to_zero_falls_back_to_bottom(client: AsyncClient, headers: dict):
    # Slot 0 goes away with the side, so there is nothing on it to fall back to.
    src = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw1", "right_handles": 2}, headers=headers
        )
    ).json()["id"]
    tgt = (await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)).json()["id"]
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": src, "target": tgt, "source_handle": "right-2", "target_handle": "top"},
            headers=headers,
        )
    ).json()["id"]

    await client.patch(f"/api/v1/nodes/{src}", json={"right_handles": 0}, headers=headers)

    assert (await _edge_by_id(client, headers, edge_id))["source_handle"] == "bottom"


async def test_the_target_end_is_remapped_too(client: AsyncClient, headers: dict):
    src = (await client.post("/api/v1/nodes", json={"type": "router", "label": "r1"}, headers=headers)).json()["id"]
    tgt = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw1", "top_handles": 3}, headers=headers
        )
    ).json()["id"]
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": src, "target": tgt, "source_handle": "bottom", "target_handle": "top-3"},
            headers=headers,
        )
    ).json()["id"]

    await client.patch(f"/api/v1/nodes/{tgt}", json={"top_handles": 1}, headers=headers)

    edge = await _edge_by_id(client, headers, edge_id)
    assert edge["target_handle"] == "top"
    assert edge["source_handle"] == "bottom"


async def test_growing_a_side_touches_no_edge(client: AsyncClient, headers: dict):
    src = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw1", "bottom_handles": 2}, headers=headers
        )
    ).json()["id"]
    tgt = (await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)).json()["id"]
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": src, "target": tgt, "source_handle": "bottom-2", "target_handle": "top"},
            headers=headers,
        )
    ).json()["id"]

    await client.patch(f"/api/v1/nodes/{src}", json={"bottom_handles": 8}, headers=headers)

    assert (await _edge_by_id(client, headers, edge_id))["source_handle"] == "bottom-2"


async def test_another_nodes_edges_are_not_remapped(client: AsyncClient, headers: dict):
    # The shrink is scoped to the node being edited; an unrelated link that
    # happens to sit on the same handle ID must survive untouched.
    shrunk = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw1", "bottom_handles": 4}, headers=headers
        )
    ).json()["id"]
    other = (
        await client.post(
            "/api/v1/nodes", json={"type": "switch", "label": "sw2", "bottom_handles": 4}, headers=headers
        )
    ).json()["id"]
    tgt = (await client.post("/api/v1/nodes", json={"type": "nas", "label": "nas1"}, headers=headers)).json()["id"]
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": other, "target": tgt, "source_handle": "bottom-4", "target_handle": "top"},
            headers=headers,
        )
    ).json()["id"]

    await client.patch(f"/api/v1/nodes/{shrunk}", json={"bottom_handles": 1}, headers=headers)

    assert (await _edge_by_id(client, headers, edge_id))["source_handle"] == "bottom-4"
