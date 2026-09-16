import pytest
from unittest.mock import AsyncMock, patch

from app.documents import DOC_TOOL_NAMES, DOC_TOOLS, dispatch_document


@pytest.fixture
def mock_backend():
    with patch("app.documents.backend") as m:
        m.get = AsyncMock(return_value={})
        m.post = AsyncMock(return_value={"id": "doc-1"})
        m.patch = AsyncMock(return_value={"id": "doc-1"})
        m.delete = AsyncMock(return_value={})
        yield m


def _path(mock) -> str:
    return mock.get.call_args[0][0]


# ── search / list ───────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_search_sends_the_query(mock_backend):
    mock_backend.get.return_value = {"engine": "fts5", "hits": []}
    result = await dispatch_document("search_documentation", {"q": "nas backup"})
    assert _path(mock_backend) == "/api/v1/documents/search?q=nas+backup"
    assert result == {"engine": "fts5", "hits": []}


@pytest.mark.anyio
async def test_search_carries_the_limit(mock_backend):
    await dispatch_document("search_documentation", {"q": "vlan", "limit": 5})
    assert _path(mock_backend) == "/api/v1/documents/search?q=vlan&limit=5"


@pytest.mark.anyio
async def test_list_without_a_filter_asks_for_everything(mock_backend):
    await dispatch_document("list_documentation", {})
    assert _path(mock_backend) == "/api/v1/documents"


@pytest.mark.anyio
async def test_list_forwards_only_the_filters_the_backend_knows(mock_backend):
    await dispatch_document(
        "list_documentation", {"kind": "page", "device_id": "d1", "limit": 10}
    )
    assert _path(mock_backend) == "/api/v1/documents?kind=page&device_id=d1"


# ── read ────────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_read_document(mock_backend):
    await dispatch_document("read_document", {"id": "doc-1"})
    assert _path(mock_backend) == "/api/v1/documents/doc-1"


@pytest.mark.anyio
async def test_list_revisions(mock_backend):
    await dispatch_document("list_document_revisions", {"document_id": "doc-1"})
    assert _path(mock_backend) == "/api/v1/documents/doc-1/revisions"


@pytest.mark.anyio
async def test_read_revision_is_addressed_by_revision_id_alone(mock_backend):
    """The revision route hangs off /documents/revisions, not off the document."""
    await dispatch_document("read_document_revision", {"revision_id": "rev-1"})
    assert _path(mock_backend) == "/api/v1/documents/revisions/rev-1"


@pytest.mark.anyio
async def test_backlinks(mock_backend):
    await dispatch_document("document_backlinks", {"document_id": "doc-1"})
    assert _path(mock_backend) == "/api/v1/documents/doc-1/backlinks"


# ── write ───────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_create_document_forwards_the_arguments(mock_backend):
    args = {"title": "VLAN plan", "kind": "page", "body": "# VLANs", "template_id": "network"}
    result = await dispatch_document("create_document", dict(args))
    mock_backend.post.assert_called_once_with("/api/v1/documents", args)
    assert result == {"id": "doc-1"}


@pytest.mark.anyio
async def test_update_document_sends_everything_but_the_id(mock_backend):
    await dispatch_document("update_document", {"id": "doc-1", "body": "new", "starred": True})
    path, body = mock_backend.patch.call_args[0]
    assert path == "/api/v1/documents/doc-1"
    assert body["body"] == "new"
    assert body["starred"] is True
    assert "id" not in body


@pytest.mark.anyio
async def test_an_edit_is_recorded_as_an_ai_edit(mock_backend):
    await dispatch_document("update_document", {"id": "doc-1", "body": "new"})
    _, body = mock_backend.patch.call_args[0]
    assert body["revision_reason"] == "mcp"


@pytest.mark.anyio
async def test_a_client_cannot_sign_its_edit_as_a_human(mock_backend):
    """The history has to be able to say an AI wrote this, whatever was asked."""
    await dispatch_document(
        "update_document", {"id": "doc-1", "body": "new", "revision_reason": "edit"}
    )
    _, body = mock_backend.patch.call_args[0]
    assert body["revision_reason"] == "mcp"


@pytest.mark.anyio
async def test_restore_posts_to_the_document_that_owns_the_revision(mock_backend):
    await dispatch_document(
        "restore_document_revision", {"document_id": "doc-1", "revision_id": "rev-1"}
    )
    mock_backend.post.assert_called_once_with(
        "/api/v1/documents/doc-1/revisions/rev-1/restore", {}
    )


@pytest.mark.anyio
async def test_there_is_no_delete_tool():
    """Destroying documentation stays a human action."""
    assert not [name for name in DOC_TOOL_NAMES if "delete" in name]


# ── wiring ──────────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_an_unknown_tool_is_refused():
    with pytest.raises(ValueError, match="Unknown documentation tool"):
        await dispatch_document("delete_everything", {})


def test_every_advertised_tool_dispatches():
    """A tool the server lists but cannot route is a dead entry in the client."""
    import inspect

    from app import documents

    source = inspect.getsource(documents.dispatch_document)
    for name in DOC_TOOL_NAMES:
        assert f'"{name}"' in source


def test_tool_names_are_unique():
    assert len({tool.name for tool in DOC_TOOLS}) == len(DOC_TOOLS)
