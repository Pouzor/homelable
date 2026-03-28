"""
Integration tests — run against a live Docker stack.

Skipped unless INTEGRATION_BASE_URL is set (done automatically in docker-ci.yml).

Usage (local):
    INTEGRATION_BASE_URL=http://localhost:8000 \
    INTEGRATION_USERNAME=admin \
    INTEGRATION_PASSWORD=your-password \
    pytest backend/tests/test_integration.py -v
"""

import os

import httpx
import pytest

BASE_URL = os.environ.get("INTEGRATION_BASE_URL", "")
USERNAME = os.environ.get("INTEGRATION_USERNAME", "admin")
_PASSWORD_RAW = os.environ.get("INTEGRATION_PASSWORD", "")

pytestmark = pytest.mark.skipif(
    not BASE_URL,
    reason="INTEGRATION_BASE_URL not set — skipping live-stack tests",
)


def _require_password() -> str:
    if not _PASSWORD_RAW:
        pytest.fail("INTEGRATION_PASSWORD env var is required for live-stack tests")
    return _PASSWORD_RAW


PASSWORD = _PASSWORD_RAW  # resolved at call time via _require_password() in fixture


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def token() -> str:
    pw = _require_password()
    res = httpx.post(
        f"{BASE_URL}/api/v1/auth/login",
        json={"username": USERNAME, "password": pw},
        timeout=10,
    )
    assert res.status_code == 200, f"Login failed ({res.status_code}): {res.text}"
    return res.json()["access_token"]


@pytest.fixture(scope="module")
def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def restored_canvas(auth):
    """Save the current canvas before the test and restore it afterward."""
    before = httpx.get(f"{BASE_URL}/api/v1/canvas", headers=auth, timeout=10).json()
    yield
    httpx.post(f"{BASE_URL}/api/v1/canvas/save", json=before, headers=auth, timeout=10)


def _save_canvas(auth, nodes, edges=None):
    payload = {
        "nodes": nodes,
        "edges": edges or [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    res = httpx.post(f"{BASE_URL}/api/v1/canvas/save", json=payload, headers=auth, timeout=10)
    assert res.status_code == 200, f"Canvas save failed ({res.status_code}): {res.text}"
    return res


def _node(node_id: str, label: str, node_type: str = "server", **extra) -> dict:
    """Build a NodeSave-compatible dict (flat API format, not React Flow format)."""
    return {
        "id": node_id,
        "type": node_type,
        "label": label,
        "status": "unknown",
        "services": [],
        "pos_x": extra.pop("pos_x", 0),
        "pos_y": extra.pop("pos_y", 0),
        **extra,
    }


# ── Health ────────────────────────────────────────────────────────────────────

def test_health_endpoint():
    res = httpx.get(f"{BASE_URL}/api/v1/health", timeout=10)
    assert res.status_code == 200


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_login_returns_token():
    pw = _require_password()
    res = httpx.post(
        f"{BASE_URL}/api/v1/auth/login",
        json={"username": USERNAME, "password": pw},
        timeout=10,
    )
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_bad_credentials():
    res = httpx.post(
        f"{BASE_URL}/api/v1/auth/login",
        json={"username": USERNAME, "password": "definitely-wrong"},
        timeout=10,
    )
    assert res.status_code == 401


def test_protected_route_without_token():
    res = httpx.get(f"{BASE_URL}/api/v1/canvas", timeout=10)
    assert res.status_code == 401


# ── Canvas round-trip ─────────────────────────────────────────────────────────

def test_canvas_load_returns_valid_structure(auth):
    res = httpx.get(f"{BASE_URL}/api/v1/canvas", headers=auth, timeout=10)
    assert res.status_code == 200
    data = res.json()
    assert "nodes" in data
    assert "edges" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)


def test_canvas_save_and_reload(auth, restored_canvas):
    _save_canvas(auth, [_node("integ-node-1", "CI Server", pos_x=100, pos_y=200)])

    data = httpx.get(f"{BASE_URL}/api/v1/canvas", headers=auth, timeout=10).json()
    assert len(data["nodes"]) == 1

    node = data["nodes"][0]
    assert node["id"] == "integ-node-1"
    assert node["label"] == "CI Server"
    assert node["type"] == "server"
    assert node["pos_x"] == 100
    assert node["pos_y"] == 200


def test_canvas_save_preserves_node_dimensions(auth, restored_canvas):
    """Width/height survive a save→reload cycle through the real DB."""
    _save_canvas(auth, [
        _node("resized-node", "Big Router", node_type="router", width=320.0, height=150.0)
    ])

    nodes = httpx.get(f"{BASE_URL}/api/v1/canvas", headers=auth, timeout=10).json()["nodes"]
    node = next((n for n in nodes if n["id"] == "resized-node"), None)
    assert node is not None
    assert node["width"] == 320.0
    assert node["height"] == 150.0


def test_canvas_save_with_edge(auth, restored_canvas):
    _save_canvas(
        auth,
        nodes=[
            _node("n-src", "Router", node_type="router"),
            _node("n-dst", "Server", node_type="server", pos_x=200),
        ],
        edges=[{
            "id": "e-eth",
            "source": "n-src",
            "target": "n-dst",
            "type": "ethernet",
        }],
    )

    data = httpx.get(f"{BASE_URL}/api/v1/canvas", headers=auth, timeout=10).json()
    assert len(data["edges"]) == 1
    edge = data["edges"][0]
    # EdgeResponse uses source/target (not source_id/target_id)
    assert edge["source"] == "n-src"
    assert edge["target"] == "n-dst"
    assert edge["type"] == "ethernet"
