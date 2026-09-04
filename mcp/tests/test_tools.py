import pytest
from unittest.mock import AsyncMock, patch
from app.tools import TOOLS, _dispatch


@pytest.fixture
def mock_backend():
    with patch("app.tools.backend") as m:
        m.post = AsyncMock(return_value={"id": "1"})
        m.patch = AsyncMock(return_value={"id": "1"})
        m.delete = AsyncMock(return_value={})
        m.get = AsyncMock(return_value=[])
        yield m


@pytest.mark.anyio
async def test_create_node(mock_backend):
    result = await _dispatch("create_node", {"type": "server", "label": "Proxmox"})
    mock_backend.post.assert_called_once_with("/api/v1/nodes", {"type": "server", "label": "Proxmox"})
    assert result == {"id": "1"}


@pytest.mark.anyio
async def test_update_node(mock_backend):
    await _dispatch("update_node", {"id": "42", "label": "New name"})
    mock_backend.patch.assert_called_once_with("/api/v1/nodes/42", {"label": "New name"})


@pytest.mark.anyio
async def test_update_node_parent_id(mock_backend):
    await _dispatch("update_node", {"id": "42", "parent_id": "proxmox-1"})
    mock_backend.patch.assert_called_once_with("/api/v1/nodes/42", {"parent_id": "proxmox-1"})


@pytest.mark.anyio
async def test_create_node_full_properties(mock_backend):
    args = {
        "type": "proxmox",
        "label": "pve1",
        "os": "Proxmox VE 8",
        "notes": "Main hypervisor",
        "services": [{"name": "ssh", "port": 22}],
        "cpu_count": 16,
        "cpu_model": "Ryzen 9 5950X",
        "ram_gb": 64,
        "disk_gb": 2000,
        "show_hardware": True,
        "properties": [{"name": "rack", "value": "A1"}],
    }
    await _dispatch("create_node", dict(args))
    # All extra fields forwarded to the backend unchanged.
    mock_backend.post.assert_called_once_with("/api/v1/nodes", args)


@pytest.mark.anyio
async def test_update_node_properties(mock_backend):
    await _dispatch("update_node", {
        "id": "42",
        "os": "Debian 12",
        "properties": [{"name": "role", "value": "db"}],
    })
    mock_backend.patch.assert_called_once_with("/api/v1/nodes/42", {
        "os": "Debian 12",
        "properties": [{"name": "role", "value": "db"}],
    })


@pytest.mark.anyio
@pytest.mark.parametrize("node_type", ["firewall", "docker_container", "ups", "camera", "zigbee_router"])
async def test_create_node_accepts_previously_rejected_types(mock_backend, node_type):
    # These types were missing from the old, stale NODE_TYPES enum and were
    # rejected by the MCP schema even though the backend always accepted them.
    args = {"type": node_type, "label": "Device"}
    await _dispatch("create_node", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/nodes", args)


@pytest.mark.anyio
async def test_delete_node(mock_backend):
    await _dispatch("delete_node", {"id": "42"})
    mock_backend.delete.assert_called_once_with("/api/v1/nodes/42")


@pytest.mark.anyio
async def test_create_edge(mock_backend):
    await _dispatch("create_edge", {"source": "1", "target": "2", "type": "ethernet"})
    mock_backend.post.assert_called_once_with("/api/v1/edges", {"source": "1", "target": "2", "type": "ethernet"})


@pytest.mark.anyio
@pytest.mark.parametrize("edge_type", ["cluster", "fibre", "electrical"])
async def test_create_edge_accepts_previously_rejected_types(mock_backend, edge_type):
    # These types were missing from the old, stale edge type enum and were
    # rejected by the MCP schema even though the backend always accepted them.
    args = {"source": "1", "target": "2", "type": edge_type}
    await _dispatch("create_edge", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/edges", args)


@pytest.mark.anyio
async def test_create_node_with_design_id(mock_backend):
    # design_id is forwarded to the backend, which attaches the node to that canvas.
    args = {"type": "server", "label": "Proxmox", "design_id": "design-2"}
    await _dispatch("create_node", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/nodes", args)


@pytest.mark.anyio
async def test_create_edge_with_design_id(mock_backend):
    args = {"source": "1", "target": "2", "type": "ethernet", "design_id": "design-2"}
    await _dispatch("create_edge", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/edges", args)


@pytest.mark.anyio
async def test_delete_edge(mock_backend):
    await _dispatch("delete_edge", {"id": "99"})
    mock_backend.delete.assert_called_once_with("/api/v1/edges/99")


@pytest.mark.anyio
async def test_trigger_scan_no_ranges(mock_backend):
    await _dispatch("trigger_scan", {})
    mock_backend.post.assert_called_once_with("/api/v1/scan/trigger", {})


@pytest.mark.anyio
async def test_trigger_scan_with_ranges(mock_backend):
    await _dispatch("trigger_scan", {"ranges": ["192.168.1.0/24"]})
    mock_backend.post.assert_called_once_with("/api/v1/scan/trigger", {"ranges": ["192.168.1.0/24"]})


@pytest.mark.anyio
async def test_approve_device(mock_backend):
    await _dispatch("approve_device", {"id": "5", "type": "server", "label": "MyServer"})
    mock_backend.post.assert_called_once_with("/api/v1/scan/pending/5/approve", {"type": "server", "label": "MyServer"})


@pytest.mark.anyio
async def test_hide_device(mock_backend):
    await _dispatch("hide_device", {"id": "5"})
    mock_backend.post.assert_called_once_with("/api/v1/scan/pending/5/hide", {})


@pytest.mark.anyio
async def test_get_canvas(mock_backend):
    mock_backend.get = AsyncMock(return_value={
        "nodes": [
            {
                "id": "n1",
                "type": "router",
                "position": {"x": 100, "y": 200},
                "width": 160,
                "height": 80,
                "data": {"label": "Freebox", "ip": "192.168.1.1", "status": "online"},
            }
        ],
        "edges": [
            {"id": "e1", "source": "n1", "target": "n2", "type": "ethernet", "animated": True, "style": {"stroke": "#fff"}},
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    })
    result = await _dispatch("get_canvas", {})
    mock_backend.get.assert_called_once_with("/api/v1/canvas")
    # Layout/style fields stripped, only semantic data kept
    assert result["nodes"] == [{"id": "n1", "node_type": "router", "label": "Freebox", "ip": "192.168.1.1", "status": "online"}]
    assert result["edges"] == [{"id": "e1", "source": "n1", "target": "n2", "type": "ethernet"}]
    assert "viewport" not in result


@pytest.mark.anyio
async def test_get_canvas_keeps_documentation_fields(mock_backend):
    mock_backend.get = AsyncMock(return_value={
        "nodes": [
            {
                "id": "n1",
                "type": "proxmox",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "pve1",
                    "os": "Proxmox VE 8",
                    "notes": "Main hypervisor",
                    "cpu_count": 16,
                    "ram_gb": 64,
                    "properties": [{"name": "rack", "value": "A1"}],
                },
            }
        ],
        "edges": [],
    })
    result = await _dispatch("get_canvas", {})
    node = result["nodes"][0]
    assert node["os"] == "Proxmox VE 8"
    assert node["notes"] == "Main hypervisor"
    assert node["cpu_count"] == 16
    assert node["ram_gb"] == 64
    assert node["properties"] == [{"name": "rack", "value": "A1"}]


# A node as `GET /api/v1/canvas` actually reports it: `NodeResponse`, flat, with
# the device facts beside `id` and `type` rather than under a React Flow `data`
# key. Copied from a real response — the backend pins this shape in
# `backend/tests/test_inventory_sync.py::
# TestRoutesKeepTheLinkInStep::test_the_wire_shape_the_mcp_server_reads_is_unchanged`.
_API_CANVAS_NODE = {
    "id": "n1",
    "type": "proxmox",
    "label": "pve1",
    "design_id": "d-1",
    "device_id": "dev-1",
    "ip": "192.168.1.10",
    "hostname": "pve1.lan",
    "mac": "aa:bb:cc:dd:ee:ff",
    "os": "Proxmox VE 8",
    "status": "online",
    "notes": "Main hypervisor",
    "services": [{"port": 8006, "protocol": "tcp", "service_name": "proxmox"}],
    "properties": [{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
    "cpu_count": 16,
    "cpu_model": "Xeon E5",
    "ram_gb": 64.0,
    "disk_gb": 4000.0,
    "show_hardware": True,
    "check_method": "https",
    "check_target": "https://192.168.1.10:8006",
    "parent_id": None,
    "pos_x": 120.0,
    "pos_y": 240.0,
    "width": 160.0,
    "height": 80.0,
    "container_mode": False,
    "custom_colors": None,
    "custom_icon": None,
    "show_port_numbers": False,
    "bottom_handles": 1,
    "top_handles": 1,
    "left_handles": 0,
    "right_handles": 0,
    "ieee_address": None,
    "last_seen": "2026-08-14T10:00:00Z",
    "last_scan": None,
    "response_time_ms": 12,
    "created_at": "2026-08-01T10:00:00Z",
    "updated_at": "2026-08-14T10:00:00Z",
}


@pytest.mark.anyio
async def test_get_canvas_keeps_the_facts_of_a_flat_api_node(mock_backend):
    """The API reports a node flat; slimming must not drop everything but the id."""
    mock_backend.get = AsyncMock(return_value={"nodes": [_API_CANVAS_NODE], "edges": []})

    node = (await _dispatch("get_canvas", {}))["nodes"][0]

    assert node == {
        "id": "n1",
        "node_type": "proxmox",
        "label": "pve1",
        "ip": "192.168.1.10",
        "hostname": "pve1.lan",
        "mac": "aa:bb:cc:dd:ee:ff",
        "os": "Proxmox VE 8",
        "status": "online",
        "notes": "Main hypervisor",
        "services": [{"port": 8006, "protocol": "tcp", "service_name": "proxmox"}],
        "properties": [{"key": "Rack", "value": "A1", "icon": None, "visible": True}],
        "cpu_count": 16,
        "cpu_model": "Xeon E5",
        "ram_gb": 64.0,
        "disk_gb": 4000.0,
    }


@pytest.mark.anyio
async def test_get_canvas_drops_the_layout_fields_of_a_flat_api_node(mock_backend):
    mock_backend.get = AsyncMock(return_value={"nodes": [_API_CANVAS_NODE], "edges": []})

    node = (await _dispatch("get_canvas", {}))["nodes"][0]

    for dropped in (
        "pos_x", "pos_y", "width", "height", "custom_colors", "custom_icon",
        "bottom_handles", "top_handles", "left_handles", "right_handles",
        "created_at", "updated_at", "design_id", "device_id", "type",
    ):
        assert dropped not in node


@pytest.mark.anyio
async def test_get_canvas_reports_nesting_from_either_shape(mock_backend):
    mock_backend.get = AsyncMock(
        return_value={
            "nodes": [
                {**_API_CANVAS_NODE, "id": "child", "parent_id": "n1"},
                {"id": "rf-child", "type": "vm", "parentId": "n1", "data": {"label": "vm1"}},
            ],
            "edges": [],
        }
    )

    nodes = (await _dispatch("get_canvas", {}))["nodes"]

    assert nodes[0]["parent_id"] == "n1"
    assert nodes[1]["parent_id"] == "n1"
    assert nodes[1]["label"] == "vm1"


@pytest.mark.anyio
async def test_get_canvas_with_design_id(mock_backend):
    mock_backend.get = AsyncMock(return_value={"nodes": [], "edges": []})
    await _dispatch("get_canvas", {"design_id": "design-2"})
    mock_backend.get.assert_called_once_with("/api/v1/canvas?design_id=design-2")


@pytest.mark.anyio
async def test_get_canvas_without_design_id_uses_default(mock_backend):
    # Backward compatible: no design_id -> unqualified canvas endpoint (first design).
    mock_backend.get = AsyncMock(return_value={"nodes": [], "edges": []})
    await _dispatch("get_canvas", {})
    mock_backend.get.assert_called_once_with("/api/v1/canvas")


def _tool_schema(name: str) -> dict:
    tool = next(t for t in TOOLS if t.name == name)
    return tool.inputSchema["properties"]


def test_create_node_schema_exposes_full_node_fields():
    props = _tool_schema("create_node")
    for field in ("os", "notes", "services", "cpu_count", "ram_gb", "disk_gb", "properties", "mac"):
        assert field in props, f"create_node schema missing {field}"
    # type stays an enum of the canonical node types
    assert "enum" in props["type"]


@pytest.mark.parametrize("tool_name", ["create_node", "update_node", "approve_device"])
def test_node_type_enum_excludes_canvas_annotations(tool_name):
    # group/groupRect/text are canvas annotations created via dedicated UI actions
    # (grouping a selection, "Add Zone", "Add Text") — not real devices, so they
    # must never be creatable/settable through the device-oriented node tools.
    type_enum = set(_tool_schema(tool_name)["type"]["enum"])
    assert type_enum.isdisjoint({"group", "groupRect", "text"})
    assert "firewall" in type_enum


def test_create_edge_schema_exposes_full_edge_type_enum():
    props = _tool_schema("create_edge")
    type_enum = set(props["type"]["enum"])
    assert {"cluster", "fibre", "electrical"} <= type_enum
    assert props["type"]["default"] == "ethernet"


def test_update_node_schema_exposes_full_node_fields():
    props = _tool_schema("update_node")
    for field in ("os", "notes", "services", "cpu_count", "ram_gb", "disk_gb", "properties", "mac"):
        assert field in props, f"update_node schema missing {field}"
    assert "id" in props


def test_design_id_exposed_on_canvas_targeting_tools():
    # create_node/create_edge/get_canvas can target a specific canvas.
    assert "design_id" in _tool_schema("create_node")
    assert "design_id" in _tool_schema("create_edge")
    assert "design_id" in _tool_schema("get_canvas")


def test_update_node_schema_has_no_design_id():
    # The backend NodeUpdate schema can't move a node between designs, so the
    # update_node tool must not advertise design_id.
    assert "design_id" not in _tool_schema("update_node")


@pytest.mark.anyio
async def test_list_nodes(mock_backend):
    mock_backend.get = AsyncMock(return_value=[{"id": "1", "label": "Freebox"}])
    result = await _dispatch("list_nodes", {})
    mock_backend.get.assert_called_once_with("/api/v1/nodes")
    assert result == [{"id": "1", "label": "Freebox"}]


@pytest.mark.anyio
async def test_list_node_summaries(mock_backend):
    mock_backend.get = AsyncMock(return_value=[
        {
            "id": "1", "label": "Freebox", "type": "router", "status": "online",
            "ip": "192.168.1.1", "notes": "ISP box", "properties": [{"name": "rack", "value": "A1"}],
        },
    ])
    result = await _dispatch("list_node_summaries", {})
    mock_backend.get.assert_called_once_with("/api/v1/nodes")
    assert result == [{"id": "1", "label": "Freebox", "type": "router", "status": "online"}]


@pytest.mark.anyio
async def test_get_node_by_id(mock_backend):
    mock_backend.get = AsyncMock(return_value={"id": "42", "label": "pve1", "type": "proxmox"})
    result = await _dispatch("get_node", {"id": "42"})
    mock_backend.get.assert_called_once_with("/api/v1/nodes/42")
    assert result == {"id": "42", "label": "pve1", "type": "proxmox"}


@pytest.mark.anyio
async def test_get_node_by_label(mock_backend):
    mock_backend.get = AsyncMock(return_value=[{"id": "1", "label": "pve1"}, {"id": "2", "label": "pve2"}])
    result = await _dispatch("get_node", {"label": "pve"})
    mock_backend.get.assert_called_once_with("/api/v1/nodes?label=pve")
    assert result == [{"id": "1", "label": "pve1"}, {"id": "2", "label": "pve2"}]


@pytest.mark.anyio
async def test_get_node_by_label_url_encodes(mock_backend):
    mock_backend.get = AsyncMock(return_value=[])
    await _dispatch("get_node", {"label": "living room ap"})
    mock_backend.get.assert_called_once_with("/api/v1/nodes?label=living%20room%20ap")


@pytest.mark.anyio
async def test_get_node_id_takes_precedence_over_label(mock_backend):
    mock_backend.get = AsyncMock(return_value={"id": "42"})
    await _dispatch("get_node", {"id": "42", "label": "pve"})
    mock_backend.get.assert_called_once_with("/api/v1/nodes/42")


@pytest.mark.anyio
async def test_get_node_requires_id_or_label():
    with pytest.raises(ValueError, match="requires either"):
        await _dispatch("get_node", {})


@pytest.mark.anyio
async def test_list_pending_devices(mock_backend):
    mock_backend.get = AsyncMock(return_value=[{"id": "p1", "ip": "192.168.1.50"}])
    result = await _dispatch("list_pending_devices", {})
    mock_backend.get.assert_called_once_with("/api/v1/scan/pending")
    assert result == [{"id": "p1", "ip": "192.168.1.50"}]


@pytest.mark.anyio
async def test_list_designs(mock_backend):
    mock_backend.get = AsyncMock(return_value=[{"id": "d1", "name": "Network Topology", "node_count": 12}])
    result = await _dispatch("list_designs", {})
    mock_backend.get.assert_called_once_with("/api/v1/designs")
    assert result == [{"id": "d1", "name": "Network Topology", "node_count": 12}]


@pytest.mark.anyio
async def test_create_design(mock_backend):
    mock_backend.post = AsyncMock(return_value={"id": "d2", "name": "Scan Devices"})
    result = await _dispatch("create_design", {"name": "Scan Devices"})
    mock_backend.post.assert_called_once_with("/api/v1/designs", {"name": "Scan Devices"})
    assert result == {"id": "d2", "name": "Scan Devices"}


def test_create_design_schema_requires_name():
    tool = next(t for t in TOOLS if t.name == "create_design")
    assert tool.inputSchema["required"] == ["name"]


@pytest.mark.anyio
async def test_delete_design(mock_backend):
    await _dispatch("delete_design", {"design_id": "d-old"})
    mock_backend.delete.assert_called_once_with("/api/v1/designs/d-old")


def test_delete_design_schema_requires_design_id():
    tool = next(t for t in TOOLS if t.name == "delete_design")
    assert tool.inputSchema["required"] == ["design_id"]
    assert "design_id" in tool.inputSchema["properties"]


@pytest.mark.anyio
async def test_unknown_tool():
    with pytest.raises(ValueError, match="Unknown tool"):
        await _dispatch("nonexistent", {})


@pytest.mark.anyio
async def test_list_pending_devices_filters_non_pending(mock_backend):
    """The tool promises devices *not yet approved or hidden*; the backend
    endpoint returns the whole inventory including approved rows (they carry
    the canvas-presence badge). The tool must filter to status == "pending"
    and keep legacy rows that lack the field."""
    mock_backend.get = AsyncMock(return_value=[
        {"id": "p1", "ip": "192.168.1.50", "status": "pending"},
        {"id": "a1", "ip": "192.168.1.60", "status": "approved"},
        {"id": "h1", "ip": "192.168.1.70", "status": "hidden"},
        {"id": "legacy", "ip": "192.168.1.80"},
    ])
    result = await _dispatch("list_pending_devices", {})
    assert [d["id"] for d in result] == ["p1", "legacy"]


_INVENTORY = [
    {"id": "p1", "ip": "192.168.1.50", "status": "pending"},
    {"id": "a1", "ip": "192.168.1.60", "status": "approved"},
    {"id": "legacy", "ip": "192.168.1.80"},
]


@pytest.mark.anyio
async def test_list_inventory_default_returns_all(mock_backend):
    """No status filter returns the whole non-hidden inventory verbatim."""
    mock_backend.get = AsyncMock(return_value=list(_INVENTORY))
    result = await _dispatch("list_inventory", {})
    mock_backend.get.assert_called_once_with("/api/v1/scan/pending")
    assert [d["id"] for d in result] == ["p1", "a1", "legacy"]


@pytest.mark.anyio
async def test_list_inventory_filters_approved(mock_backend):
    mock_backend.get = AsyncMock(return_value=list(_INVENTORY))
    result = await _dispatch("list_inventory", {"status": "approved"})
    assert [d["id"] for d in result] == ["a1"]


@pytest.mark.anyio
async def test_list_inventory_pending_keeps_legacy(mock_backend):
    """Legacy rows without a status field count as pending."""
    mock_backend.get = AsyncMock(return_value=list(_INVENTORY))
    result = await _dispatch("list_inventory", {"status": "pending"})
    assert [d["id"] for d in result] == ["p1", "legacy"]


@pytest.mark.anyio
async def test_list_hidden_devices(mock_backend):
    await _dispatch("list_hidden_devices", {})
    mock_backend.get.assert_called_once_with("/api/v1/scan/hidden")


@pytest.mark.anyio
async def test_restore_device(mock_backend):
    await _dispatch("restore_device", {"id": "5"})
    mock_backend.post.assert_called_once_with("/api/v1/scan/pending/5/restore", {})


# ── Zones (#365) ─────────────────────────────────────────────────────────────

_ZONE_NODES = [
    {"id": "z1", "type": "groupRect", "label": "DMZ", "design_id": "d1", "pos_x": 100, "pos_y": 100, "width": 400, "height": 300},
    {"id": "n1", "type": "router", "label": "Router", "design_id": "d1", "pos_x": 160, "pos_y": 220},
    {"id": "n2", "type": "server", "label": "NAS", "design_id": "d1", "pos_x": 200, "pos_y": 260, "parent_id": "z1"},
    {"id": "z2", "type": "groupRect", "label": "Lab", "design_id": "d2", "pos_x": 0, "pos_y": 0, "width": 200, "height": 200},
    {"id": "other", "type": "server", "label": "Other canvas", "design_id": "d2", "pos_x": 10, "pos_y": 10},
]


@pytest.mark.anyio
async def test_create_zone_posts_a_grouprect_node(mock_backend):
    await _dispatch("create_zone", {"label": "DMZ", "pos_x": 10, "pos_y": 20})
    mock_backend.post.assert_called_once_with("/api/v1/nodes", {
        "type": "groupRect", "status": "unknown", "width": 360, "height": 240,
        "label": "DMZ", "pos_x": 10, "pos_y": 20,
    })


@pytest.mark.anyio
async def test_create_zone_folds_colors_into_custom_colors(mock_backend):
    await _dispatch("create_zone", {"label": "VLAN 10", "border": "#39d353", "border_style": "dashed", "width": 500})
    body = mock_backend.post.call_args[0][1]
    assert body["custom_colors"] == {"border": "#39d353", "border_style": "dashed"}
    assert body["width"] == 500
    assert "border" not in body


def test_create_zone_schema_requires_label():
    tool = next(t for t in TOOLS if t.name == "create_zone")
    assert tool.inputSchema["required"] == ["label"]


def test_zone_type_is_not_offered_by_create_node():
    """A zone is canvas furniture — create_node stays a device tool."""
    tool = next(t for t in TOOLS if t.name == "create_node")
    assert "groupRect" not in tool.inputSchema["properties"]["type"]["enum"]


@pytest.mark.anyio
async def test_list_zones_returns_only_zones_with_their_children(mock_backend):
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    result = await _dispatch("list_zones", {})
    assert result == [
        {
            "id": "z1", "label": "DMZ", "design_id": "d1", "pos_x": 100, "pos_y": 100,
            "width": 400, "height": 300, "node_ids": ["n2"],
        },
        {
            "id": "z2", "label": "Lab", "design_id": "d2", "pos_x": 0, "pos_y": 0,
            "width": 200, "height": 200, "node_ids": [],
        },
    ]


@pytest.mark.anyio
async def test_list_zones_narrows_to_one_design(mock_backend):
    """/api/v1/nodes has no design filter, so the tool applies it."""
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    result = await _dispatch("list_zones", {"design_id": "d2"})
    assert [z["id"] for z in result] == ["z2"]


@pytest.mark.anyio
async def test_add_to_zone_skips_a_node_from_another_design(mock_backend):
    """A zone groups its own canvas; parenting across designs would hide the
    node on the design it belongs to."""
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    result = await _dispatch("add_to_zone", {"zone_id": "z1", "node_ids": ["other", "n1"]})
    assert result["moved"] == ["n1"]
    assert result["skipped"] == ["other"]
    assert mock_backend.patch.call_count == 1


@pytest.mark.anyio
async def test_add_to_zone_rebases_positions_on_the_zone(mock_backend):
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    result = await _dispatch("add_to_zone", {"zone_id": "z1", "node_ids": ["n1"]})
    mock_backend.patch.assert_called_once_with(
        "/api/v1/nodes/n1", {"parent_id": "z1", "pos_x": 60, "pos_y": 120}
    )
    assert result == {"zone_id": "z1", "moved": ["n1"], "skipped": []}


@pytest.mark.anyio
async def test_add_to_zone_skips_the_zone_itself_and_nodes_already_in_it(mock_backend):
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    result = await _dispatch("add_to_zone", {"zone_id": "z1", "node_ids": ["z1", "n2", "ghost"]})
    mock_backend.patch.assert_not_called()
    assert result["moved"] == []
    assert result["skipped"] == ["z1", "n2", "ghost"]


@pytest.mark.anyio
async def test_add_to_zone_refuses_a_node_the_zone_descends_from(mock_backend):
    """Parenting a zone's own ancestor under it would build a cycle."""
    mock_backend.get = AsyncMock(return_value=[
        {"id": "outer", "type": "groupRect", "pos_x": 0, "pos_y": 0},
        {"id": "z1", "type": "groupRect", "pos_x": 100, "pos_y": 100, "parent_id": "outer"},
    ])
    result = await _dispatch("add_to_zone", {"zone_id": "z1", "node_ids": ["outer"]})
    mock_backend.patch.assert_not_called()
    assert result["skipped"] == ["outer"]


@pytest.mark.anyio
async def test_add_to_zone_rejects_a_target_that_is_not_a_zone(mock_backend):
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    with pytest.raises(ValueError, match="is not a zone"):
        await _dispatch("add_to_zone", {"zone_id": "n1", "node_ids": ["n2"]})


@pytest.mark.anyio
async def test_remove_from_zone_restores_absolute_positions(mock_backend):
    mock_backend.get = AsyncMock(return_value=list(_ZONE_NODES))
    result = await _dispatch("remove_from_zone", {"node_ids": ["n2", "n1"]})
    mock_backend.patch.assert_called_once_with(
        "/api/v1/nodes/n2", {"parent_id": None, "pos_x": 300, "pos_y": 360}
    )
    # n1 has no parent — nothing to detach.
    assert result == {"detached": ["n2"], "skipped": ["n1"]}


def test_zone_tools_are_registered():
    names = {t.name for t in TOOLS}
    assert {"create_zone", "list_zones", "add_to_zone", "remove_from_zone"} <= names


def _property_item_schema(tool_name: str) -> dict:
    tool = next(t for t in TOOLS if t.name == tool_name)
    return tool.inputSchema["properties"]["properties"]["items"]


def test_node_properties_are_keyed_on_key_not_name():
    """The backend keys a property on `key` (merge_properties / apply_view in
    backend/app/services/inventory_sync.py). The schema advertised `name`, so an
    AI client sent keyless properties: they all collapsed onto the empty key and
    a node given three of them drew one.
    """
    for tool_name in ("create_node", "update_node"):
        item = _property_item_schema(tool_name)
        assert item["required"] == ["key", "value"], (
            f"{tool_name} must require key/value — `name` is not a property field"
        )
        assert "name" not in item["properties"], f"{tool_name} still advertises `name`"
        assert {"key", "value", "icon", "visible"} == set(item["properties"])


def test_update_node_documents_that_status_is_observed_not_set():
    """`status` on an update is dropped unless the device's status is unknown —
    the inventory row keeps the freshest observation, not the last writer. Left
    undocumented, the tool silently no-ops."""
    tool = next(t for t in TOOLS if t.name == "update_node")
    description = tool.inputSchema["properties"]["status"]["description"]
    assert "status checker" in description and "unknown" in description
