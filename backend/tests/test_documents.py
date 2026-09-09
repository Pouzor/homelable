"""The documents API.

Covers what the plan promises the user: a document per device generated once,
a Library tree that cannot be knotted, history that survives a restore, and a
document that outlives the device it describes.
"""

import uuid

from httpx import AsyncClient


async def _device(client: AsyncClient, headers: dict, **body) -> dict:
    payload = {"label": "nas-01", "hostname": "nas-01.lan", "ip": "192.168.1.20", "discovery_source": "manual", **body}
    res = await client.post("/api/v1/scan/pending", json=payload, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()


async def _create(client: AsyncClient, headers: dict, **body) -> dict:
    res = await client.post("/api/v1/documents", json={"title": "Page", **body}, headers=headers)
    assert res.status_code == 201, res.text
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


# ── update ──────────────────────────────────────────────────────────────────


async def test_editing_the_body_refreshes_the_frontmatter_cache(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "---\ntags: [x]\n---\n\nnew"}, headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["tags"] == ["x"]


async def test_the_body_renames_the_document(client: AsyncClient, headers: dict):
    """`title:` in the frontmatter is the only place a document is named."""
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "---\ntitle: SMB / CIFS\n---\n\n# SMB / CIFS\n"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["title"] == "SMB / CIFS"
    assert res.json()["slug"] == "smb-cifs"


async def test_a_body_without_a_title_keeps_the_one_it_has(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "---\ntags: [x]\n---\n\nnew"}, headers=headers
    )
    assert res.json()["title"] == "Page"


async def test_a_blank_title_in_the_body_is_ignored(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": "---\ntitle: '   '\n---\n\nnew"}, headers=headers
    )
    assert res.json()["title"] == "Page"


async def test_an_explicit_title_wins_over_the_body_in_the_same_request(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page")
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"title": "Chosen", "body": "---\ntitle: From the body\n---\n\nnew"},
        headers=headers,
    )
    assert res.json()["title"] == "Chosen"


async def test_a_device_document_renamed_in_its_body_keeps_its_device(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "---\ntitle: The big NAS\n---\n\n# The big NAS\n"},
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
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "my words"}, headers=headers)
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
    res = await client.post(f"/api/v1/documents/{doc['id']}/regenerate", headers=headers)
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
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "second"}, headers=headers)
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert len(revisions) == 1
    assert revisions[0]["reason"] == "edit"
    stored = (await client.get(f"/api/v1/documents/revisions/{revisions[0]['id']}", headers=headers)).json()
    assert stored["body"] == "first"


async def test_saving_an_unchanged_body_records_nothing(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="same")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "same"}, headers=headers)
    assert (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json() == []


async def test_restoring_brings_back_an_old_body_and_is_itself_undoable(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="first")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "second"}, headers=headers)
    revision = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()[0]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore", headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["body"] == "first"

    history = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in history][0] == "restore"


async def test_restoring_brings_back_the_title_that_body_carried(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Page", body="---\ntitle: First name\n---\n\nfirst")
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        json={"body": "---\ntitle: Second name\n---\n\nsecond"},
        headers=headers,
    )
    revision = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()[0]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore", headers=headers
    )
    assert res.json()["title"] == "First name"


async def test_restoring_a_revision_of_another_document_is_404(client: AsyncClient, headers: dict):
    a = await _create(client, headers, title="A", body="one")
    b = await _create(client, headers, title="B", body="one")
    await client.patch(f"/api/v1/documents/{a['id']}", json={"body": "two"}, headers=headers)
    revision = (await client.get(f"/api/v1/documents/{a['id']}/revisions", headers=headers)).json()[0]
    res = await client.post(f"/api/v1/documents/{b['id']}/revisions/{revision['id']}/restore", headers=headers)
    assert res.status_code == 404


async def test_history_is_pruned_to_the_limit(client: AsyncClient, headers: dict):
    from app.services.doc_tree import REVISION_LIMIT

    doc = await _create(client, headers, title="Page", body="v0")
    for i in range(1, REVISION_LIMIT + 6):
        await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": f"v{i}"}, headers=headers)
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
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "everything I wrote"}, headers=headers)

    res = await client.post(f"/api/v1/documents/{doc['id']}/regenerate", headers=headers)
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

    res = await client.post(f"/api/v1/documents/{doc['id']}/regenerate", headers=headers)
    assert "192.168.1.99" in res.json()["body"]
    # Regenerating documents the device as it is now, so the drift is gone.
    assert res.json()["facts_snapshot"]["ip"] == "192.168.1.99"


async def test_regenerating_keeps_the_replaced_body_in_the_history(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="VLAN plan", body="my own words")
    await client.post(f"/api/v1/documents/{doc['id']}/regenerate", headers=headers)

    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert revisions[0]["reason"] == "regenerate"
    stored = (await client.get(f"/api/v1/documents/revisions/{revisions[0]['id']}", headers=headers)).json()
    assert stored["body"] == "my own words"


async def test_regenerating_a_library_page_uses_its_template(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Restart the NAS", template_id="runbook")
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "gone"}, headers=headers)

    res = await client.post(f"/api/v1/documents/{doc['id']}/regenerate", headers=headers)
    assert res.status_code == 200, res.text
    assert "gone" not in res.json()["body"]
    assert "# Restart the NAS" in res.json()["body"]
    assert res.json()["template_id"] == "runbook"


async def test_regenerating_a_folder_is_rejected(client: AsyncClient, headers: dict):
    folder = await _create(client, headers, title="Runbooks", kind="folder")
    res = await client.post(f"/api/v1/documents/{folder['id']}/regenerate", headers=headers)
    assert res.status_code == 400


async def test_regenerating_an_unknown_document_is_404(client: AsyncClient, headers: dict):
    res = await client.post(f"/api/v1/documents/{uuid.uuid4()}/regenerate", headers=headers)
    assert res.status_code == 404


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
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": "written by hand"}, headers=headers)
    assert (await client.get("/api/v1/documents/coverage", headers=headers)).json()["header_only"] == 0


async def test_coverage_counts_library_pages_separately(client: AsyncClient, headers: dict):
    await _create(client, headers, title="VLAN plan")
    await _create(client, headers, title="Runbooks", kind="folder")
    assert (await client.get("/api/v1/documents/coverage", headers=headers)).json()["library_pages"] == 2
