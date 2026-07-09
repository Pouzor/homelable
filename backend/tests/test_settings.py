"""Tests for GET/POST /api/v1/settings."""
import json
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.core.config import Settings


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


@pytest.mark.asyncio
async def test_get_settings_returns_service_check_fields(client: AsyncClient, headers):
    res = await client.get("/api/v1/settings", headers=headers)
    data = res.json()
    assert "service_check_enabled" in data
    assert "service_check_interval" in data
    assert isinstance(data["service_check_enabled"], bool)
    assert isinstance(data["service_check_interval"], int)


@pytest.mark.asyncio
async def test_update_settings_saves_service_check_fields(client: AsyncClient, headers):
    with patch("app.api.routes.settings.settings") as mock_settings:
        mock_settings.save_overrides = lambda: None
        res = await client.post(
            "/api/v1/settings",
            json={
                "interval_seconds": 60,
                "service_check_enabled": True,
                "service_check_interval": 600,
            },
            headers=headers,
        )
    assert res.status_code == 200
    body = res.json()
    assert body["service_check_enabled"] is True
    assert body["service_check_interval"] == 600


@pytest.mark.asyncio
async def test_update_settings_rejects_too_short_service_interval(client: AsyncClient, headers):
    res = await client.post(
        "/api/v1/settings",
        json={"interval_seconds": 60, "service_check_enabled": True, "service_check_interval": 5},
        headers=headers,
    )
    assert res.status_code == 422


def test_proxmox_connection_config_is_env_only_never_from_overrides(tmp_path):
    """Connection config (host/port/verify_tls) is env-only: a stale value in
    scan_config.json must be ignored so it can never clobber the env. Only the
    auto-sync activation is read back."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.proxmox_host = "pve.local"  # as if set from env
    s.proxmox_port = 8006
    s.proxmox_verify_tls = True
    (tmp_path / "scan_config.json").write_text(json.dumps({
        "proxmox_host": "stale-host",
        "proxmox_port": 9999,
        "proxmox_verify_tls": False,
        "proxmox_sync_enabled": True,
        "proxmox_sync_interval": 600,
    }))
    s.load_overrides()
    # Connection config untouched by the file (env values survive).
    assert s.proxmox_host == "pve.local"
    assert s.proxmox_port == 8006
    assert s.proxmox_verify_tls is True
    # Auto-sync activation is the only thing loaded.
    assert s.proxmox_sync_enabled is True
    assert s.proxmox_sync_interval == 600


def test_save_overrides_omits_proxmox_connection_config(tmp_path):
    """save_overrides must never write host/port/verify_tls (nor the token) —
    only the sync activation. This is what prevents the dual source of truth."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.proxmox_host = "pve.local"
    s.proxmox_sync_enabled = True
    s.proxmox_sync_interval = 900
    s.save_overrides()
    written = json.loads((tmp_path / "scan_config.json").read_text())
    assert "proxmox_host" not in written
    assert "proxmox_port" not in written
    assert "proxmox_verify_tls" not in written
    assert "proxmox_token_id" not in written
    assert "proxmox_token_secret" not in written
    assert written["proxmox_sync_enabled"] is True
    assert written["proxmox_sync_interval"] == 900
