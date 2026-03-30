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
    assert isinstance(data["interval_seconds"], int)


@pytest.mark.asyncio
async def test_update_settings_saves_interval(client: AsyncClient, headers):
    with patch("app.api.routes.settings.settings") as mock_settings:
        mock_settings.status_checker_interval = 60
        mock_settings.save_overrides = lambda: None
        res = await client.post(
            "/api/v1/settings",
            json={"interval_seconds": 120},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["interval_seconds"] == 120


@pytest.mark.asyncio
async def test_update_settings_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/settings", json={"interval_seconds": 30})
    assert res.status_code == 401
