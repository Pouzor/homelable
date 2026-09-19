"""
Tests for the /api/v1/docsview read-only public documentation endpoints.

The contract mirrors liveview:
  - Disabled by default (DOCS_VIEW_KEY not set) → 403
  - 403 for a missing or wrong key even when enabled
  - Tree, page and revisions for a valid key (no JWT required)

Plus the one this feature owns: the public payload must not carry a document's
links to the inventory or a canvas, nor the fields derived from them.
"""

import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.fixture(autouse=True)
def reset_docs_view_key():
    """Restore docs_view_key after each test so tests are isolated."""
    original = settings.docs_view_key
    yield
    settings.docs_view_key = original


async def _make_page(client: AsyncClient, headers: dict[str, str], title: str) -> dict:
    res = await client.post(
        "/api/v1/documents", json={"kind": "page", "title": title}, headers=headers
    )
    assert res.status_code == 201
    return res.json()


# ── Disabled (no key configured) ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_docsview_disabled_by_default(client: AsyncClient):
    settings.docs_view_key = None
    res = await client.get("/api/v1/docsview/tree?key=anything")
    assert res.status_code == 403
    assert res.json()["detail"] == "Documentation view is disabled"


@pytest.mark.asyncio
async def test_docsview_disabled_when_key_empty(client: AsyncClient):
    settings.docs_view_key = ""
    res = await client.get("/api/v1/docsview/tree?key=anything")
    assert res.status_code == 403
    assert res.json()["detail"] == "Documentation view is disabled"


@pytest.mark.asyncio
async def test_docsview_disabled_is_not_opened_by_the_liveview_key(client: AsyncClient):
    """Sharing a canvas must never start serving documents."""
    settings.docs_view_key = None
    settings.liveview_key = "canvas-secret"
    try:
        res = await client.get("/api/v1/docsview/tree?key=canvas-secret")
        assert res.status_code == 403
    finally:
        settings.liveview_key = None


# ── Enabled but wrong / missing key ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_docsview_wrong_key(client: AsyncClient):
    settings.docs_view_key = "correct-secret"
    res = await client.get("/api/v1/docsview/tree?key=wrong-key")
    assert res.status_code == 403
    assert res.json()["detail"] == "Invalid documentation view key"


@pytest.mark.asyncio
async def test_docsview_missing_key_param(client: AsyncClient):
    settings.docs_view_key = "correct-secret"
    res = await client.get("/api/v1/docsview/tree")
    assert res.status_code == 403
    assert res.json()["detail"] == "Invalid documentation view key"


@pytest.mark.asyncio
async def test_docsview_page_and_revisions_need_the_key(client: AsyncClient, headers):
    settings.docs_view_key = "correct-secret"
    doc = await _make_page(client, headers, "Offsite backups")

    for path in (f"/api/v1/docsview/{doc['id']}", f"/api/v1/docsview/{doc['id']}/revisions"):
        assert (await client.get(path)).status_code == 403
        assert (await client.get(f"{path}?key=nope")).status_code == 403


# ── Valid key — no JWT needed ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_docsview_tree_lists_documents(client: AsyncClient, headers):
    settings.docs_view_key = "my-secret-key"
    await _make_page(client, headers, "Offsite backups")
    await _make_page(client, headers, "Where mail is hosted")

    res = await client.get("/api/v1/docsview/tree?key=my-secret-key")
    assert res.status_code == 200
    titles = [d["title"] for d in res.json()]
    assert "Offsite backups" in titles
    assert "Where mail is hosted" in titles


@pytest.mark.asyncio
async def test_docsview_does_not_require_jwt(client: AsyncClient):
    """No Authorization header anywhere — the key is the whole credential."""
    settings.docs_view_key = "open-sesame"
    res = await client.get("/api/v1/docsview/tree?key=open-sesame")
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_docsview_serves_the_body(client: AsyncClient, headers):
    settings.docs_view_key = "test-key"
    doc = await _make_page(client, headers, "Runbook")
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "# Runbook\n\nPull the blue lever.\n"},
        headers=headers,
    )

    res = await client.get(f"/api/v1/docsview/{doc['id']}?key=test-key")
    assert res.status_code == 200
    assert "Pull the blue lever." in res.json()["body"]


@pytest.mark.asyncio
async def test_docsview_unknown_document_is_404(client: AsyncClient):
    settings.docs_view_key = "test-key"
    res = await client.get("/api/v1/docsview/does-not-exist?key=test-key")
    assert res.status_code == 404
    assert res.json()["detail"] == "Document not found"


# ── Revisions — readable, never restorable ───────────────────────────────────

@pytest.mark.asyncio
async def test_docsview_lists_and_reads_revisions(client: AsyncClient, headers):
    settings.docs_view_key = "test-key"
    doc = await _make_page(client, headers, "Runbook")
    await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "first version\n"}, headers=headers
    )
    await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "second version\n"}, headers=headers
    )

    listed = await client.get(f"/api/v1/docsview/{doc['id']}/revisions?key=test-key")
    assert listed.status_code == 200
    revisions = listed.json()
    assert len(revisions) == 2

    body = await client.get(f"/api/v1/docsview/revisions/{revisions[0]['id']}?key=test-key")
    assert body.status_code == 200
    assert body.json()["body"] == "first version\n"


@pytest.mark.asyncio
async def test_docsview_unknown_revision_is_404(client: AsyncClient):
    settings.docs_view_key = "test-key"
    res = await client.get("/api/v1/docsview/revisions/nope?key=test-key")
    assert res.status_code == 404
    assert res.json()["detail"] == "Revision not found"


@pytest.mark.asyncio
async def test_docsview_offers_no_write_verbs(client: AsyncClient, headers):
    """The router declares reads only, so every write is unroutable — including
    restore, which is the one write a reader might otherwise reach for."""
    settings.docs_view_key = "test-key"
    doc = await _make_page(client, headers, "Runbook")
    await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "v1\n"}, headers=headers
    )
    revision = (
        await client.get(f"/api/v1/docsview/{doc['id']}/revisions?key=test-key")
    ).json()[0]

    assert (await client.patch(
        f"/api/v1/docsview/{doc['id']}?key=test-key", json={"body": "hacked"}
    )).status_code == 405
    assert (await client.delete(f"/api/v1/docsview/{doc['id']}?key=test-key")).status_code == 405
    assert (await client.post(
        f"/api/v1/docsview/{doc['id']}/revisions/{revision['id']}/restore?key=test-key"
    )).status_code in (404, 405)


# ── The public payload carries nothing but the document ──────────────────────

@pytest.mark.asyncio
async def test_docsview_payload_hides_inventory_and_canvas_handles(
    client: AsyncClient, headers
):
    """A device document must not ship the ids it is linked by, nor the drift
    fields derived from the inventory row behind them."""
    settings.docs_view_key = "test-key"
    device = (
        await client.post(
            "/api/v1/scan/pending", json={"hostname": "nas-01", "ip": "192.168.1.10"}, headers=headers
        )
    ).json()
    doc = (
        await client.post(
            "/api/v1/documents",
            json={"kind": "device", "title": "NAS", "device_id": device["id"]},
            headers=headers,
        )
    ).json()

    leaked = {"device_id", "node_id", "design_id", "facts_snapshot", "facts_synced_at", "drifted", "template_id"}

    page = await client.get(f"/api/v1/docsview/{doc['id']}?key=test-key")
    assert page.status_code == 200
    assert leaked & page.json().keys() == set()

    tree = await client.get("/api/v1/docsview/tree?key=test-key")
    assert tree.status_code == 200
    for summary in tree.json():
        assert leaked & summary.keys() == set()

    # The authenticated route still carries them — this is a public-payload
    # rule, not a change to what the app itself reads.
    authed = await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)
    assert authed.json()["device_id"] == device["id"]


# ── Re-disable after enabling ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_docsview_disabled_after_key_cleared(client: AsyncClient):
    settings.docs_view_key = "was-enabled"
    assert (await client.get("/api/v1/docsview/tree?key=was-enabled")).status_code == 200

    settings.docs_view_key = None
    res = await client.get("/api/v1/docsview/tree?key=was-enabled")
    assert res.status_code == 403
    assert res.json()["detail"] == "Documentation view is disabled"


# ── /config (authenticated) — key used to build the link ─────────────────────

@pytest.mark.asyncio
async def test_docsview_config_requires_auth(client: AsyncClient):
    """The config endpoint exposes the key, so it must reject unauthenticated calls."""
    settings.docs_view_key = "secret"
    res = await client.get("/api/v1/docsview/config")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_docsview_config_returns_key_when_enabled(client: AsyncClient, headers):
    settings.docs_view_key = "share-me"
    res = await client.get("/api/v1/docsview/config", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": True, "key": "share-me"}


@pytest.mark.asyncio
async def test_docsview_config_disabled_hides_key(client: AsyncClient, headers):
    settings.docs_view_key = None
    res = await client.get("/api/v1/docsview/config", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": False, "key": None}


@pytest.mark.asyncio
async def test_docsview_config_empty_key_disabled(client: AsyncClient, headers):
    settings.docs_view_key = ""
    res = await client.get("/api/v1/docsview/config", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": False, "key": None}
