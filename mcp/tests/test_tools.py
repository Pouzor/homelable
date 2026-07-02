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


@pytest.mark.anyio
async def test_list_nodes(mock_backend):
    mock_backend.get = AsyncMock(return_value=[{"id": "1", "label": "Freebox"}])
    result = await _dispatch("list_nodes", {})
    mock_backend.get.assert_called_once_with("/api/v1/nodes")
    assert result == [{"id": "1", "label": "Freebox"}]


@pytest.mark.anyio
async def test_list_pending_devices(mock_backend):
    mock_backend.get = AsyncMock(return_value=[{"id": "p1", "ip": "192.168.1.50"}])
    result = await _dispatch("list_pending_devices", {})
    mock_backend.get.assert_called_once_with("/api/v1/scan/pending")
    assert result == [{"id": "p1", "ip": "192.168.1.50"}]


@pytest.mark.anyio
async def test_unknown_tool():
    with pytest.raises(ValueError, match="Unknown tool"):
        await _dispatch("nonexistent", {})
