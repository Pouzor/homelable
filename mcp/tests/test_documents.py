import pytest
from unittest.mock import AsyncMock, patch

from app.documents import DOCUMENT_TOOLS, dispatch_document


@pytest.fixture
def mock_backend():
    with patch("app.documents.backend") as m:
        m.get = AsyncMock(return_value=[])
        m.post = AsyncMock(return_value={})
        yield m


# A document as `GET /api/v1/documents` reports it: `DocumentSummary`, which
# carries the version but never a body.
_DOC = {
    "id": "doc-1",
    "kind": "device",
    "title": "NAS",
    "slug": "nas",
    "device_id": "dev-1",
    "node_id": None,
    "design_id": None,
    "parent_id": None,
    "template_id": "device",
    "tags": ["storage"],
    "starred": False,
    "version": 3,
    "created_at": "2026-09-01T10:00:00Z",
    "updated_at": "2026-09-05T12:00:00Z",
    "body": "<never listed>",
}


# ── list_documents ────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_list_documents(mock_backend):
    mock_backend.get = AsyncMock(return_value=[dict(_DOC)])
    result = await dispatch_document("list_documents", {})
    mock_backend.get.assert_called_once_with("/api/v1/documents")
    assert result == [{
        "id": "doc-1", "kind": "device", "title": "NAS", "slug": "nas",
        "version": 3, "device_id": "dev-1", "node_id": None, "design_id": None,
        "parent_id": None, "template_id": "device", "tags": ["storage"],
        "starred": False, "created_at": "2026-09-01T10:00:00Z",
        "updated_at": "2026-09-05T12:00:00Z",
    }]


@pytest.mark.anyio
async def test_list_documents_strips_the_body(mock_backend):
    """The tool promises listings never carry bodies — the first step of the
    two-step read flow (`list_documents`, then `read_document`)."""
    mock_backend.get = AsyncMock(return_value=[dict(_DOC)])
    result = await dispatch_document("list_documents", {})
    assert "body" not in result[0]


@pytest.mark.anyio
async def test_list_documents_filters_by_kind(mock_backend):
    mock_backend.get = AsyncMock(return_value=[
        {"id": "d1", "kind": "device", "title": "NAS", "slug": "nas", "tags": [], "created_at": "", "updated_at": ""},
        {"id": "d2", "kind": "page", "title": "Runbook", "slug": "runbook", "tags": [], "created_at": "", "updated_at": ""},
    ])
    result = await dispatch_document("list_documents", {"kind": "page"})
    assert [d["id"] for d in result] == ["d2"]


@pytest.mark.anyio
async def test_list_documents_filters_by_device_id(mock_backend):
    mock_backend.get = AsyncMock(return_value=[
        {"id": "d1", "kind": "device", "title": "NAS", "slug": "nas", "device_id": "dev-1", "tags": [], "created_at": "", "updated_at": ""},
        {"id": "d2", "kind": "device", "title": "Router", "slug": "router", "device_id": "dev-2", "tags": [], "created_at": "", "updated_at": ""},
    ])
    result = await dispatch_document("list_documents", {"device_id": "dev-2"})
    assert [d["id"] for d in result] == ["d2"]


@pytest.mark.anyio
async def test_list_documents_filters_by_tag_case_insensitive(mock_backend):
    mock_backend.get = AsyncMock(return_value=[
        {"id": "d1", "kind": "device", "title": "NAS", "slug": "nas", "tags": ["Storage"], "created_at": "", "updated_at": ""},
        {"id": "d2", "kind": "page", "title": "Runbook", "slug": "runbook", "tags": ["ops"], "created_at": "", "updated_at": ""},
    ])
    result = await dispatch_document("list_documents", {"tag": "storage"})
    assert [d["id"] for d in result] == ["d1"]


@pytest.mark.anyio
async def test_list_documents_forwards_filters_to_the_backend(mock_backend):
    mock_backend.get = AsyncMock(return_value=[])
    await dispatch_document("list_documents", {"kind": "page", "device_id": "dev-1", "tag": "ops"})
    mock_backend.get.assert_called_once_with("/api/v1/documents?kind=page&device_id=dev-1&tag=ops")


@pytest.mark.anyio
async def test_list_documents_is_bounded_by_the_limit(mock_backend):
    rows = [{"id": f"d{i}", "kind": "page", "title": f"Page {i}", "slug": f"p{i}", "tags": [], "created_at": "", "updated_at": ""}
            for i in range(200)]
    mock_backend.get = AsyncMock(return_value=rows)
    result = await dispatch_document("list_documents", {"limit": 10})
    assert len(result) == 10
    assert result[0]["id"] == "d0"
    assert result[-1]["id"] == "d9"


# ── search_documents ─────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_search_documents(mock_backend):
    mock_backend.get = AsyncMock(return_value=
        {"engine": "fts5", "hits": [{"doc_id": "d1", "title": "NAS", "kind": "device", "snippet": "…backup…"}]})
    result = await dispatch_document("search_documents", {"query": "backup"})
    mock_backend.get.assert_called_once_with("/api/v1/documents/search?q=backup&limit=25")
    assert result["hits"][0]["doc_id"] == "d1"


@pytest.mark.anyio
async def test_search_documents_url_encodes_the_query(mock_backend):
    mock_backend.get = AsyncMock(return_value={"engine": "like", "hits": []})
    await dispatch_document("search_documents", {"query": "backup retention"})
    mock_backend.get.assert_called_once_with("/api/v1/documents/search?q=backup%20retention&limit=25")


@pytest.mark.anyio
async def test_search_documents_honours_the_limit(mock_backend):
    mock_backend.get = AsyncMock(return_value={"engine": "like", "hits": []})
    await dispatch_document("search_documents", {"query": "backup", "limit": 5})
    mock_backend.get.assert_called_once_with("/api/v1/documents/search?q=backup&limit=5")


# ── read_document ────────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_read_document_by_id(mock_backend):
    mock_backend.get = AsyncMock(side_effect=[
        {"id": "doc-1", "kind": "device", "title": "NAS", "slug": "nas", "version": 3,
         "device_id": "dev-1", "body": "# NAS\nBackup host.\n"},
        {"version": 3, "sections": [
            {"index": 0, "heading": "NAS", "level": 1, "heading_start": 0, "body_start": 5, "body_end": 21, "body_excerpt": "Backup host."},
        ]},
    ])
    result = await dispatch_document("read_document", {"document_id": "doc-1"})
    assert mock_backend.get.call_args_list == [
        (("/api/v1/documents/doc-1",), {}),
        (("/api/v1/documents/doc-1/sections",), {}),
    ]
    assert result["document"]["id"] == "doc-1"
    assert result["document"]["version"] == 3
    assert result["document"]["body"] == "# NAS\nBackup host.\n"
    assert result["document"]["sections"][0]["heading"] == "NAS"


@pytest.mark.anyio
async def test_read_document_reruns_the_sections_until_the_versions_match(mock_backend):
    """Body and outline are two requests; if the document is edited between them
    the outline is refetched so the answer never mixes two versions."""
    mock_backend.get = AsyncMock(side_effect=[
        {"id": "doc-1", "kind": "device", "title": "NAS", "slug": "nas", "version": 3,
         "device_id": "dev-1", "body": "# NAS\nBackup host.\n"},
        {"version": 2, "sections": [{"heading": "NAS"}]},   # stale — edited between the requests
        {"version": 3, "sections": [{"heading": "NAS"}]},   # refetched, now consistent
    ])
    result = await dispatch_document("read_document", {"document_id": "doc-1"})
    assert mock_backend.get.call_args_list[1:] == [
        (("/api/v1/documents/doc-1/sections",), {}),
        (("/api/v1/documents/doc-1/sections",), {}),
    ]
    assert result["document"]["sections"][0]["heading"] == "NAS"


@pytest.mark.anyio
async def test_read_document_by_device_id_resolves_through_the_tree(mock_backend):
    mock_backend.get = AsyncMock(side_effect=[
        [{"id": "doc-1", "kind": "device", "title": "NAS", "slug": "nas", "device_id": "dev-1"}],
        {"id": "doc-1", "kind": "device", "title": "NAS", "slug": "nas", "device_id": "dev-1", "body": "# NAS"},
        {"version": 1, "sections": []},
    ])
    result = await dispatch_document("read_document", {"device_id": "dev-1"})
    assert mock_backend.get.call_args_list[0] == (("/api/v1/documents?device_id=dev-1",), {})
    assert result["document"]["id"] == "doc-1"


@pytest.mark.anyio
async def test_read_document_by_device_id_url_encodes(mock_backend):
    mock_backend.get = AsyncMock(side_effect=[
        [],  # no docs → answered as such
    ])
    result = await dispatch_document("read_document", {"device_id": "rack a"})
    mock_backend.get.assert_called_once_with("/api/v1/documents?device_id=rack%20a")
    assert result["document"] is None


@pytest.mark.anyio
async def test_read_document_answers_a_device_without_one_without_creating(mock_backend):
    """The read side must never write: a device with no document is a fact,
    not a trigger for scaffolding."""
    mock_backend.get = AsyncMock(return_value=[])
    result = await dispatch_document("read_document", {"device_id": "dev-9"})
    assert result["document"] is None
    assert "no document exists" in result["message"].lower()
    mock_backend.post.assert_not_called()


@pytest.mark.anyio
async def test_read_document_requires_exactly_one_selector(mock_backend):
    with pytest.raises(ValueError, match="exactly one"):
        await dispatch_document("read_document", {"document_id": "d1", "device_id": "dev-1"})
    with pytest.raises(ValueError, match="document_id or device_id"):
        await dispatch_document("read_document", {})


# ── document_edit_preview / document_edit_apply ──────────────────────────────


_EDIT_ARGS = {
    "document_id": "doc-1",
    "operation": "append",
    "section_index": 0,
    "content": "Offsite copy.",
    "expected_version": 3,
}


@pytest.mark.anyio
async def test_document_edit_preview_posts_to_preview(mock_backend):
    mock_backend.post = AsyncMock(return_value={"version": 3, "proposal_id": "abc123"})
    result = await dispatch_document("document_edit_preview", dict(_EDIT_ARGS))
    mock_backend.post.assert_called_once_with(
        "/api/v1/documents/doc-1/sections/preview",
        {"operation": "append", "section_index": 0, "content": "Offsite copy.", "expected_version": 3},
    )
    assert result["proposal_id"] == "abc123"


@pytest.mark.anyio
async def test_document_edit_apply_posts_to_apply_with_the_preview_token(mock_backend):
    mock_backend.post = AsyncMock(return_value={"version": 4, "proposal_id": "abc123"})
    args = {**_EDIT_ARGS, "proposal_token": "token-from-preview"}
    result = await dispatch_document("document_edit_apply", args)
    mock_backend.post.assert_called_once_with(
        "/api/v1/documents/doc-1/sections/apply",
        {"operation": "append", "section_index": 0, "content": "Offsite copy.",
         "expected_version": 3, "proposal_token": "token-from-preview"},
    )
    assert result["version"] == 4


@pytest.mark.anyio
async def test_document_edit_apply_requires_the_preview_token(mock_backend):
    with pytest.raises(ValueError, match="proposal_token"):
        await dispatch_document("document_edit_apply", dict(_EDIT_ARGS))


@pytest.mark.anyio
async def test_document_edit_forward_insert_specifics(mock_backend):
    args = dict(_EDIT_ARGS)
    args.update({"operation": "insert", "heading": "Replication", "level": 2})
    await dispatch_document("document_edit_preview", args)
    mock_backend.post.assert_called_once_with(
        "/api/v1/documents/doc-1/sections/preview",
        {"operation": "insert", "section_index": 0, "content": "Offsite copy.",
         "expected_version": 3, "heading": "Replication", "level": 2},
    )


@pytest.mark.anyio
async def test_document_edit_drops_none_fields(mock_backend):
    """heading/level are optional; the request body must not carry nulls — the
    backend rejects `heading: null` on a non-insert."""
    await dispatch_document("document_edit_preview", {
        **_EDIT_ARGS, "heading": None, "level": None,
    })
    mock_backend.post.assert_called_once_with(
        "/api/v1/documents/doc-1/sections/preview",
        {"operation": "append", "section_index": 0, "content": "Offsite copy.", "expected_version": 3},
    )


def test_document_tools_are_registered_and_require_version_guards():
    names = {t.name for t in DOCUMENT_TOOLS}
    assert {"list_documents", "search_documents", "read_document",
            "document_edit_preview", "document_edit_apply"} <= names
    for name in ("document_edit_preview", "document_edit_apply"):
        tool = next(t for t in DOCUMENT_TOOLS if t.name == name)
        props = tool.inputSchema["properties"]
        assert props["operation"]["enum"] == ["append", "replace", "insert"]
        assert set(props["operation"]["enum"]) >= {"append", "replace", "insert"}
        # Both edit tools enforce the optimistic-lock version.
        assert "expected_version" in tool.inputSchema["required"]
    preview_tool = next(t for t in DOCUMENT_TOOLS if t.name == "document_edit_preview")
    apply_tool = next(t for t in DOCUMENT_TOOLS if t.name == "document_edit_apply")
    assert "proposal_token" not in preview_tool.inputSchema["required"]
    assert "proposal_token" in apply_tool.inputSchema["required"]
    assert "proposal_token" in apply_tool.inputSchema["properties"]


def test_read_document_advertises_a_device_id_selector():
    tool = next(t for t in DOCUMENT_TOOLS if t.name == "read_document")
    props = tool.inputSchema["properties"]
    assert {"document_id", "device_id"} == set(props)
    assert "device_id" in props


@pytest.mark.anyio
async def test_unknown_document_tool():
    with pytest.raises(ValueError, match="Unknown documentation tool"):
        await dispatch_document("no_such_tool", {})