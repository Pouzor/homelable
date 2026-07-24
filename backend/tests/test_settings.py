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


def test_mesh_connection_config_is_env_only_never_from_overrides(tmp_path):
    """Zigbee/Z-Wave MQTT connection config (host/port/credentials/topic/tls) is
    env-only: stale values in scan_config.json must be ignored. Only the
    auto-sync activation is read back."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.zigbee_mqtt_host = "broker.local"
    s.zwave_mqtt_host = "broker.local"
    (tmp_path / "scan_config.json").write_text(json.dumps({
        "zigbee_mqtt_host": "stale", "zigbee_mqtt_password": "stale",
        "zigbee_sync_enabled": True, "zigbee_sync_interval": 600,
        "zwave_mqtt_host": "stale", "zwave_mqtt_password": "stale",
        "zwave_sync_enabled": True, "zwave_sync_interval": 700,
    }))
    s.load_overrides()
    assert s.zigbee_mqtt_host == "broker.local"
    assert s.zwave_mqtt_host == "broker.local"
    assert s.zigbee_sync_enabled is True
    assert s.zigbee_sync_interval == 600
    assert s.zwave_sync_enabled is True
    assert s.zwave_sync_interval == 700


def test_save_overrides_omits_mesh_credentials(tmp_path):
    """save_overrides must never write MQTT host/credentials — only the sync
    activation. Prevents the dual source of truth and leaking secrets to disk."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.zigbee_mqtt_host = "broker.local"
    s.zigbee_mqtt_password = "secret"
    s.zigbee_sync_enabled = True
    s.zigbee_sync_interval = 900
    s.zwave_mqtt_password = "secret"
    s.zwave_sync_interval = 1200
    s.save_overrides()
    raw = (tmp_path / "scan_config.json").read_text()
    assert "secret" not in raw
    written = json.loads(raw)
    assert "zigbee_mqtt_host" not in written
    assert "zigbee_mqtt_password" not in written
    assert "zwave_mqtt_password" not in written
    assert written["zigbee_sync_enabled"] is True
    assert written["zigbee_sync_interval"] == 900
    assert written["zwave_sync_interval"] == 1200


def _valid_oidc_settings(**overrides):
    values = {
        "secret_key": "test-secret-key-that-is-at-least-32-bytes",
        "auth_mode": "oidc",
        "oidc_discovery_url": "https://idp.example/application/o/homelable/.well-known/openid-configuration",
        "oidc_client_id": "homelable",
        "oidc_client_secret": "client-secret",
        "oidc_redirect_uri": "https://homelable.example/api/v1/auth/oidc/callback",
        "cors_origins": ["https://homelable.example"],
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_oidc_mode_requires_complete_client_configuration():
    with pytest.raises(ValueError, match="OIDC_DISCOVERY_URL.*OIDC_CLIENT_ID.*OIDC_CLIENT_SECRET.*OIDC_REDIRECT_URI"):
        Settings(secret_key="test-secret", auth_mode="oidc", _env_file=None)


def test_oidc_mode_requires_openid_scope():
    with pytest.raises(ValueError, match="OIDC_SCOPES must contain 'openid'"):
        _valid_oidc_settings(oidc_scopes="profile email")


def test_oidc_mode_requires_strong_session_secret():
    with pytest.raises(ValueError, match="SECRET_KEY must be at least 32 bytes"):
        _valid_oidc_settings(secret_key="too-short")


def test_oidc_secure_cookie_requires_https_callback():
    with pytest.raises(ValueError, match="must use HTTPS"):
        _valid_oidc_settings(oidc_redirect_uri="http://localhost/api/v1/auth/oidc/callback")


def test_oidc_secure_cookie_requires_https_discovery():
    with pytest.raises(ValueError, match="OIDC_DISCOVERY_URL must use HTTPS"):
        _valid_oidc_settings(
            oidc_discovery_url="http://idp.local/application/o/homelable/.well-known/openid-configuration"
        )


def test_oidc_insecure_dev_mode_allows_http_urls():
    configured = _valid_oidc_settings(
        oidc_cookie_secure=False,
        oidc_discovery_url="http://idp.local/.well-known/openid-configuration",
        oidc_redirect_uri="http://localhost/api/v1/auth/oidc/callback",
    )
    assert configured.oidc_cookie_secure is False


def test_oidc_mode_rejects_wildcard_cors():
    with pytest.raises(ValueError, match="CORS_ORIGINS cannot contain"):
        _valid_oidc_settings(cors_origins=["*"])


def test_valid_oidc_configuration_is_accepted():
    configured = _valid_oidc_settings()
    assert configured.auth_mode == "oidc"
    assert configured.oidc_cookie_secure is True
