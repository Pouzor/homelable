"""Tests for GET/POST /api/v1/settings."""
from unittest.mock import patch

import pytest
from httpx import AsyncClient


@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_get_settings_requires_auth(client: AsyncClient):
    res = await client.get("/api/v1/settings")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_settings_returns_interval(client: AsyncClient, headers):
    res = await client.get("/api/v1/settings", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "interval_seconds" in data
    assert "scan_interval_seconds" in data
    assert "node_type_colors" in data
    assert "edge_type_colors" in data
    assert isinstance(data["interval_seconds"], int)


@pytest.mark.asyncio
async def test_update_settings_saves_interval(client: AsyncClient, headers):
    with patch("app.api.routes.settings.settings") as mock_settings, \
         patch("app.api.routes.settings.reschedule_status_checks") as mock_reschedule_status, \
         patch("app.api.routes.settings.reschedule_auto_scan") as mock_reschedule_scan:
        mock_settings.status_checker_interval = 60
        mock_settings.scan_interval_seconds = 300
        mock_settings.node_type_colors = {}
        mock_settings.edge_type_colors = {}
        mock_settings.save_overrides = lambda: None
        res = await client.post(
            "/api/v1/settings",
            json={
                "interval_seconds": 120,
                "scan_interval_seconds": 600,
                "node_type_colors": {"router": "#ff6e00"},
                "edge_type_colors": {"wifi": "#39d353"},
            },
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["interval_seconds"] == 120
    assert res.json()["scan_interval_seconds"] == 600
    assert res.json()["node_type_colors"] == {"router": "#ff6e00"}
    assert res.json()["edge_type_colors"] == {"wifi": "#39d353"}
    mock_reschedule_status.assert_called_once_with(120)
    mock_reschedule_scan.assert_called_once_with(600)


@pytest.mark.asyncio
async def test_update_settings_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/settings", json={"interval_seconds": 30})
    assert res.status_code == 401
