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