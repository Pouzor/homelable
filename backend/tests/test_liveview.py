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
async def test_liveview_returns_saved_canvas(client: AsyncClient, auth_headers):
    """Canvas saved via POST /canvas/save appears in liveview response."""
    settings.liveview_key = "test-key"
    headers = await auth_headers()

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
