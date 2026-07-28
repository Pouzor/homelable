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
async def test_delete_node(mock_backend):
    await _dispatch("delete_node", {"id": "42"})
    mock_backend.delete.assert_called_once_with("/api/v1/nodes/42")


@pytest.mark.anyio
async def test_create_edge(mock_backend):
    await _dispatch("create_edge", {"source": "1", "target": "2", "type": "ethernet"})
    mock_backend.post.assert_called_once_with("/api/v1/edges", {"source": "1", "target": "2", "type": "ethernet"})


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
