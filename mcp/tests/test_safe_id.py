"""Identifiers from an AI client never leave their own path segment.

Tool arguments are model output, so a prompt-injected id such as
``../designs/x`` or ``x?design_id=y`` used to be spliced into the backend URL
as is and reach a different route than the tool names.
"""

from unittest.mock import AsyncMock, patch

import pytest
from app.backend_client import safe_id
from app.devices import dispatch_device
from app.documents import dispatch_document
from app.racks import dispatch_rack
from app.resources import read_resource
from app.tools import _dispatch

HOSTILE_IDS = ["../designs/x", "a/b", "x?design_id=y", "x#frag", "%2e%2e", "a b", "", "é"]


@pytest.mark.parametrize("value", ["1", "42", "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", "pve-node_1"])
def test_safe_id_accepts_backend_ids(value):
    assert safe_id(value) == value


@pytest.mark.parametrize("value", HOSTILE_IDS + [None, 42])
def test_safe_id_rejects_anything_else(value):
    with pytest.raises(ValueError, match="Invalid node id"):
        safe_id(value, field="node id")  # type: ignore[arg-type]


def _backend(module: str):
    mock = patch(f"app.{module}.backend")
    m = mock.start()
    for verb in ("get", "post", "patch", "delete"):
        setattr(m, verb, AsyncMock(return_value={}))
    return mock, m


@pytest.fixture
def backends():
    patches = {name: _backend(name) for name in ("tools", "devices", "documents", "racks", "resources")}
    yield {name: m for name, (_, m) in patches.items()}
    for p, _ in patches.values():
        p.stop()


def _no_backend_call(m) -> bool:
    return not any(getattr(m, verb).called for verb in ("get", "post", "patch", "delete"))


@pytest.mark.anyio
@pytest.mark.parametrize("bad", HOSTILE_IDS)
@pytest.mark.parametrize("tool,args", [
    ("update_node", lambda v: {"id": v, "label": "x"}),
    ("delete_node", lambda v: {"id": v}),
    ("get_node", lambda v: {"id": v}),
    ("update_edge", lambda v: {"id": v}),
    ("delete_edge", lambda v: {"id": v}),
    ("approve_device", lambda v: {"id": v}),
    ("hide_device", lambda v: {"id": v}),
    ("get_canvas", lambda v: {"design_id": v}),
])
async def test_tools_refuse_hostile_ids(backends, tool, args, bad):
    if tool in ("get_canvas", "get_node") and bad == "":
        pytest.skip("an empty optional id means 'not given', not a path segment")
    with pytest.raises(ValueError, match="Invalid"):
        await _dispatch(tool, args(bad))
    assert _no_backend_call(backends["tools"])


@pytest.mark.anyio
@pytest.mark.parametrize("tool", ["update_device", "delete_device", "rescan_device", "list_proxmox_children"])
async def test_device_tools_refuse_hostile_ids(backends, tool):
    with pytest.raises(ValueError, match="Invalid device id"):
        await dispatch_device(tool, {"id": "../../nodes/1"})
    assert _no_backend_call(backends["devices"])


@pytest.mark.anyio
@pytest.mark.parametrize("tool,args", [
    ("read_document", {"id": "../x"}),
    ("list_document_revisions", {"document_id": "../x"}),
    ("read_document_revision", {"revision_id": "../x"}),
    ("document_backlinks", {"document_id": "../x"}),
    ("restore_document_revision", {"document_id": "d1", "revision_id": "../x"}),
])
async def test_document_tools_refuse_hostile_ids(backends, tool, args):
    with pytest.raises(ValueError, match="Invalid"):
        await dispatch_document(tool, args)
    assert _no_backend_call(backends["documents"])


@pytest.mark.anyio
async def test_rack_tools_refuse_hostile_design_id(backends):
    with pytest.raises(ValueError, match="Invalid design id"):
        await dispatch_rack("list_rack_inventory", {"design_id": "x&design_id=y"})
    assert _no_backend_call(backends["racks"])


@pytest.mark.anyio
@pytest.mark.parametrize("uri", ["homelable://nodes/x%2F..", "homelable://documents/x?y=1"])
async def test_resources_refuse_hostile_ids(backends, uri):
    with pytest.raises(ValueError, match="Invalid"):
        await read_resource(uri)
    assert _no_backend_call(backends["resources"])


@pytest.mark.anyio
async def test_update_node_validates_once_and_keeps_the_path(backends):
    await _dispatch("update_node", {"id": "n-1", "label": "x"})
    backends["tools"].patch.assert_called_once_with("/api/v1/nodes/n-1", {"label": "x"})
