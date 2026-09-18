"""The documents API.

Covers what the plan promises the user: a document per device generated once,
a Library tree that cannot be knotted, history that survives a restore, and a
document that outlives the device it describes.
"""

import uuid

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.routes import documents as document_routes
from app.core.config import settings
from app.db.database import Base
from app.db.models import Document, DocumentRevision
from app.schemas.documents import DocumentUpdate, ExpectedVersionRequest, SectionApplyRequest
from app.services.doc_sections import proposal_id, sign_proposal


async def _device(client: AsyncClient, headers: dict, **body) -> dict:
    payload = {"label": "nas-01", "hostname": "nas-01.lan", "ip": "192.168.1.20", "discovery_source": "manual", **body}
    res = await client.post("/api/v1/scan/pending", json=payload, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()


async def _create(client: AsyncClient, headers: dict, **body) -> dict:
    res = await client.post("/api/v1/documents", json={"title": "Page", **body}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


async def _preview_token(
    client: AsyncClient, headers: dict, doc_id: str, payload: dict
) -> dict:
    """Preview a bounded edit and return its full preview (token included)."""
    res = await client.post(
        f"/api/v1/documents/{doc_id}/sections/preview", json=payload, headers=headers
    )
    assert res.status_code == 200, res.text
    return res.json()


async def _design(client: AsyncClient, headers: dict) -> str:
    res = await client.post("/api/v1/designs", json={"name": "D"}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


# ── auth ────────────────────────────────────────────────────────────────────


async def test_list_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/documents")).status_code == 401


async def test_create_requires_auth(client: AsyncClient):
    assert (await client.post("/api/v1/documents", json={"title": "X"})).status_code == 401


async def test_search_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/documents/search?q=x")).status_code == 401


async def test_coverage_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/documents/coverage")).status_code == 401


async def test_delete_requires_auth(client: AsyncClient):
    assert (await client.delete("/api/v1/documents/x")).status_code == 401


# ── create ──────────────────────────────────────────────────────────────────


async def test_create_a_blank_page(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="VLAN plan")
    assert doc["kind"] == "page"
    assert doc["slug"] == "vlan-plan"
    assert "# VLAN plan" in doc["body"]


async def test_create_a_page_from_a_template(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Reboot the NAS", template_id="runbook")
    assert "## Rollback" in doc["body"]
    assert doc["template_id"] == "runbook"


async def test_create_a_page_with_an_explicit_body(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Raw", body="---\ntags: [a]\n---\n\nhello")
    assert doc["body"].endswith("hello")
    # The frontmatter cache is derived from the body, never sent on its own.
    assert doc["frontmatter"] == {"tags": ["a"]}
    assert doc["tags"] == ["a"]


async def test_create_a_folder(client: AsyncClient, headers: dict):
    folder = await _create(client, headers, title="Runbooks", kind="folder")
    child = await _create(client, headers, title="Reboot", parent_id=folder["id"])
    assert child["parent_id"] == folder["id"]


async def test_create_rejects_an_unknown_kind(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents", json={"title": "X", "kind": "wat"}, headers=headers)
    assert res.status_code == 422


async def test_create_rejects_an_unknown_template(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents", json={"title": "X", "template_id": "wat"}, headers=headers)
    assert res.status_code == 422


async def test_create_rejects_a_missing_parent(client: AsyncClient, headers: dict):
    res = await client.post(
        "/api/v1/documents", json={"title": "X", "parent_id": str(uuid.uuid4())}, headers=headers
    )
    assert res.status_code == 404


async def test_create_rejects_a_page_that_also_names_a_device(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    res = await client.post(
        "/api/v1/documents", json={"title": "X", "kind": "page", "device_id": device["id"]}, headers=headers
    )
    assert res.status_code == 400


async def test_create_rejects_a_device_document_naming_nothing(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents", json={"title": "X", "kind": "device"}, headers=headers)
    assert res.status_code == 400


async def test_create_rejects_two_links_at_once(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    res = await client.post(
        "/api/v1/documents",
        json={"title": "X", "kind": "device", "device_id": device["id"], "design_id": await _design(client, headers)},
        headers=headers,
    )
    assert res.status_code == 400


async def test_create_rejects_a_device_that_does_not_exist(client: AsyncClient, headers: dict):
    res = await client.post(
        "/api/v1/documents",
        json={"title": "X", "kind": "device", "device_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert res.status_code == 404


async def test_create_rejects_a_design_that_does_not_exist(client: AsyncClient, headers: dict):
    res = await client.post(
        "/api/v1/documents",
        json={"title": "X", "kind": "design", "design_id": str(uuid.uuid4())},
        headers=headers,
    )
    assert res.status_code == 404


async def test_a_device_gets_at_most_one_document(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    body = {"title": "nas", "kind": "device", "device_id": device["id"]}
    assert (await client.post("/api/v1/documents", json=body, headers=headers)).status_code == 201
    second = await client.post("/api/v1/documents", json=body, headers=headers)
    assert second.status_code == 409


async def test_a_sibling_title_gets_a_distinct_slug(client: AsyncClient, headers: dict):
    first = await _create(client, headers, title="Network")
    second = await _create(client, headers, title="Network")
    assert first["slug"] == "network"
    assert second["slug"] == "network-2"


# ── the generated device document ───────────────────────────────────────────


async def test_a_device_document_is_scaffolded_from_the_live_facts(client: AsyncClient, headers: dict):
    device = await _device(
        client, headers, hostname="nas-01.lan", vendor="Synology", notes="Holds the backups."
    )
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    assert "| Hostname | nas-01.lan |" in doc["body"]
    assert "| IP | 192.168.1.20 |" in doc["body"]
    assert "Holds the backups." in doc["body"]
    assert doc["facts_snapshot"]["ip"] == "192.168.1.20"
    assert doc["facts_synced_at"] is not None


async def test_the_old_notes_column_is_left_untouched_by_scaffolding(client: AsyncClient, headers: dict):
    device = await _device(client, headers, notes="Holds the backups.")
    await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    res = await client.get("/api/v1/scan/pending", headers=headers)
    row = next(d for d in res.json() if d["id"] == device["id"])
    assert row["notes"] == "Holds the backups."


async def test_a_device_document_records_its_zone_and_neighbours(client: AsyncClient, headers: dict):
    design_id = await _design(client, headers)
    device = await _device(client, headers)
    zone = await client.post(
        "/api/v1/nodes",
        json={"type": "groupRect", "label": "Garage", "design_id": design_id, "pos_x": 0, "pos_y": 0},
        headers=headers,
    )
    zone_id = zone.json()["id"]
    # A node binds to its inventory row by its addresses, not by an id on the
    # payload — the canvas is one more way to document hardware, not a store.
    node = await client.post(
        "/api/v1/nodes",
        json={
            "type": "nas",
            "label": "nas-01",
            "design_id": design_id,
            "ip": "192.168.1.20",
            "hostname": "nas-01.lan",
            "parent_id": zone_id,
            "pos_x": 0,
            "pos_y": 0,
        },
        headers=headers,
    )
    assert node.json()["device_id"] == device["id"], node.text
    peer = await client.post(
        "/api/v1/nodes",
        json={"type": "switch", "label": "switch-core", "design_id": design_id, "pos_x": 0, "pos_y": 0},
        headers=headers,
    )
    await client.post(
        "/api/v1/edges",
        json={"source": node.json()["id"], "target": peer.json()["id"], "type": "ethernet"},
        headers=headers,
    )

    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    assert "Zone **Garage**." in doc["body"]
    assert "`switch-core`" in doc["body"]


async def test_a_text_annotation_is_never_read_as_a_zone(client: AsyncClient, headers: dict):
    """A device parented in a text annotation has no zone, not the caption (#446).

    The annotation's content is arbitrary user text; printed as `zone_label` it
    is indistinguishable from a real zone in the Physical Location section.
    """
    design_id = await _design(client, headers)
    device = await _device(client, headers)
    annotation = await client.post(
        "/api/v1/nodes",
        json={"type": "text", "label": "\u26a0 maintenance zone", "design_id": design_id, "pos_x": 0, "pos_y": 0},
        headers=headers,
    )
    node = await client.post(
        "/api/v1/nodes",
        json={
            "type": "nas",
            "label": "nas-01",
            "design_id": design_id,
            "ip": "192.168.1.20",
            "hostname": "nas-01.lan",
            "parent_id": annotation.json()["id"],
            "pos_x": 0,
            "pos_y": 0,
        },
        headers=headers,
    )
    # Without the link there is no node to walk up from and the test would pass
    # on nothing at all.
    assert node.json()["device_id"] == device["id"], node.text

    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    assert "maintenance zone" not in doc["body"]
    assert "Zone **" not in doc["body"]


async def test_a_zone_above_a_text_annotation_still_names_the_device(client: AsyncClient, headers: dict):
    """Skipping the annotation means walking past it, not giving up (#446)."""
    design_id = await _design(client, headers)
    device = await _device(client, headers)
    zone = await client.post(
        "/api/v1/nodes",
        json={"type": "groupRect", "label": "Garage", "design_id": design_id, "pos_x": 0, "pos_y": 0},
        headers=headers,
    )
    annotation = await client.post(
        "/api/v1/nodes",
        json={
            "type": "text",
            "label": "\u26a0 maintenance",
            "design_id": design_id,
            "parent_id": zone.json()["id"],
            "pos_x": 0,
            "pos_y": 0,
        },
        headers=headers,
    )
    node = await client.post(
        "/api/v1/nodes",
        json={
            "type": "nas",
            "label": "nas-01",
            "design_id": design_id,
            "ip": "192.168.1.20",
            "hostname": "nas-01.lan",
            "parent_id": annotation.json()["id"],
            "pos_x": 0,
            "pos_y": 0,
        },
        headers=headers,
    )
    assert node.json()["device_id"] == device["id"], node.text

    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    assert "Zone **Garage**." in doc["body"]


# ── blocks ──────────────────────────────────────────────────────────────────


async def test_a_block_can_be_regenerated_on_demand(client: AsyncClient, headers: dict):
    device = await _device(client, headers, hostname="nas-01.lan")
    res = await client.get(
        f"/api/v1/documents/blocks?block=device-info&device_id={device['id']}", headers=headers
    )
    assert res.status_code == 200, res.text
    assert "| Hostname | nas-01.lan |" in res.json()["markdown"]


async def test_an_unknown_block_is_rejected(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    res = await client.get(f"/api/v1/documents/blocks?block=nope&device_id={device['id']}", headers=headers)
    assert res.status_code == 400


async def test_a_block_for_a_missing_device_is_404(client: AsyncClient, headers: dict):
    res = await client.get(
        f"/api/v1/documents/blocks?block=device-info&device_id={uuid.uuid4()}", headers=headers
    )
    assert res.status_code == 404


# ── read / list ─────────────────────────────────────────────────────────────


async def test_get_a_missing_document_is_404(client: AsyncClient, headers: dict):
    assert (await client.get(f"/api/v1/documents/{uuid.uuid4()}", headers=headers)).status_code == 404


async def test_listing_carries_no_body(client: AsyncClient, headers: dict):
    await _create(client, headers, title="VLAN plan")
    row = (await client.get("/api/v1/documents", headers=headers)).json()[0]
    assert "body" not in row


async def test_listing_filters_by_kind_and_parent(client: AsyncClient, headers: dict):
    folder = await _create(client, headers, title="Runbooks", kind="folder")
    await _create(client, headers, title="Reboot", parent_id=folder["id"])
    await _create(client, headers, title="Loose")

    folders = (await client.get("/api/v1/documents?kind=folder", headers=headers)).json()
    assert [d["title"] for d in folders] == ["Runbooks"]

    children = (await client.get(f"/api/v1/documents?parent_id={folder['id']}", headers=headers)).json()
    assert [d["title"] for d in children] == ["Reboot"]


async def test_listing_filters_by_tag(client: AsyncClient, headers: dict):
    await _create(client, headers, title="A", body="---\ntags: [Network]\n---\n")
    await _create(client, headers, title="B", body="---\ntags: [storage]\n---\n")
    hits = (await client.get("/api/v1/documents?tag=network", headers=headers)).json()
    assert [d["title"] for d in hits] == ["A"]


async def test_listing_without_a_limit_preserves_a_large_gui_tree(
    client: AsyncClient, headers: dict
):
    for i in range(105):
        await _create(client, headers, title=f"Page {i:03}")

    rows = (await client.get("/api/v1/documents", headers=headers)).json()
    assert len(rows) == 105
    assert [row["title"] for row in rows[:2]] == ["Page 000", "Page 001"]
    assert rows[-1]["title"] == "Page 104"


async def test_listing_paginates_stably_after_tag_filtering(client: AsyncClient, headers: dict):
    for title, tags in (
        ("A", "[wanted]"),
        ("B", "[other]"),
        ("C", "[wanted]"),
        ("D", "[wanted]"),
    ):
        await _create(client, headers, title=title, body=f"---\ntags: {tags}\n---\n")

    rows = (
        await client.get(
            "/api/v1/documents?tag=wanted&limit=2&offset=1", headers=headers
        )
    ).json()
    assert [row["title"] for row in rows] == ["C", "D"]


async def test_listing_validates_pagination(client: AsyncClient, headers: dict):
    for query in ("limit=0", "limit=101", "offset=-1"):
        assert (await client.get(f"/api/v1/documents?{query}", headers=headers)).status_code == 422


# ── update ──────────────────────────────────────────────────────────────────


async def test_editing_the_body_refreshes_the_frontmatter_cache(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "---\ntags: [x]\n---\n\nnew", "expected_version": 1}, headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["tags"] == ["x"]


async def test_the_body_renames_the_document(client: AsyncClient, headers: dict):
    """`title:` in the frontmatter is the only place a document is named."""
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "---\ntitle: SMB / CIFS\n---\n\n# SMB / CIFS\n", "expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["title"] == "SMB / CIFS"
    assert res.json()["slug"] == "smb-cifs"


async def test_a_body_without_a_title_keeps_the_one_it_has(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "---\ntags: [x]\n---\n\nnew", "expected_version": 1}, headers=headers
    )
    assert res.json()["title"] == "Page"


async def test_a_blank_title_in_the_body_is_ignored(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "---\ntitle: '   '\n---\n\nnew", "expected_version": 1}, headers=headers
    )
    assert res.json()["title"] == "Page"


async def test_an_explicit_title_wins_over_the_body_in_the_same_request(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"title": "Chosen", "body": "---\ntitle: From the body\n---\n\nnew", "expected_version": 1},
        headers=headers,
    )
    assert res.json()["title"] == "Chosen"


async def test_a_device_document_renamed_in_its_body_keeps_its_device(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "---\ntitle: The big NAS\n---\n\n# The big NAS\n", "expected_version": 1},
        headers=headers,
    )
    assert res.json()["title"] == "The big NAS"
    assert res.json()["device_id"] == device["id"]


async def test_renaming_reslugs(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"title": "New name"}, headers=headers)
    assert res.json()["slug"] == "new-name"


async def test_starring_and_reviewing(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"starred": True, "reviewed": True}, headers=headers
    )
    assert res.json()["starred"] is True
    assert res.json()["reviewed_at"] is not None


async def test_patching_a_missing_document_is_404(client: AsyncClient, headers: dict):
    res = await client.patch(f"/api/v1/documents/{uuid.uuid4()}", json={"title": "X"}, headers=headers)
    assert res.status_code == 404


async def test_a_folder_cannot_be_moved_inside_itself(client: AsyncClient, headers: dict):
    outer = await _create(client, headers, title="Outer", kind="folder")
    inner = await _create(client, headers, title="Inner", kind="folder", parent_id=outer["id"])
    res = await client.patch(f"/api/v1/documents/{outer['id']}", json={"parent_id": inner["id"]}, headers=headers)
    assert res.status_code == 400


async def test_a_document_can_only_be_filed_under_a_folder(client: AsyncClient, headers: dict):
    page = await _create(client, headers, title="Page")
    other = await _create(client, headers, title="Other")
    res = await client.patch(f"/api/v1/documents/{other['id']}", json={"parent_id": page["id"]}, headers=headers)
    assert res.status_code == 400


async def test_a_device_document_does_not_live_in_the_library_tree(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas", kind="device", device_id=device["id"])
    folder = await _create(client, headers, title="F", kind="folder")
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"parent_id": folder["id"]}, headers=headers)
    assert res.status_code == 400


async def test_resyncing_facts_clears_the_drift_without_touching_the_body(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas", kind="device", device_id=device["id"])
    await client.patch(f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers)

    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"resync_facts": True}, headers=headers)
    assert res.json()["facts_snapshot"]["ip"] == "192.168.1.99"
    # The header the user owns still says what it always said.
    assert "192.168.1.20" in res.json()["body"]


# ── drift ───────────────────────────────────────────────────────────────────


async def test_a_fresh_device_document_has_not_drifted(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    assert doc["drifted"] is False
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert read["drifted"] is False


async def test_changing_the_device_marks_the_document_drifted(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    await client.patch(
        f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers
    )
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert read["drifted"] is True


async def test_a_property_edit_alone_marks_the_document_drifted(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    await client.patch(
        f"/api/v1/scan/pending/{device['id']}",
        json={"properties": [{"key": "Rack", "value": "A1"}]},
        headers=headers,
    )
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert read["drifted"] is True


async def test_editing_the_body_does_not_make_a_document_drift(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "my words", "expected_version": 1}, headers=headers)
    assert res.json()["drifted"] is False


async def test_accepting_the_facts_clears_the_drift(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    await client.patch(
        f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers
    )
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"resync_facts": True}, headers=headers
    )
    assert res.json()["drifted"] is False


async def test_regenerating_clears_the_drift(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    await client.patch(
        f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers
    )
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/regenerate",
        json={"expected_version": 1},
        headers=headers,
    )
    assert res.json()["drifted"] is False


async def test_the_listing_carries_the_drift_flag_for_the_tree_badge(
    client: AsyncClient, headers: dict
):
    fresh = await _device(client, headers, label="switch-01", ip="192.168.1.2")
    stale = await _device(client, headers, label="nas-01", ip="192.168.1.20")
    in_sync = await _create(client, headers, title="switch-01", kind="device", device_id=fresh["id"])
    moved = await _create(client, headers, title="nas-01", kind="device", device_id=stale["id"])
    await client.patch(
        f"/api/v1/scan/pending/{stale['id']}", json={"ip": "192.168.1.99"}, headers=headers
    )

    listing = (await client.get("/api/v1/documents", headers=headers)).json()
    by_id = {d["id"]: d for d in listing}
    assert by_id[moved["id"]]["drifted"] is True
    assert by_id[in_sync["id"]]["drifted"] is False


async def test_a_library_page_never_drifts(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="VLAN plan")
    assert doc["drifted"] is False


# ── revisions ───────────────────────────────────────────────────────────────


async def test_an_edit_records_the_previous_body(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "second", "expected_version": 1}, headers=headers)
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert len(revisions) == 1
    assert revisions[0]["reason"] == "edit"
    stored = (await client.get(f"/api/v1/documents/revisions/{revisions[0]['id']}", headers=headers)).json()
    assert stored["body"] == "first"


async def test_saving_an_unchanged_body_records_nothing(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="same")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "same", "expected_version": 1}, headers=headers)
    assert (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json() == []


async def test_an_edit_can_say_it_came_from_an_ai_client(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "second", "expected_version": 1, "revision_reason": "mcp"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in revisions] == ["mcp"]


async def test_an_unknown_revision_reason_is_rejected(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "second", "expected_version": 1, "revision_reason": "restore"},
        headers=headers,
    )
    assert res.status_code == 422


async def test_a_revision_reason_without_a_body_change_records_nothing(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="same")
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"starred": True, "revision_reason": "mcp"},
        headers=headers,
    )
    assert (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json() == []


async def test_restoring_brings_back_an_old_body_and_is_itself_undoable(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "second", "expected_version": 1}, headers=headers)
    revision = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()[0]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore",
        json={"expected_version": 2},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["body"] == "first"

    history = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in history][0] == "restore"


async def test_restoring_brings_back_the_title_that_body_carried(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="---\ntitle: First name\n---\n\nfirst")
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "---\ntitle: Second name\n---\n\nsecond", "expected_version": 1},
        headers=headers,
    )
    revision = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()[0]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore",
        json={"expected_version": 2},
        headers=headers,
    )
    assert res.json()["title"] == "First name"


async def test_restoring_a_revision_of_another_document_is_404(client: AsyncClient, headers: dict):
    a = await _create(client, headers, title="A", body="one")
    b = await _create(client, headers, title="B", body="one")
    await client.patch(f"/api/v1/documents/{a['id']}", json={"body": "two", "expected_version": 1}, headers=headers)
    revision = (await client.get(f"/api/v1/documents/{a['id']}/revisions", headers=headers)).json()[0]
    res = await client.post(
        f"/api/v1/documents/{b['id']}/revisions/{revision['id']}/restore",
        json={"expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 404


async def test_restore_requires_the_current_version_and_rejects_stale_or_future_versions(
    client: AsyncClient, headers: dict
):
    doc = await _create(client, headers, title="Page", body="first")
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "second", "expected_version": 1},
        headers=headers,
    )
    revision = (await client.get(
        f"/api/v1/documents/{doc['id']}/revisions", headers=headers
    )).json()[0]
    url = f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore"

    assert (await client.post(url, headers=headers)).status_code == 422
    for expected_version in (1, 99):
        assert (
            await client.post(
                url, json={"expected_version": expected_version}, headers=headers
            )
        ).status_code == 409

    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert (read["body"], read["version"]) == ("second", 2)
    history = (await client.get(
        f"/api/v1/documents/{doc['id']}/revisions", headers=headers
    )).json()
    assert [row["reason"] for row in history] == ["edit"]


async def test_history_is_pruned_to_the_limit(client: AsyncClient, headers: dict):
    from app.services.doc_tree import REVISION_LIMIT

    doc = await _create(client, headers, title="Page", body="v0")
    version = 1
    for i in range(1, REVISION_LIMIT + 6):
        await client.patch(
            f"/api/v1/documents/{doc['id']}",
            json={"body": f"v{i}", "expected_version": version},
            headers=headers,
        )
        version += 1
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert len(revisions) == REVISION_LIMIT


# ── regenerate ──────────────────────────────────────────────────────────────


async def test_regenerate_requires_auth(client: AsyncClient):
    assert (await client.post("/api/v1/documents/x/regenerate")).status_code == 401


async def test_regenerating_a_device_document_rebuilds_it_from_the_facts(
    client: AsyncClient, headers: dict
):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "everything I wrote", "expected_version": 1}, headers=headers)

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/regenerate",
        json={"expected_version": 2},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "everything I wrote" not in body["body"]
    assert "192.168.1.20" in body["body"]
    # A regenerated document is only the template again, as it was on day one.
    assert body["edited_at"] is None
    assert body["template_id"] == "device"


async def test_regenerating_reads_the_devices_current_facts(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    await client.patch(
        f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers
    )

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/regenerate",
        json={"expected_version": 1},
        headers=headers,
    )
    assert "192.168.1.99" in res.json()["body"]
    # Regenerating documents the device as it is now, so the drift is gone.
    assert res.json()["facts_snapshot"]["ip"] == "192.168.1.99"


async def test_regenerating_keeps_the_replaced_body_in_the_history(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="VLAN plan", body="my own words")
    await client.post(
        f"/api/v1/documents/{doc['id']}/regenerate",
        json={"expected_version": 1},
        headers=headers,
    )

    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert revisions[0]["reason"] == "regenerate"
    stored = (await client.get(f"/api/v1/documents/revisions/{revisions[0]['id']}", headers=headers)).json()
    assert stored["body"] == "my own words"


async def test_regenerating_a_library_page_uses_its_template(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Restart the NAS", template_id="runbook")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "gone", "expected_version": 1}, headers=headers)

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/regenerate",
        json={"expected_version": 2},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert "gone" not in res.json()["body"]
    assert "# Restart the NAS" in res.json()["body"]
    assert res.json()["template_id"] == "runbook"


async def test_regenerating_a_folder_is_rejected(client: AsyncClient, headers: dict):
    folder = await _create(client, headers, title="Runbooks", kind="folder")
    res = await client.post(
        f"/api/v1/documents/{folder['id']}/regenerate",
        json={"expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 400


async def test_regenerating_an_unknown_document_is_404(client: AsyncClient, headers: dict):
    res = await client.post(
        f"/api/v1/documents/{uuid.uuid4()}/regenerate",
        json={"expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 404


async def test_regenerate_requires_the_current_version_and_rejects_stale_or_future_versions(
    client: AsyncClient, headers: dict
):
    doc = await _create(client, headers, title="Page", body="first")
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "second", "expected_version": 1},
        headers=headers,
    )
    url = f"/api/v1/documents/{doc['id']}/regenerate"

    assert (await client.post(url, headers=headers)).status_code == 422
    for expected_version in (1, 99):
        assert (
            await client.post(
                url, json={"expected_version": expected_version}, headers=headers
            )
        ).status_code == 409

    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert (read["body"], read["version"]) == ("second", 2)
    history = (await client.get(
        f"/api/v1/documents/{doc['id']}/revisions", headers=headers
    )).json()
    assert [row["reason"] for row in history] == ["edit"]


# ── delete ──────────────────────────────────────────────────────────────────


async def test_deleting_a_folder_takes_its_subtree(client: AsyncClient, headers: dict):
    outer = await _create(client, headers, title="Outer", kind="folder")
    inner = await _create(client, headers, title="Inner", kind="folder", parent_id=outer["id"])
    leaf = await _create(client, headers, title="Leaf", parent_id=inner["id"])

    assert (await client.delete(f"/api/v1/documents/{outer['id']}", headers=headers)).status_code == 204
    for doc_id in (outer["id"], inner["id"], leaf["id"]):
        assert (await client.get(f"/api/v1/documents/{doc_id}", headers=headers)).status_code == 404


async def test_deleting_a_missing_document_is_404(client: AsyncClient, headers: dict):
    assert (await client.delete(f"/api/v1/documents/{uuid.uuid4()}", headers=headers)).status_code == 404


async def test_a_deleted_document_leaves_the_search_index(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="unmistakable")
    await client.delete(f"/api/v1/documents/{doc['id']}", headers=headers)
    hits = (await client.get("/api/v1/documents/search?q=unmistakable", headers=headers)).json()["hits"]
    assert hits == []


# ── the document outlives what it describes ─────────────────────────────────


async def test_deleting_a_device_orphans_its_document_but_keeps_the_body(client: AsyncClient, headers: dict):
    device = await _device(client, headers, notes="Holds the backups.")
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])

    assert (await client.delete(f"/api/v1/scan/pending/{device['id']}", headers=headers)).status_code == 200

    after = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert after["device_id"] is None
    assert after["title"] == "nas-01"
    assert "Holds the backups." in after["body"]


async def test_deleting_a_node_orphans_the_document_describing_it(client: AsyncClient, headers: dict):
    design_id = await _design(client, headers)
    zone = await client.post(
        "/api/v1/nodes",
        json={"type": "groupRect", "label": "Garage", "design_id": design_id, "pos_x": 0, "pos_y": 0},
        headers=headers,
    )
    doc = await _create(client, headers, title="Garage", kind="node", node_id=zone.json()["id"])

    await client.delete(f"/api/v1/nodes/{zone.json()['id']}", headers=headers)

    after = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert after["node_id"] is None
    assert after["title"] == "Garage"


# ── search ──────────────────────────────────────────────────────────────────


async def test_search_names_its_engine_and_returns_hits(client: AsyncClient, headers: dict):
    await _create(client, headers, title="VLAN plan", body="Guest traffic is isolated.")
    res = await client.get("/api/v1/documents/search?q=isolated", headers=headers)
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["engine"] in ("fts5", "like")
    assert [h["title"] for h in payload["hits"]] == ["VLAN plan"]


async def test_search_carries_the_device_link_so_a_hit_can_be_opened(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    hits = (await client.get("/api/v1/documents/search?q=nas", headers=headers)).json()["hits"]
    assert hits[0]["device_id"] == device["id"]


async def test_search_rejects_a_silly_limit(client: AsyncClient, headers: dict):
    assert (await client.get("/api/v1/documents/search?q=x&limit=0", headers=headers)).status_code == 422


# ── scaffold and coverage ───────────────────────────────────────────────────


async def test_scaffold_documents_every_device_that_has_none(client: AsyncClient, headers: dict):
    await _device(client, headers, label="a", ip="10.0.0.1")
    await _device(client, headers, label="b", ip="10.0.0.2")
    res = await client.post("/api/v1/documents/scaffold", json={}, headers=headers)
    assert res.status_code == 200, res.text
    assert len(res.json()["created"]) == 2


async def test_scaffold_is_repeatable_and_skips_what_exists(client: AsyncClient, headers: dict):
    await _device(client, headers, label="a", ip="10.0.0.1")
    await client.post("/api/v1/documents/scaffold", json={}, headers=headers)
    again = (await client.post("/api/v1/documents/scaffold", json={}, headers=headers)).json()
    assert again["created"] == []
    assert again["skipped"] == 1


async def test_scaffold_can_be_limited_to_devices_that_have_notes(client: AsyncClient, headers: dict):
    await _device(client, headers, label="a", ip="10.0.0.1", notes="worth keeping")
    await _device(client, headers, label="b", ip="10.0.0.2")
    res = (
        await client.post("/api/v1/documents/scaffold", json={"only_with_notes": True}, headers=headers)
    ).json()
    assert [d["title"] for d in res["created"]] == ["a"]
    assert res["skipped"] == 1


async def test_scaffold_can_be_limited_to_named_devices(client: AsyncClient, headers: dict):
    first = await _device(client, headers, label="a", ip="10.0.0.1")
    await _device(client, headers, label="b", ip="10.0.0.2")
    res = (
        await client.post("/api/v1/documents/scaffold", json={"device_ids": [first["id"]]}, headers=headers)
    ).json()
    assert [d["title"] for d in res["created"]] == ["a"]


async def test_a_migrated_document_records_why_it_exists(client: AsyncClient, headers: dict):
    device = await _device(client, headers, notes="worth keeping")
    created = (
        await client.post("/api/v1/documents/scaffold", json={}, headers=headers)
    ).json()["created"][0]
    revisions = (await client.get(f"/api/v1/documents/{created['id']}/revisions", headers=headers)).json()
    assert revisions[0]["reason"] == "migrate"
    assert device["id"]


async def test_coverage_counts_what_is_missing_and_unmigrated(client: AsyncClient, headers: dict):
    await _device(client, headers, label="a", ip="10.0.0.1", notes="notes here")
    await _device(client, headers, label="b", ip="10.0.0.2")

    before = (await client.get("/api/v1/documents/coverage", headers=headers)).json()
    assert before["devices"] == 2
    assert before["documented"] == 0
    assert before["missing"] == 2
    assert before["notes_unmigrated"] == 1

    await client.post("/api/v1/documents/scaffold", json={}, headers=headers)
    after = (await client.get("/api/v1/documents/coverage", headers=headers)).json()
    assert after["documented"] == 2
    assert after["missing"] == 0
    assert after["notes_unmigrated"] == 0
    # Generated and not yet touched.
    assert after["header_only"] == 2


async def test_coverage_reports_a_document_that_has_drifted(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    await _create(client, headers, title="nas", kind="device", device_id=device["id"])
    assert (await client.get("/api/v1/documents/coverage", headers=headers)).json()["drifted"] == 0

    await client.patch(f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers)
    assert (await client.get("/api/v1/documents/coverage", headers=headers)).json()["drifted"] == 1


async def test_coverage_stops_calling_a_document_header_only_once_it_is_edited(
    client: AsyncClient, headers: dict
):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas", kind="device", device_id=device["id"])
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "written by hand", "expected_version": 1}, headers=headers)
    assert (await client.get("/api/v1/documents/coverage", headers=headers)).json()["header_only"] == 0


async def test_coverage_counts_library_pages_separately(client: AsyncClient, headers: dict):
    await _create(client, headers, title="VLAN plan")
    await _create(client, headers, title="Runbooks", kind="folder")
    assert (await client.get("/api/v1/documents/coverage", headers=headers)).json()["library_pages"] == 2


# ── bounded section edits (the MCP surface) ─────────────────────────────────


async def test_sections_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/documents/x/sections")).status_code == 401


async def test_sections_requires_auth_for_preview_and_apply(client: AsyncClient):
    assert (await client.post("/api/v1/documents/x/sections/preview", json={})).status_code == 401
    assert (await client.post("/api/v1/documents/x/sections/apply", json={})).status_code == 401


async def test_outline_for_a_missing_document_is_404(client: AsyncClient, headers: dict):
    assert (await client.get(f"/api/v1/documents/{uuid.uuid4()}/sections", headers=headers)).status_code == 404


async def test_the_outline_names_sections_against_the_version(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# A\n\nfirst\n\n# B\n\nsecond\n")
    outline = (await client.get(f"/api/v1/documents/{doc['id']}/sections", headers=headers)).json()
    assert outline["document_id"] == doc["id"]
    assert outline["version"] == 1
    assert [s["heading"] for s in outline["sections"]] == ["A", "B"]
    assert outline["sections"][0]["index"] == 0
    assert outline["sections"][0]["parent_index"] is None


async def test_an_outline_excerpt_rides_along(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\nBackup nightly.\n")
    outline = (await client.get(f"/api/v1/documents/{doc['id']}/sections", headers=headers)).json()
    assert outline["sections"][0]["excerpt"] == "Backup nightly."


async def test_preview_shows_the_change_without_writing(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n\n# End\n\nfin\n")
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/preview",
        json={"operation": "append", "section_index": 0, "content": "- backup nightly", "expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    preview = res.json()
    assert preview["version"] == 1
    assert "- backup nightly" in preview["after"]
    assert "_…_" in preview["before"]
    assert preview["section"]["heading"] == "Ops"
    assert preview["proposal_id"]
    # Previewing wrote nothing: no revision was recorded.
    history = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert history == []


async def test_preview_rejects_an_unclosed_code_fence(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/preview",
        json={"operation": "append", "section_index": 0, "content": "```\nlet x = 1", "expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 400
    assert "unclosed code fence" in res.json()["detail"]


async def test_preview_rejects_a_heading_that_would_escape_the_section(
    client: AsyncClient, headers: dict
):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n## Sub\n\n_…_\n")
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/preview",
        json={"operation": "append", "section_index": 1, "content": "## This breaks out", "expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 400
    assert "level 2 heading" in res.json()["detail"]


async def test_preview_rejects_a_stale_version(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "# Ops\n\nchanged\n", "expected_version": 1}, headers=headers)
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/preview",
        json={"operation": "append", "section_index": 0, "content": "x", "expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 409


async def test_apply_stores_the_edit_and_bumps_the_version(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n### Backup\n\n_…_\n")
    payload = {
        "operation": "append",
        "section_index": 1,
        "content": "- **Retention** — 30 days",
        "expected_version": 1,
    }
    preview = await _preview_token(client, headers, doc["id"], payload)
    payload["proposal_token"] = preview["proposal_token"]
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json=payload,
        headers=headers,
    )
    assert res.status_code == 200, res.text
    applied = res.json()
    assert applied["retried"] is False
    assert applied["version"] == 2
    assert "- **Retention** — 30 days" in applied["body"]
    # The edit is visible in later reads and recorded as an MCP revision.
    body = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()["body"]
    assert "- **Retention** — 30 days" in body
    history = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert history[0]["reason"] == "mcp"
    assert "> _…_" in history[0]["title"] or history[0]["title"] == "Page"


async def test_apply_without_a_preview_token_is_refused(client: AsyncClient, headers: dict):
    """An apply must carry the token of the edit it actually previewed.

    Regression for the issue #485 review: without server-side binding, a caller
    could preview one edit and apply another (or none at all). The token is
    signed over the document, version and every edited field, so a missing or
    mismatched token is refused before any write.
    """
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    missing = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={"operation": "append", "section_index": 0, "content": "x", "expected_version": 1},
        headers=headers,
    )
    assert missing.status_code == 422

    preview = await _preview_token(
        client, headers, doc["id"], {"operation": "append", "section_index": 0, "content": "a", "expected_version": 1}
    )
    # A token minted for a *different* edit than the one being applied.
    swapped = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={
            "operation": "append",
            "section_index": 0,
            "content": "b",
            "expected_version": 1,
            "proposal_token": preview["proposal_token"],
        },
        headers=headers,
    )
    assert swapped.status_code == 400
    assert "proposal_token does not match" in swapped.json()["detail"]
    # Nothing was written by either attempt.
    assert (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json() == []


async def test_apply_rejects_a_stale_version(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    payload = {"operation": "append", "section_index": 0, "content": "x", "expected_version": 1}
    preview = await _preview_token(client, headers, doc["id"], payload)
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "# Ops\n\nchanged\n", "expected_version": 1}, headers=headers)
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={**payload, "proposal_token": preview["proposal_token"]},
        headers=headers,
    )
    assert res.status_code == 409
    # A rejected apply leaves no revision and no new body.
    body = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()["body"]
    assert body == "# Ops\n\nchanged\n"


async def test_apply_rejects_a_future_version_without_side_effects(
    client: AsyncClient, headers: dict
):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    proposal = proposal_id(doc["id"], 99, "append", 0, None, None, "loser")
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={
            "operation": "append",
            "section_index": 0,
            "content": "loser",
            "expected_version": 99,
            "proposal_token": sign_proposal(proposal, secret=settings.secret_key),
        },
        headers=headers,
    )
    assert res.status_code == 409
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert (read["body"], read["version"]) == ("# Ops\n\n_…_\n", 1)
    assert (await client.get(
        f"/api/v1/documents/{doc['id']}/revisions", headers=headers
    )).json() == []


async def test_apply_rejects_a_noop(client: AsyncClient, headers: dict):
    """Replace with the exact same content produces the same body → 400."""
    body = "# Ops\nAlready here.\n\n# End\nfin\n"
    doc = await _create(client, headers, title="Page", body=body)
    payload = {"operation": "replace", "section_index": 0, "content": "Already here.", "expected_version": 1}
    preview = await _preview_token(client, headers, doc["id"], payload)
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={**payload, "proposal_token": preview["proposal_token"]},
        headers=headers,
    )
    assert res.status_code == 400
    assert "would not change" in res.json()["detail"]


async def test_preview_rejects_an_unknown_section(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/preview",
        json={"operation": "append", "section_index": 9, "content": "x", "expected_version": 1},
        headers=headers,
    )
    assert res.status_code == 400
    assert "does not exist" in res.json()["detail"]


async def test_apply_retries_an_earlier_lost_response_without_writing_twice(
    client: AsyncClient, headers: dict
):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n### Backup\n\n_…_\n")
    payload = {
        "operation": "append",
        "section_index": 1,
        "content": "- **Retention** — 30 days",
        "expected_version": 1,
    }
    preview = await _preview_token(client, headers, doc["id"], payload)
    payload["proposal_token"] = preview["proposal_token"]
    first = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply", json=payload, headers=headers
    )
    # The first response was lost; the caller retries the identical request.
    second = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply", json=payload, headers=headers
    )
    assert second.status_code == 200, second.text
    retried = second.json()
    assert retried["retried"] is True
    assert retried["proposal_id"] == first.json()["proposal_id"]
    # The content appears exactly once, not twice.
    body = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()["body"]
    assert body.count("- **Retention** — 30 days") == 1


async def test_apply_does_not_retry_a_different_proposal_on_a_stale_version(
    client: AsyncClient, headers: dict
):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    first_payload = {"operation": "append", "section_index": 0, "content": "first", "expected_version": 1}
    first_preview = await _preview_token(client, headers, doc["id"], first_payload)
    # A different (still validly previewed, against the same version) edit.
    other_payload = {"operation": "append", "section_index": 0, "content": "second", "expected_version": 1}
    other_preview = await _preview_token(client, headers, doc["id"], other_payload)
    await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={**first_payload, "proposal_token": first_preview["proposal_token"]},
        headers=headers,
    )
    # Same expected version, different proposal: must not be mistaken for a
    # lost-response retry of the edit that just committed.
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/sections/apply",
        json={**other_payload, "proposal_token": other_preview["proposal_token"]},
        headers=headers,
    )
    assert res.status_code == 409


async def test_apply_tracks_the_proposal_for_the_gui_to_see(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="# Ops\n\n_…_\n")
    payload = {"operation": "append", "section_index": 0, "content": "new words", "expected_version": 1}
    preview = await _preview_token(client, headers, doc["id"], payload)
    result = (
        await client.post(
            f"/api/v1/documents/{doc['id']}/sections/apply",
            json={**payload, "proposal_token": preview["proposal_token"]},
            headers=headers,
        )
    ).json()
    assert result["version"] == 2
    listing = (await client.get("/api/v1/documents", headers=headers)).json()
    row = next(d for d in listing if d["id"] == doc["id"])
    assert row["version"] == 2


async def test_patch_rejects_a_stale_expected_version(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "second", "expected_version": 1}, headers=headers)
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "third", "expected_version": 1}, headers=headers
    )
    assert res.status_code == 409
    # The newer body is left alone.
    assert (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()["body"] == "second"


async def test_patch_rejects_a_future_expected_version_before_other_fields_mutate(
    client: AsyncClient, headers: dict
):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas", kind="device", device_id=device["id"])
    await client.patch(
        f"/api/v1/scan/pending/{device['id']}", json={"ip": "192.168.1.99"}, headers=headers
    )

    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={
            "body": "loser",
            "title": "also loser",
            "resync_facts": True,
            "expected_version": 99,
        },
        headers=headers,
    )
    assert res.status_code == 409
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert read["title"] == "nas"
    assert read["version"] == 1
    assert read["drifted"] is True
    assert (await client.get(
        f"/api/v1/documents/{doc['id']}/revisions", headers=headers
    )).json() == []


async def test_patch_bumps_the_version_for_body_writers(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="one")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "two", "expected_version": 1}, headers=headers
    )
    assert res.json()["version"] == 2
    above = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "three", "expected_version": 2}, headers=headers
    )
    assert above.json()["version"] == 3


async def test_non_body_patch_does_not_bump_the_version(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas", kind="device", device_id=device["id"])
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"starred": True}, headers=headers)
    assert res.json()["version"] == 1


async def test_a_body_write_without_an_expected_version_is_refused(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "second"}, headers=headers)
    assert res.status_code == 400, res.text
    assert "expected_version" in res.json()["detail"]
    # Nothing was written — the body, the version and the history are untouched.
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert read["body"] == "first"
    assert read["version"] == 1
    assert (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json() == []


async def test_a_stale_body_write_leaves_no_revision_behind(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    winner = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "second", "expected_version": 1}, headers=headers
    )
    assert winner.status_code == 200
    assert winner.json()["version"] == 2
    # A second writer who also read version 1 writes after the winner landed —
    # the overlapping save must be refused, not applied on top.
    loser = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "third", "expected_version": 1}, headers=headers
    )
    assert loser.status_code == 409
    # The refused save neither overwrote the winner nor recorded a revision:
    # no "third" body, version still 2, and a single "edit" in history.
    read = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert read["body"] == "second"
    assert read["version"] == 2
    history = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in history] == ["edit"]


@pytest.mark.parametrize("writer", ["apply", "patch", "restore", "regenerate"])
async def test_an_intervening_transaction_makes_each_body_writer_lose_cleanly(
    writer: str, tmp_path, monkeypatch
):
    """Exercise the CAS window after the route read but before its UPDATE.

    The injected transaction commits a competing body while the request still
    holds its version-1 ORM object. Each route must then lose its conditional
    UPDATE with 409 and roll back the speculative history row without touching
    the search index or facts snapshot.
    """
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / f'{writer}.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    document_id = str(uuid.uuid4())
    revision_id = str(uuid.uuid4())
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with session_factory() as seed:
        seed.add(
            Document(
                id=document_id,
                kind="page",
                title="Page",
                slug="page",
                body="# Ops\n\nbase\n",
                frontmatter={},
                tags=[],
                template_id="blank",
                facts_snapshot={"preserve": "me"},
                version=1,
            )
        )
        seed.add(
            DocumentRevision(
                id=revision_id,
                document_id=document_id,
                title="Page",
                body="# Ops\n\nrestored\n",
                reason="edit",
            )
        )
        await seed.commit()

    original_record_revision = document_routes._record_revision
    winner_committed = False
    indexed: list[str] = []

    async def record_after_winner(db, doc, reason):
        nonlocal winner_committed
        if not winner_committed:
            winner_committed = True
            async with session_factory() as winner_session:
                await winner_session.execute(
                    update(Document)
                    .where(Document.id == document_id, Document.version == 1)
                    .values(body="winner", version=2)
                )
                await winner_session.commit()
        await original_record_revision(db, doc, reason)

    async def track_index(_db, doc):
        indexed.append(doc.body)

    monkeypatch.setattr(document_routes, "_record_revision", record_after_winner)
    monkeypatch.setattr(document_routes.doc_search, "index_document", track_index)

    async with session_factory() as loser_session:
        with pytest.raises(HTTPException) as rejected:
            if writer == "patch":
                await document_routes.update_document(
                    document_id,
                    DocumentUpdate(body="loser", expected_version=1),
                    loser_session,
                    "test",
                )
            elif writer == "restore":
                await document_routes.restore_revision(
                    document_id,
                    revision_id,
                    ExpectedVersionRequest(expected_version=1),
                    loser_session,
                    "test",
                )
            elif writer == "regenerate":
                await document_routes.regenerate_document(
                    document_id,
                    ExpectedVersionRequest(expected_version=1),
                    loser_session,
                    "test",
                )
            else:
                request = SectionApplyRequest(
                    operation="append",
                    section_index=0,
                    content="loser",
                    expected_version=1,
                    proposal_token="placeholder-placeholder",
                )
                proposal = proposal_id(
                    document_id, 1, "append", 0, None, None, "loser"
                )
                request.proposal_token = sign_proposal(proposal, secret=settings.secret_key)
                await document_routes.apply_section_edit(
                    document_id, request, loser_session, "test"
                )

    assert rejected.value.status_code == 409
    assert indexed == []
    async with session_factory() as check:
        stored = await check.get(Document, document_id)
        assert stored is not None
        assert (stored.body, stored.version) == ("winner", 2)
        assert stored.facts_snapshot == {"preserve": "me"}
        revisions = (
            await check.execute(
                select(DocumentRevision).where(
                    DocumentRevision.document_id == document_id,
                    DocumentRevision.id != revision_id,
                )
            )
        ).scalars().all()
        assert revisions == []
    await engine.dispose()
