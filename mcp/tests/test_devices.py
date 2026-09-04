import pytest
from unittest.mock import AsyncMock, patch

from app.devices import DEVICE_TOOLS, dispatch_device


@pytest.fixture
def mock_backend():
    with patch("app.devices.backend") as m:
        m.post = AsyncMock(return_value={"id": "d1"})
        m.patch = AsyncMock(return_value={"id": "d1"})
        m.delete = AsyncMock(return_value={"deleted": True})
        m.get = AsyncMock(return_value=[])
        yield m


@pytest.mark.anyio
async def test_create_device(mock_backend):
    args = {"hostname": "sw-core", "suggested_type": "switch", "ip": "192.168.1.2"}
    result = await dispatch_device("create_device", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/scan/pending", args)
    assert result == {"id": "d1"}


@pytest.mark.anyio
async def test_create_device_from_a_rack(mock_backend):
    await dispatch_device(
        "create_device", {"hostname": "patch-a", "discovery_source": "rack"}
    )
    _, body = mock_backend.post.call_args[0]
    assert body["discovery_source"] == "rack"


@pytest.mark.anyio
async def test_update_device_sends_everything_but_the_id(mock_backend):
    await dispatch_device("update_device", {"id": "d1", "notes": "in the garage", "ram_gb": 64})
    mock_backend.patch.assert_called_once_with(
        "/api/v1/scan/pending/d1", {"notes": "in the garage", "ram_gb": 64}
    )


@pytest.mark.anyio
async def test_update_device_carries_the_rack_model(mock_backend):
    """The faceplate belongs to the inventory row, so it is edited here too."""
    await dispatch_device("update_device", {
        "id": "d1", "rack_faceplate_id": "switch-48", "rack_u_height": 1, "rack_col_span": 12,
    })
    _, body = mock_backend.patch.call_args[0]
    assert body["rack_faceplate_id"] == "switch-48"


@pytest.mark.anyio
async def test_delete_device(mock_backend):
    await dispatch_device("delete_device", {"id": "d1"})
    mock_backend.delete.assert_called_once_with("/api/v1/scan/pending/d1")


@pytest.mark.anyio
async def test_bulk_approve_devices(mock_backend):
    await dispatch_device(
        "bulk_approve_devices", {"device_ids": ["a", "b"], "design_id": "canvas-1"}
    )
    mock_backend.post.assert_called_once_with(
        "/api/v1/scan/pending/bulk-approve", {"device_ids": ["a", "b"], "design_id": "canvas-1"}
    )


@pytest.mark.anyio
async def test_bulk_approve_devices_without_a_design(mock_backend):
    """No design_id means the backend's default (first) canvas — sending a null
    would not be the same thing."""
    await dispatch_device("bulk_approve_devices", {"device_ids": ["a"]})
    _, body = mock_backend.post.call_args[0]
    assert body == {"device_ids": ["a"]}


@pytest.mark.anyio
async def test_bulk_hide_devices(mock_backend):
    await dispatch_device("bulk_hide_devices", {"device_ids": ["a", "b"]})
    mock_backend.post.assert_called_once_with(
        "/api/v1/scan/pending/bulk-hide", {"device_ids": ["a", "b"]}
    )


@pytest.mark.anyio
async def test_bulk_restore_devices(mock_backend):
    await dispatch_device("bulk_restore_devices", {"device_ids": ["a"]})
    mock_backend.post.assert_called_once_with(
        "/api/v1/scan/pending/bulk-restore", {"device_ids": ["a"]}
    )


@pytest.mark.anyio
async def test_rescan_device(mock_backend):
    await dispatch_device("rescan_device", {"id": "d1", "ports": "80,443", "verify_tls": True})
    mock_backend.post.assert_called_once_with(
        "/api/v1/scan/pending/d1/rescan", {"ports": "80,443", "verify_tls": True}
    )


@pytest.mark.anyio
async def test_list_proxmox_children(mock_backend):
    await dispatch_device("list_proxmox_children", {"id": "pve1"})
    mock_backend.get.assert_called_once_with("/api/v1/scan/pending/pve1/proxmox-children")


@pytest.mark.anyio
async def test_get_scan_config(mock_backend):
    await dispatch_device("get_scan_config", {})
    mock_backend.get.assert_called_once_with("/api/v1/scan/config")


@pytest.mark.anyio
async def test_update_scan_config(mock_backend):
    args = {"ranges": ["192.168.1.0/24"], "http_probe_enabled": True}
    await dispatch_device("update_scan_config", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/scan/config", args)


@pytest.mark.anyio
async def test_unknown_device_tool(mock_backend):
    with pytest.raises(ValueError, match="Unknown device tool"):
        await dispatch_device("frobnicate_device", {})


def test_create_device_only_offers_the_manual_sources():
    """`rack` and `manual` are the only sources the backend accepts by hand —
    a device may not claim to have been discovered by a scan."""
    create = next(t for t in DEVICE_TOOLS if t.name == "create_device")
    assert create.inputSchema["properties"]["discovery_source"]["enum"] == ["manual", "rack"]


@pytest.mark.anyio
async def test_device_tools_are_reachable_from_the_main_dispatch(mock_backend):
    from app.tools import _dispatch

    await _dispatch("delete_device", {"id": "d1"})
    mock_backend.delete.assert_called_once_with("/api/v1/scan/pending/d1")
