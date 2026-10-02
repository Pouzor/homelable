"""The update-from-device endpoints (#484).

Three-way merge on the wire: a preview that changes nothing, an apply that only
saves a fully reviewed merge, and a staleness guard that refuses to run a
resolution made against a document that moved on.
"""

from httpx import AsyncClient


async def _device(client: AsyncClient, headers: dict, **body) -> dict:
    payload = {"label": "nas-01", "hostname": "nas-01.lan", "ip": "192.168.1.20", "discovery_source": "manual", **body}
    res = await client.post("/api/v1/scan/pending", json=payload, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()


async def _doc(client: AsyncClient, headers: dict, device: dict) -> dict:
    res = await client.post(
        "/api/v1/documents", json={"title": "nas", "kind": "device", "device_id": device["id"]}, headers=headers
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _set_ip(client: AsyncClient, headers: dict, device: dict, ip: str) -> None:
    res = await client.patch(f"/api/v1/scan/pending/{device['id']}", json={"ip": ip}, headers=headers)
    assert res.status_code == 200, res.text


async def _edit_ip(client: AsyncClient, headers: dict, doc: dict, ip: str) -> dict:
    body = doc["body"].replace("| IP | 192.168.1.20 |", f"| IP | {ip} |")
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": body}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def _preview(client: AsyncClient, headers: dict, doc_id: str, **kwargs) -> dict:
    res = await client.post(f"/api/v1/documents/{doc_id}/update-preview", json=kwargs, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ── auth and guards ─────────────────────────────────────────────────────────


async def test_preview_requires_auth(client: AsyncClient):
    assert (await client.post("/api/v1/documents/x/update-preview", json={})).status_code == 401


async def test_apply_requires_auth(client: AsyncClient):
    assert (await client.post("/api/v1/documents/x/update-from-device", json={})).status_code == 401


async def test_preview_of_an_unknown_document_is_404(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents/x/update-preview", json={}, headers=headers)
    assert res.status_code == 404


async def test_apply_of_an_unknown_document_is_404(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents/x/update-from-device", json={"preview_id": "x"}, headers=headers)
    assert res.status_code == 404


async def test_preview_of_a_plain_page_is_rejected(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents", json={"title": "Notes"}, headers=headers)
    doc = res.json()
    res = await client.post(f"/api/v1/documents/{doc['id']}/update-preview", json={}, headers=headers)
    assert res.status_code == 400


async def test_apply_of_a_plain_page_is_rejected(client: AsyncClient, headers: dict):
    res = await client.post("/api/v1/documents", json={"title": "Notes"}, headers=headers)
    doc = res.json()
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device", json={"preview_id": "x"}, headers=headers
    )
    assert res.status_code == 400


# ── preview ─────────────────────────────────────────────────────────────────


async def test_a_stable_device_previews_no_changes(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    preview = await _preview(client, headers, doc["id"])
    assert preview["unresolved"] == []
    assert all(c["status"] in ("same", "auto") for c in preview["changes"])
    # An untouched document: the merge is the document.
    assert preview["proposed_body"] == doc["body"]


async def test_an_untouched_field_is_offered_for_automatic_application(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _set_ip(client, headers, device, "192.168.1.99")

    preview = await _preview(client, headers, doc["id"])
    ip = next(c for c in preview["changes"] if c["id"] == "device-info.IP")
    assert ip["status"] == "auto"
    assert ip["device"] == "192.168.1.99"
    assert preview["unresolved"] == []
    assert "| IP | 192.168.1.99 |" in preview["proposed_body"]


async def test_a_user_edit_against_a_device_change_is_a_conflict(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _edit_ip(client, headers, doc, "192.168.1.20 (jump host)")
    await _set_ip(client, headers, device, "192.168.1.99")

    preview = await _preview(client, headers, doc["id"])
    ip = next(c for c in preview["changes"] if c["id"] == "device-info.IP")
    assert ip["status"] == "conflict"
    assert ip["documented"] == "192.168.1.20 (jump host)"
    assert ip["device"] == "192.168.1.99"
    assert preview["unresolved"] == ["device-info.IP"]
    # An unresolved merge keeps the user's text — the preview is a draft.
    assert "192.168.1.20 (jump host)" in preview["proposed_body"]


async def test_a_preview_folds_resolutions_in(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _edit_ip(client, headers, doc, "192.168.1.20 (jump host)")
    await _set_ip(client, headers, device, "192.168.1.99")

    preview = await _preview(
        client, headers, doc["id"],
        resolutions=[{"id": "device-info.IP", "choice": "custom", "custom": "10.9.8.7 (lan) "}],
    )
    ip = next(c for c in preview["changes"] if c["id"] == "device-info.IP")
    assert ip["resolution"] == "custom"
    assert preview["unresolved"] == []
    assert "| IP | 10.9.8.7 (lan) |" in preview["proposed_body"]


# ── apply ───────────────────────────────────────────────────────────────────


async def test_apply_lands_an_automatic_merge(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _set_ip(client, headers, device, "192.168.1.99")
    preview_id = (await _preview(client, headers, doc["id"]))["preview_id"]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": preview_id, "resolutions": []},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    updated = res.json()
    assert "| IP | 192.168.1.99 |" in updated["body"]
    # The device is recorded as documented again — the drift banner clears.
    assert updated["facts_snapshot"]["ip"] == "192.168.1.99"
    assert updated["drifted"] is False
    assert (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()["drifted"] is False

    # The old body is in history, flagged as a sync.
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in revisions] == ["sync"]


async def test_apply_records_a_durable_decision(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _edit_ip(client, headers, doc, "192.168.1.20 (primary)")
    await _set_ip(client, headers, device, "192.168.1.99")

    preview = await _preview(
        client, headers, doc["id"],
        resolutions=[{"id": "device-info.IP", "choice": "keep"}],
    )
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": preview["preview_id"], "resolutions": [{"id": "device-info.IP", "choice": "keep"}]},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert "| IP | 192.168.1.20 (primary) |" in res.json()["body"]


async def test_a_kept_value_is_surfaced_again_on_the_next_change(client: AsyncClient, headers: dict):
    """The baseline is the generated body, never the merged one, so a deliberate
    keep is not permanent blindness — the next device move asks once more."""
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _edit_ip(client, headers, doc, "192.168.1.20 (primary)")
    await _set_ip(client, headers, device, "192.168.1.99")

    preview = await _preview(client, headers, doc["id"])
    assert preview["unresolved"] == ["device-info.IP"]

    # User keeps their note and applies.
    preview = await _preview(client, headers, doc["id"], resolutions=[{"id": "device-info.IP", "choice": "keep"}])
    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": preview["preview_id"], "resolutions": [{"id": "device-info.IP", "choice": "keep"}]},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert "192.168.1.20 (primary)" in res.json()["body"]

    # Device stays put: the kept value is quiet.
    steady = await _preview(client, headers, doc["id"])
    assert steady["unresolved"] == []

    # The device moves again: the kept value is in question once more.
    await _set_ip(client, headers, device, "192.168.1.120")
    later = await _preview(client, headers, doc["id"])
    assert later["unresolved"] == ["device-info.IP"]


async def test_kept_hostname_is_acknowledged_once_per_ip_change(client: AsyncClient, headers: dict):
    """Each Keep records the current IP as baseline without losing the hostname."""
    device = await _device(
        client,
        headers,
        label="homelabcluster",
        hostname="homelabcluster.example.lan",
        ip="192.168.10.10",
    )
    doc = await _doc(client, headers, device)
    hostname = "homelabcluster.example.lan"
    edited_body = doc["body"].replace("| IP | 192.168.10.10 |", f"| IP | {hostname} |")
    edit = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": edited_body}, headers=headers
    )
    assert edit.status_code == 200, edit.text

    # The original baseline was .10, so the reviewed .20 needs an initial Keep.
    await _set_ip(client, headers, device, "192.168.10.20")
    first = await _preview(client, headers, doc["id"])
    assert first["unresolved"] == ["device-info.IP"]
    applied = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": first["preview_id"], "resolutions": [{"id": "device-info.IP", "choice": "keep"}]},
        headers=headers,
    )
    assert applied.status_code == 200, applied.text
    assert f"| IP | {hostname} |" in applied.json()["body"]

    # The prior body is recoverable through the global revision URL, not a
    # document-nested lookalike route.
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    sync = next(revision for revision in revisions if revision["reason"] == "sync")
    previous = await client.get(f"/api/v1/documents/revisions/{sync['id']}", headers=headers)
    assert previous.status_code == 200, previous.text
    assert previous.json()["body"] == edited_body

    quiet = await _preview(client, headers, doc["id"])
    assert quiet["unresolved"] == []

    await _set_ip(client, headers, device, "192.168.10.25")
    second = await _preview(client, headers, doc["id"])
    assert second["unresolved"] == ["device-info.IP"]
    applied = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": second["preview_id"], "resolutions": [{"id": "device-info.IP", "choice": "keep"}]},
        headers=headers,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["facts_snapshot"]["ip"] == "192.168.10.25"
    assert (await _preview(client, headers, doc["id"]))["unresolved"] == []

    await _set_ip(client, headers, device, "192.168.10.30")
    later = await _preview(client, headers, doc["id"])
    assert later["unresolved"] == ["device-info.IP"]


async def test_apply_rejects_a_stale_preview(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _set_ip(client, headers, device, "192.168.1.99")
    preview_id = (await _preview(client, headers, doc["id"]))["preview_id"]

    # The document is edited while the preview is open.
    res = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"body": doc["body"] + "\n"}, headers=headers
    )
    assert res.status_code == 200, res.text

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": preview_id, "resolutions": []},
        headers=headers,
    )
    assert res.status_code == 409


async def test_apply_rejects_unresolved_conflicts(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    await _edit_ip(client, headers, doc, "192.168.1.20 (jump host)")
    await _set_ip(client, headers, device, "192.168.1.99")
    preview_id = (await _preview(client, headers, doc["id"]))["preview_id"]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": preview_id, "resolutions": []},
        headers=headers,
    )
    assert res.status_code == 400
    assert "IP address" in res.json()["detail"]


async def test_apply_rejects_a_device_change_made_while_the_preview_was_open(
    client: AsyncClient, headers: dict
):
    """A device that moves on during review is a different review thread.

    The preview id binds the live device facts and generated context the
    proposal was computed from — not just the document state — so applying an
    old resolution to a device that changed must fail with 409 and save
    nothing: no body change and no history entry.
    """
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    doc = await _edit_ip(client, headers, doc, "nas.example.lan")
    await _set_ip(client, headers, device, "192.168.1.30")

    preview = await _preview(
        client, headers, doc["id"], resolutions=[{"id": "device-info.IP", "choice": "device"}]
    )
    await _set_ip(client, headers, device, "192.168.1.40")
    # The device moved on, so a fresh preview is a different id now.
    fresh = await _preview(client, headers, doc["id"])
    assert preview["preview_id"] != fresh["preview_id"]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={
            "preview_id": preview["preview_id"],
            "resolutions": [{"id": "device-info.IP", "choice": "device"}],
        },
        headers=headers,
    )
    assert res.status_code == 409
    # Nothing landed: the un-reviewed .40 is not in the body, the user edit
    # survives, drift is untouched and no sync history was written.
    current = (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()
    assert "| IP | 192.168.1.40 |" not in current["body"]
    assert "| IP | nas.example.lan |" in current["body"]
    assert current["drifted"] is True
    # No sync history was written — the rejected apply recorded nothing, only
    # the user's own earlier body edit exists.
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in revisions] == ["edit"]


async def test_apply_rejects_a_generated_content_only_device_change(
    client: AsyncClient, headers: dict
):
    """A device edit that only changes the *rendered* document binds too.

    The device notes print into the generated body but are deliberately absent
    from `facts_snapshot`, so changing them between preview and apply is a
    rendered-content-only change: only a preview id that binds the generated
    body itself can reject it.
    """
    device = await _device(client, headers)
    doc = await _doc(client, headers, device)
    res = await client.patch(
        f"/api/v1/scan/pending/{device['id']}", json={"notes": "serve the home media"}, headers=headers
    )
    assert res.status_code == 200, res.text

    preview = await _preview(client, headers, doc["id"])
    res = await client.patch(
        f"/api/v1/scan/pending/{device['id']}",
        json={"notes": "serve the home media — NFS too"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    # Same facts, same context — only the rendered body differs.
    fresh = await _preview(client, headers, doc["id"])
    assert preview["preview_id"] != fresh["preview_id"]

    res = await client.post(
        f"/api/v1/documents/{doc['id']}/update-from-device",
        json={"preview_id": preview["preview_id"], "resolutions": []},
        headers=headers,
    )
    assert res.status_code == 409
    # Nothing landed: the body is untouched and no sync history was written.
    assert (await client.get(f"/api/v1/documents/{doc['id']}", headers=headers)).json()["body"] == doc["body"]
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=headers)).json()
    assert [r["reason"] for r in revisions] == []
