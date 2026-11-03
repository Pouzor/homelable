"""Per-connection-point labels (#495): the device's own port numbering on a node."""

import uuid

from httpx import AsyncClient

from app.db.database import _NODE_COLUMNS_SQL, _NODE_KEPT
from app.db.models import Node
from app.schemas.utils import MAX_PORT_LABEL_LENGTH, normalize_port_labels, prune_port_labels


def node_payload(**kwargs):
    return {"id": str(uuid.uuid4()), "type": "switch", "label": "sw", "status": "unknown", "pos_x": 0, "pos_y": 0, **kwargs}


async def _save_and_load(client: AsyncClient, headers: dict, node: dict) -> dict:
    res = await client.post("/api/v1/canvas/save", json={"nodes": [node], "edges": [], "viewport": {}}, headers=headers)
    assert res.status_code == 200
    canvas = (await client.get("/api/v1/canvas", headers=headers)).json()
    return canvas["nodes"][0]


# ── normalize / prune ─────────────────────────────────────────────────────────

def test_normalize_keeps_trimmed_labels_on_source_handles():
    assert normalize_port_labels({"top": " 8 ", "bottom-3": "SFP1"}) == {"top": "8", "bottom-3": "SFP1"}


def test_normalize_drops_bad_keys_values_and_blanks():
    raw = {
        "top-t": "a", "bottom-1": "b", "left-02": "c", "cluster-left": "d", "right-65": "e",
        "top": "   ", "bottom": 8, "left": "ok",
    }
    assert normalize_port_labels(raw) == {"left": "ok"}


def test_normalize_truncates_and_handles_non_dicts():
    assert normalize_port_labels({"top": "x" * 20}) == {"top": "x" * MAX_PORT_LABEL_LENGTH}
    assert normalize_port_labels(None) is None
    assert normalize_port_labels(["top"]) is None
    assert normalize_port_labels({}) is None


def test_prune_drops_points_beyond_the_count_and_falls_back_to_defaults():
    labels = {"top": "8", "bottom-3": "3", "left": "x"}
    assert prune_port_labels(labels, {"top": 1, "bottom": 2, "left": None}) == {"top": "8"}
    assert prune_port_labels(labels, {"top": 0, "bottom": 0, "left": 0}) is None
    assert prune_port_labels(None, {}) is None


# ── canvas save ───────────────────────────────────────────────────────────────

async def test_save_canvas_persists_port_labels(client: AsyncClient, headers: dict):
    node = await _save_and_load(
        client, headers,
        node_payload(bottom_handles=7, show_port_numbers=True, port_labels={"top": "8", "bottom-7": "7"}),
    )
    assert node["port_labels"] == {"top": "8", "bottom-7": "7"}


async def test_save_canvas_port_labels_default_to_null(client: AsyncClient, headers: dict):
    node = await _save_and_load(client, headers, node_payload())
    assert node["port_labels"] is None


async def test_save_canvas_cleans_and_prunes_port_labels(client: AsyncClient, headers: dict):
    # A bad entry is dropped, never a 422: it must not cost the whole save.
    node = await _save_and_load(
        client, headers,
        node_payload(bottom_handles=2, port_labels={"top": " 8 ", "bottom-t": "x", "bottom-5": "5", "left": "L"}),
    )
    assert node["port_labels"] == {"top": "8"}


# ── node routes ───────────────────────────────────────────────────────────────

async def test_create_node_with_port_labels(client: AsyncClient, headers: dict):
    res = await client.post(
        "/api/v1/nodes",
        json={"type": "switch", "label": "sw1", "bottom_handles": 3, "port_labels": {"top": "8", "bottom-9": "9"}},
        headers=headers,
    )
    assert res.status_code == 201
    assert res.json()["port_labels"] == {"top": "8"}


async def test_patch_shrink_drops_the_removed_points_labels(client: AsyncClient, headers: dict):
    node_id = (
        await client.post(
            "/api/v1/nodes",
            json={"type": "switch", "label": "sw1", "bottom_handles": 4,
                  "port_labels": {"top": "8", "bottom-2": "2", "bottom-4": "4"}},
            headers=headers,
        )
    ).json()["id"]

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"bottom_handles": 2}, headers=headers)
    assert res.json()["port_labels"] == {"top": "8", "bottom-2": "2"}

    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"top_handles": 0, "bottom_handles": 1}, headers=headers)
    assert res.json()["port_labels"] is None


async def test_patch_labels_are_pruned_against_the_stored_counts(client: AsyncClient, headers: dict):
    node_id = (
        await client.post("/api/v1/nodes", json={"type": "switch", "label": "sw1", "bottom_handles": 2}, headers=headers)
    ).json()["id"]
    res = await client.patch(
        f"/api/v1/nodes/{node_id}", json={"port_labels": {"bottom-2": "2", "bottom-3": "3"}}, headers=headers
    )
    assert res.json()["port_labels"] == {"bottom-2": "2"}


async def test_patch_without_labels_keeps_them(client: AsyncClient, headers: dict):
    node_id = (
        await client.post("/api/v1/nodes", json={"type": "switch", "label": "sw1", "port_labels": {"top": "8"}}, headers=headers)
    ).json()["id"]
    res = await client.patch(f"/api/v1/nodes/{node_id}", json={"label": "sw2"}, headers=headers)
    assert res.json()["port_labels"] == {"top": "8"}


# ── migration ─────────────────────────────────────────────────────────────────

def test_nodes_rebuild_keeps_every_mapped_column():
    # The 3.3.0 legacy-column drop rebuilds `nodes` from an explicit column list;
    # a column missing from it would be silently lost on an upgraded database.
    kept = {c.strip() for c in _NODE_KEPT.split(",")}
    declared = {d.split()[0] for d in _NODE_COLUMNS_SQL.split(",")}
    for column in Node.__table__.columns:
        assert column.name in kept, f"{column.name} missing from _NODE_KEPT"
        assert column.name in declared, f"{column.name} missing from _NODE_COLUMNS_SQL"
