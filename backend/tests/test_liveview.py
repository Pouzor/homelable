"""
Tests for the /api/v1/liveview read-only canvas endpoint.

The endpoint is:
  - Disabled by default (LIVEVIEW_KEY not set) → 403
  - Returns 403 for missing or wrong key even when enabled
  - Returns canvas data for a valid key (no JWT required)
"""

import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.fixture(autouse=True)
def reset_liveview_key():
    """Restore liveview_key after each test so tests are isolated."""
    original = settings.liveview_key
    yield
    settings.liveview_key = original


# ── Disabled (no key configured) ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_liveview_disabled_by_default(client: AsyncClient):
    settings.liveview_key = None
    res = await client.get("/api/v1/liveview?key=anything")
    assert res.status_code == 403
    assert res.json()["detail"] == "Live view is disabled"


@pytest.mark.asyncio
async def test_liveview_disabled_when_key_empty(client: AsyncClient):
    settings.liveview_key = ""
    res = await client.get("/api/v1/liveview?key=anything")
    assert res.status_code == 403
    assert res.json()["detail"] == "Live view is disabled"


# ── Enabled but wrong / missing key ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_liveview_wrong_key(client: AsyncClient):
    settings.liveview_key = "correct-secret"
    res = await client.get("/api/v1/liveview?key=wrong-key")
    assert res.status_code == 403
    assert res.json()["detail"] == "Invalid live view key"


@pytest.mark.asyncio
async def test_liveview_missing_key_param(client: AsyncClient):
    settings.liveview_key = "correct-secret"
    res = await client.get("/api/v1/liveview")
    assert res.status_code == 403
    assert res.json()["detail"] == "Invalid live view key"


# ── Valid key — no JWT needed ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_liveview_valid_key_returns_canvas(client: AsyncClient):
    settings.liveview_key = "my-secret-key"
    res = await client.get("/api/v1/liveview?key=my-secret-key")
    assert res.status_code == 200
    data = res.json()
    assert "nodes" in data
    assert "edges" in data
    assert "viewport" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)


@pytest.mark.asyncio
async def test_liveview_does_not_require_jwt(client: AsyncClient):
    """Accessing without Authorization header must work when key is correct."""
    settings.liveview_key = "open-sesame"
    # client has no auth headers set here
    res = await client.get("/api/v1/liveview?key=open-sesame")
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_liveview_returns_saved_canvas(client: AsyncClient, headers):
    """Canvas saved via POST /canvas/save appears in liveview response."""
    settings.liveview_key = "test-key"

    # Save a canvas with one node
    payload = {
        "nodes": [{
            "id": "lv-node-1",
            "type": "server",
            "label": "Live Node",
            "status": "online",
            "services": [],
            "pos_x": 10,
            "pos_y": 20,
        }],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    await client.post("/api/v1/canvas/save", json=payload, headers=headers)

    # Liveview should return the same node
    res = await client.get("/api/v1/liveview?key=test-key")
    assert res.status_code == 200
    nodes = res.json()["nodes"]
    assert len(nodes) == 1
    assert nodes[0]["id"] == "lv-node-1"
    assert nodes[0]["label"] == "Live Node"


# ── custom_style + theme propagation ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_liveview_returns_custom_style_and_theme(client: AsyncClient, headers):
    """custom_style and viewport.theme_id from a saved canvas surface in liveview."""
    settings.liveview_key = "test-key"
    payload = {
        "nodes": [],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1, "theme_id": "matrix"},
        "custom_style": {"fontFamily": "Inter", "nodeRadius": 12},
    }
    await client.post("/api/v1/canvas/save", json=payload, headers=headers)

    res = await client.get("/api/v1/liveview?key=test-key")
    assert res.status_code == 200
    body = res.json()
    assert body["viewport"].get("theme_id") == "matrix"
    assert body["custom_style"] == {"fontFamily": "Inter", "nodeRadius": 12}


# ── Re-disable after enabling ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_liveview_disabled_after_key_cleared(client: AsyncClient):
    settings.liveview_key = "was-enabled"
    res = await client.get("/api/v1/liveview?key=was-enabled")
    assert res.status_code == 200

    settings.liveview_key = None
    res = await client.get("/api/v1/liveview?key=was-enabled")
    assert res.status_code == 403
    assert res.json()["detail"] == "Live view is disabled"


# ── /config (authenticated) — key used to build share links ──────────────────

@pytest.mark.asyncio
async def test_liveview_config_requires_auth(client: AsyncClient):
    """The config endpoint exposes the key, so it must reject unauthenticated calls."""
    settings.liveview_key = "secret"
    res = await client.get("/api/v1/liveview/config")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_liveview_config_returns_key_when_enabled(client: AsyncClient, headers):
    settings.liveview_key = "share-me"
    res = await client.get("/api/v1/liveview/config", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body == {"enabled": True, "key": "share-me"}


@pytest.mark.asyncio
async def test_liveview_config_disabled_hides_key(client: AsyncClient, headers):
    settings.liveview_key = None
    res = await client.get("/api/v1/liveview/config", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": False, "key": None}


@pytest.mark.asyncio
async def test_liveview_config_empty_key_disabled(client: AsyncClient, headers):
    settings.liveview_key = ""
    res = await client.get("/api/v1/liveview/config", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"enabled": False, "key": None}


# ── design_id selects which canvas is rendered ───────────────────────────────

@pytest.mark.asyncio
async def test_liveview_design_id_selects_canvas(client: AsyncClient, headers):
    """?design_id=<id> renders that design's canvas, not the first one."""
    settings.liveview_key = "test-key"

    # Create two designs
    d1 = (await client.post("/api/v1/designs", json={"name": "Network"}, headers=headers)).json()
    d2 = (await client.post("/api/v1/designs", json={"name": "Electrical"}, headers=headers)).json()

    # Save a distinct node into each design
    for design, node_id, label in ((d1, "n-net", "Net Node"), (d2, "n-elec", "Elec Node")):
        payload = {
            "nodes": [{
                "id": node_id,
                "type": "server",
                "label": label,
                "status": "online",
                "services": [],
                "pos_x": 0,
                "pos_y": 0,
            }],
            "edges": [],
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "design_id": design["id"],
        }
        await client.post("/api/v1/canvas/save", json=payload, headers=headers)

    # Requesting d2 returns only the electrical node
    res = await client.get(f"/api/v1/liveview?key=test-key&design_id={d2['id']}")
    assert res.status_code == 200
    nodes = res.json()["nodes"]
    assert [n["id"] for n in nodes] == ["n-elec"]

    # Requesting d1 returns only the network node
    res = await client.get(f"/api/v1/liveview?key=test-key&design_id={d1['id']}")
    assert res.status_code == 200
    nodes = res.json()["nodes"]
    assert [n["id"] for n in nodes] == ["n-net"]
