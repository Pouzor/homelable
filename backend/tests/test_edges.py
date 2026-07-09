import pytest
from httpx import AsyncClient


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


async def test_delete_edge_not_found(client: AsyncClient, headers: dict):
    res = await client.delete("/api/v1/edges/nonexistent", headers=headers)
    assert res.status_code == 404


async def test_update_edge(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    edge_id = (await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)).json()["id"]
    res = await client.patch(f"/api/v1/edges/{edge_id}", json={"type": "wifi", "label": "uplink"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["type"] == "wifi"
    assert res.json()["label"] == "uplink"


async def test_update_edge_not_found(client: AsyncClient, headers: dict):
    res = await client.patch("/api/v1/edges/nonexistent", json={"type": "wifi"}, headers=headers)
    assert res.status_code == 404


async def test_create_edge_with_custom_color(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet", "custom_color": "#a855f7"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["custom_color"] == "#a855f7"


async def test_create_edge_with_path_style(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet", "path_style": "smooth"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["path_style"] == "smooth"


async def test_update_edge_custom_color_and_path_style(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    edge_id = (await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)).json()["id"]
    res = await client.patch(f"/api/v1/edges/{edge_id}", json={"custom_color": "#39d353", "path_style": "smooth"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["custom_color"] == "#39d353"
    assert res.json()["path_style"] == "smooth"


async def test_create_edge_with_line_style_and_width(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "wifi", "line_style": "dotted", "width_mult": 3}, headers=headers)
    assert res.status_code == 201
    assert res.json()["line_style"] == "dotted"
    assert res.json()["width_mult"] == 3


async def test_update_edge_line_style_and_width(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    edge_id = (await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)).json()["id"]
    res = await client.patch(f"/api/v1/edges/{edge_id}", json={"line_style": "dashed", "width_mult": 2}, headers=headers)
    assert res.status_code == 200
    assert res.json()["line_style"] == "dashed"
    assert res.json()["width_mult"] == 2


async def test_create_edge_defaults_line_style_none(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["line_style"] is None
    assert res.json()["width_mult"] is None


async def test_create_edge_with_marker_shapes(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet", "marker_start": "diamond", "marker_end": "arrow"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["marker_start"] == "diamond"
    assert res.json()["marker_end"] == "arrow"


async def test_create_edge_defaults_markers_none(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["marker_start"] == "none"
    assert res.json()["marker_end"] == "none"


async def test_create_edge_coerces_legacy_boolean_marker(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet", "marker_end": True}, headers=headers)
    assert res.status_code == 201
    assert res.json()["marker_end"] == "arrow"


async def test_create_edge_rejects_unknown_marker_shape(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet", "marker_end": "bogus"}, headers=headers)
    assert res.status_code == 201
    assert res.json()["marker_end"] == "none"


async def test_update_edge_marker_shape(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    edge_id = (await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers)).json()["id"]
    res = await client.patch(f"/api/v1/edges/{edge_id}", json={"marker_end": "circle"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["marker_end"] == "circle"
    assert res.json()["marker_start"] == "none"


async def test_create_edge_requires_auth(client: AsyncClient, two_nodes):
    src, tgt = two_nodes
    res = await client.post("/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"})
    assert res.status_code == 401


async def test_create_edge_without_design_id_falls_back_to_first_design(client: AsyncClient, headers: dict, two_nodes):
    # Regression for #225: MCP create_edge sent no design_id, so edges were
    # persisted with design_id=null and never rendered until a restart.
    src, tgt = two_nodes
    design = await client.post("/api/v1/designs", json={"name": "Primary"}, headers=headers)
    design_id = design.json()["id"]

    res = await client.post(
        "/api/v1/edges",
        json={"source": src, "target": tgt, "type": "ethernet"},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["design_id"] == design_id


async def test_create_edge_respects_explicit_design_id(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    await client.post("/api/v1/designs", json={"name": "First"}, headers=headers)
    second = await client.post("/api/v1/designs", json={"name": "Second"}, headers=headers)
    second_id = second.json()["id"]

    res = await client.post(
        "/api/v1/edges",
        json={"source": src, "target": tgt, "type": "ethernet", "design_id": second_id},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["design_id"] == second_id


async def test_create_cluster_edge_with_handles(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    res = await client.post(
        "/api/v1/edges",
        json={
            "source": src,
            "target": tgt,
            "type": "cluster",
            "source_handle": "cluster-right",
            "target_handle": "cluster-left",
        },
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["type"] == "cluster"
    assert data["source_handle"] == "cluster-right"
    assert data["target_handle"] == "cluster-left"


async def test_source_and_target_handle_persist_through_update(client: AsyncClient, headers: dict, two_nodes):
    src, tgt = two_nodes
    edge_id = (
        await client.post(
            "/api/v1/edges",
            json={"source": src, "target": tgt, "type": "cluster", "source_handle": "cluster-right", "target_handle": "cluster-left"},
            headers=headers,
        )
    ).json()["id"]
    res = await client.patch(f"/api/v1/edges/{edge_id}", json={"label": "corosync"}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["source_handle"] == "cluster-right"
    assert data["target_handle"] == "cluster-left"
    assert data["label"] == "corosync"


# ---------------------------------------------------------------------------
# Auto edge handles (issue #265): omitting source_handle/target_handle lets
# the backend infer up/downstream sides from the nodes' absolute canvas Y.
# ---------------------------------------------------------------------------


@pytest.fixture
async def stacked_nodes(client: AsyncClient, headers: dict):
    """Two root nodes at known, distinct Y positions (top at y=0, bottom at y=300)."""
    top = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "router", "label": "Top", "status": "online", "pos_x": 0, "pos_y": 0},
            headers=headers,
        )
    ).json()
    bottom = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "switch", "label": "Bottom", "status": "online", "pos_x": 0, "pos_y": 300},
            headers=headers,
        )
    ).json()
    return top["id"], bottom["id"]


async def test_create_edge_auto_handles_source_above_target(client: AsyncClient, headers: dict, stacked_nodes):
    """Source above target -> downstream flow: exit bottom, enter top-t."""
    top, bottom = stacked_nodes
    res = await client.post(
        "/api/v1/edges", json={"source": top, "target": bottom, "type": "ethernet"}, headers=headers
    )
    assert res.status_code == 201
    data = res.json()
    assert data["source_handle"] == "bottom"
    assert data["target_handle"] == "top-t"


async def test_create_edge_auto_handles_source_below_target(client: AsyncClient, headers: dict, stacked_nodes):
    """Source below target -> upstream flow: exit top, enter bottom-t."""
    top, bottom = stacked_nodes
    res = await client.post(
        "/api/v1/edges", json={"source": bottom, "target": top, "type": "ethernet"}, headers=headers
    )
    assert res.status_code == 201
    data = res.json()
    assert data["source_handle"] == "top"
    assert data["target_handle"] == "bottom-t"


async def test_create_edge_auto_handles_equal_y_defaults_downstream(client: AsyncClient, headers: dict, two_nodes):
    """Same Y (auto-placed side by side) falls back to the default bottom/top-t."""
    src, tgt = two_nodes
    res = await client.post(
        "/api/v1/edges", json={"source": src, "target": tgt, "type": "ethernet"}, headers=headers
    )
    assert res.status_code == 201
    data = res.json()
    assert data["source_handle"] == "bottom"
    assert data["target_handle"] == "top-t"


async def test_create_edge_partial_handle_auto_fills_the_other(client: AsyncClient, headers: dict, stacked_nodes):
    """An explicit source_handle is kept; the omitted target_handle is inferred."""
    top, bottom = stacked_nodes
    res = await client.post(
        "/api/v1/edges",
        json={"source": top, "target": bottom, "type": "ethernet", "source_handle": "cluster-right"},
        headers=headers,
    )
    assert res.status_code == 201
    data = res.json()
    assert data["source_handle"] == "cluster-right"
    assert data["target_handle"] == "top-t"


async def test_create_edge_child_node_abs_y_resolved_through_parent(client: AsyncClient, headers: dict):
    """A child's absolute Y = parent Y + its own pos_y, so a VM low inside a high
    container still resolves as downstream of a node above the container."""
    parent = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "proxmox", "label": "PVE", "status": "online", "container_mode": True, "pos_x": 0, "pos_y": 0},
            headers=headers,
        )
    ).json()
    child = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "vm", "label": "VM", "status": "online", "parent_id": parent["id"], "pos_x": 0, "pos_y": 50},
            headers=headers,
        )
    ).json()
    below = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "server", "label": "Below", "status": "online", "pos_x": 0, "pos_y": 500},
            headers=headers,
        )
    ).json()
    # child abs Y = 0 + 50 = 50, below at 500 -> child is upstream.
    res = await client.post(
        "/api/v1/edges", json={"source": child["id"], "target": below["id"], "type": "virtual"}, headers=headers
    )
    assert res.status_code == 201
    data = res.json()
    assert data["source_handle"] == "bottom"
    assert data["target_handle"] == "top-t"
