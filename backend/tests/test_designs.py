import uuid

from httpx import AsyncClient


def node_payload(**kwargs):
    return {"id": str(uuid.uuid4()), "type": "server", "label": "N", "status": "unknown", "pos_x": 0, "pos_y": 0, **kwargs}


def edge_payload(src, tgt, **kwargs):
    return {"id": str(uuid.uuid4()), "source": src, "target": tgt, "type": "ethernet", **kwargs}


async def _create(client: AsyncClient, headers: dict, **body) -> dict:
    res = await client.post("/api/v1/designs", json={"name": "D", **body}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ── auth ──────────────────────────────────────────────────────────────────────

async def test_list_designs_requires_auth(client: AsyncClient):
    res = await client.get("/api/v1/designs")
    assert res.status_code == 401


async def test_create_design_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/designs", json={"name": "X"})
    assert res.status_code == 401


# ── list / create ─────────────────────────────────────────────────────────────

async def test_list_designs_empty(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/designs", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


async def test_create_design_defaults(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Workshop")
    assert design["name"] == "Workshop"
    assert design["design_type"] == "network"
    assert design["icon"] == "dashboard"
    assert "id" in design and design["id"]


async def test_create_design_explicit_type(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Net", design_type="network")
    assert design["design_type"] == "network"


async def test_create_design_with_custom_icon(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Power", icon="zap")
    assert design["icon"] == "zap"


async def test_update_design_changes_icon(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="D", icon="dashboard")
    res = await client.put(f"/api/v1/designs/{design['id']}", json={"icon": "server"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["icon"] == "server"
    # Name left untouched when only icon is sent.
    assert res.json()["name"] == "D"


async def test_update_design_name_and_icon_together(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Old", icon="dashboard")
    res = await client.put(
        f"/api/v1/designs/{design['id']}", json={"name": "New", "icon": "network"}, headers=headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "New"
    assert body["icon"] == "network"


async def test_create_design_creates_empty_canvas_state(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Has Canvas")
    # Loading the new design returns an (empty) canvas without falling back to another design.
    res = await client.get("/api/v1/canvas", params={"design_id": design["id"]}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["nodes"] == []
    assert body["edges"] == []


async def test_list_returns_created_designs_ordered(client: AsyncClient, headers: dict):
    a = await _create(client, headers, name="First")
    b = await _create(client, headers, name="Second")
    listed = (await client.get("/api/v1/designs", headers=headers)).json()
    ids = [d["id"] for d in listed]
    assert ids == [a["id"], b["id"]]


# ── counts in list ──────────────────────────────────────────────────────────

async def test_list_includes_node_group_text_counts(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Counted")
    server = node_payload(label="S", type="server")
    group = node_payload(label="G", type="groupRect")
    text = node_payload(label="T", type="text")
    save = await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [server, group, text], "edges": [], "viewport": {}, "design_id": design["id"]},
        headers=headers,
    )
    assert save.status_code == 200
    listed = (await client.get("/api/v1/designs", headers=headers)).json()
    d = next(x for x in listed if x["id"] == design["id"])
    assert d["node_count"] == 1
    assert d["group_count"] == 1
    assert d["text_count"] == 1


async def test_list_counts_zero_for_empty_design(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Empty")
    listed = (await client.get("/api/v1/designs", headers=headers)).json()
    d = next(x for x in listed if x["id"] == design["id"])
    assert d["node_count"] == 0
    assert d["group_count"] == 0
    assert d["text_count"] == 0


# ── copy ──────────────────────────────────────────────────────────────────────

async def test_copy_requires_auth(client: AsyncClient):
    res = await client.post(f"/api/v1/designs/{uuid.uuid4()}/copy", json={"name": "X"})
    assert res.status_code == 401


async def test_copy_missing_source_returns_404(client: AsyncClient, headers: dict):
    res = await client.post(f"/api/v1/designs/{uuid.uuid4()}/copy", json={"name": "X"}, headers=headers)
    assert res.status_code == 404


async def test_copy_duplicates_nodes_edges_and_remaps_ids(client: AsyncClient, headers: dict):
    source = await _create(client, headers, name="Source", icon="server")
    n1 = node_payload(label="A")
    n2 = node_payload(label="B")
    e1 = edge_payload(n1["id"], n2["id"], label="link")
    save = await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [n1, n2], "edges": [e1], "viewport": {"x": 5, "y": 6, "zoom": 2}, "design_id": source["id"]},
        headers=headers,
    )
    assert save.status_code == 200

    res = await client.post(
        f"/api/v1/designs/{source['id']}/copy", json={"name": "Copy", "icon": "network"}, headers=headers,
    )
    assert res.status_code == 201, res.text
    copy = res.json()
    assert copy["name"] == "Copy"
    assert copy["icon"] == "network"
    assert copy["design_type"] == "network"
    assert copy["id"] != source["id"]

    # Copied canvas has the same shape but fresh node ids, and edge re-pointed.
    canvas = (await client.get("/api/v1/canvas", params={"design_id": copy["id"]}, headers=headers)).json()
    assert {n["label"] for n in canvas["nodes"]} == {"A", "B"}
    copied_ids = {n["id"] for n in canvas["nodes"]}
    assert copied_ids.isdisjoint({n1["id"], n2["id"]})
    assert len(canvas["edges"]) == 1
    edge = canvas["edges"][0]
    assert edge["source"] in copied_ids
    assert edge["target"] in copied_ids
    assert edge["label"] == "link"
    assert canvas["viewport"] == {"x": 5, "y": 6, "zoom": 2}


async def test_copy_remaps_parent_child_relationship(client: AsyncClient, headers: dict):
    source = await _create(client, headers, name="Nested")
    parent = node_payload(label="P", type="proxmox", container_mode=True)
    child = node_payload(label="C", type="vm", parent_id=parent["id"])
    save = await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [parent, child], "edges": [], "viewport": {}, "design_id": source["id"]},
        headers=headers,
    )
    assert save.status_code == 200

    res = await client.post(f"/api/v1/designs/{source['id']}/copy", json={"name": "Copy"}, headers=headers)
    assert res.status_code == 201
    copy = res.json()

    canvas = (await client.get("/api/v1/canvas", params={"design_id": copy["id"]}, headers=headers)).json()
    by_label = {n["label"]: n for n in canvas["nodes"]}
    # Child's parent_id points at the COPIED parent, not the original.
    assert by_label["C"]["parent_id"] == by_label["P"]["id"]
    assert by_label["C"]["parent_id"] != parent["id"]


async def test_copy_leaves_source_untouched(client: AsyncClient, headers: dict):
    source = await _create(client, headers, name="Source")
    n1 = node_payload(label="A")
    await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [n1], "edges": [], "viewport": {}, "design_id": source["id"]},
        headers=headers,
    )
    await client.post(f"/api/v1/designs/{source['id']}/copy", json={"name": "Copy"}, headers=headers)
    src_canvas = (await client.get("/api/v1/canvas", params={"design_id": source["id"]}, headers=headers)).json()
    assert len(src_canvas["nodes"]) == 1
    assert src_canvas["nodes"][0]["id"] == n1["id"]


# ── update ────────────────────────────────────────────────────────────────────

async def test_update_design_renames(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Old Name")
    res = await client.put(f"/api/v1/designs/{design['id']}", json={"name": "New Name"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["name"] == "New Name"


async def test_update_design_missing_returns_404(client: AsyncClient, headers: dict):
    res = await client.put(f"/api/v1/designs/{uuid.uuid4()}", json={"name": "X"}, headers=headers)
    assert res.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────────

async def test_delete_last_design_blocked(client: AsyncClient, headers: dict):
    design = await _create(client, headers, name="Only One")
    res = await client.delete(f"/api/v1/designs/{design['id']}", headers=headers)
    assert res.status_code == 400


async def test_delete_design_missing_returns_404(client: AsyncClient, headers: dict):
    # Need >1 design so we get past nothing; 404 path is checked before the count guard.
    await _create(client, headers, name="Keep")
    res = await client.delete(f"/api/v1/designs/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


async def test_delete_design_removes_its_nodes_edges_and_canvas(client: AsyncClient, headers: dict):
    keep = await _create(client, headers, name="Keep")
    victim = await _create(client, headers, name="Victim")

    # Populate the victim design with nodes + an edge via canvas save.
    n1 = node_payload(label="A")
    n2 = node_payload(label="B")
    e1 = edge_payload(n1["id"], n2["id"])
    save = await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [n1, n2], "edges": [e1], "viewport": {}, "design_id": victim["id"]},
        headers=headers,
    )
    assert save.status_code == 200

    # Populate the kept design too, to prove scoping.
    k1 = node_payload(label="K")
    await client.post(
        "/api/v1/canvas/save",
        json={"nodes": [k1], "edges": [], "viewport": {}, "design_id": keep["id"]},
        headers=headers,
    )

    res = await client.delete(f"/api/v1/designs/{victim['id']}", headers=headers)
    assert res.status_code == 204

    # Victim gone from list.
    listed = (await client.get("/api/v1/designs", headers=headers)).json()
    assert [d["id"] for d in listed] == [keep["id"]]

    # Kept design's node survives untouched.
    kept_canvas = (await client.get("/api/v1/canvas", params={"design_id": keep["id"]}, headers=headers)).json()
    assert len(kept_canvas["nodes"]) == 1
    assert kept_canvas["nodes"][0]["label"] == "K"
