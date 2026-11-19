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
async def test_update_settings_reschedules_status_checks(client: AsyncClient, headers):
    """The new interval must reach the running scheduler, not just the config
    file: otherwise the UI and scan_config.json show the new value while the
    job keeps firing at the old one until the backend restarts."""
    with patch("app.api.routes.settings.settings") as mock_settings, \
            patch("app.api.routes.settings.reschedule_status_checks") as mock_reschedule:
        mock_settings.save_overrides = lambda: None
        res = await client.post(
            "/api/v1/settings",
            json={"interval_seconds": 120},
            headers=headers,
        )
    assert res.status_code == 200
    mock_reschedule.assert_called_once_with(120)


@pytest.mark.asyncio
async def test_update_settings_rejects_too_short_status_interval(client: AsyncClient, headers):
    res = await client.post(
        "/api/v1/settings",
        json={"interval_seconds": 5},
        headers=headers,
    )
    assert res.status_code == 422


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


def test_unifi_connection_config_is_env_only_never_from_overrides(tmp_path):
    """Regression #538: a scan_config.json written before UNIFI_* was set holds
    an empty host and the default port. It must not clobber the env values.
    Only the auto-sync activation and import modes are read back."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.unifi_host = "unifi.lan"  # as if set from env
    s.unifi_port = 443
    s.unifi_site = "home"
    s.unifi_verify_tls = True
    (tmp_path / "scan_config.json").write_text(json.dumps({
        "unifi_host": "",
        "unifi_port": 8443,
        "unifi_site": "default",
        "unifi_verify_tls": False,
        "unifi_sync_enabled": True,
        "unifi_sync_interval": 600,
        "unifi_import_known_clients": True,
    }))
    s.load_overrides()
    assert s.unifi_host == "unifi.lan"
    assert s.unifi_port == 443
    assert s.unifi_site == "home"
    assert s.unifi_verify_tls is True
    assert s.unifi_effective_host == "unifi.lan"
    assert s.unifi_sync_enabled is True
    assert s.unifi_sync_interval == 600
    assert s.unifi_import_known_clients is True


def test_save_overrides_omits_unifi_connection_config(tmp_path):
    """Saving any settings section must not freeze the UniFi connection config
    (nor the credentials) into scan_config.json."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.unifi_host = "unifi.lan"
    s.unifi_password = "secret"
    s.unifi_sync_enabled = True
    s.unifi_sync_interval = 900
    s.save_overrides()
    raw = (tmp_path / "scan_config.json").read_text()
    assert "secret" not in raw
    written = json.loads(raw)
    for key in ("unifi_host", "unifi_port", "unifi_site", "unifi_verify_tls", "unifi_url"):
        assert key not in written
    assert written["unifi_sync_enabled"] is True
    assert written["unifi_sync_interval"] == 900



def _unifi(tmp_path, **env) -> Settings:
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    for key, value in env.items():
        setattr(s, key, value)
    return s


def test_unifi_port_defaults_to_unifi_os(tmp_path):
    """Regression #551: the env path defaulted to 8443, which a UniFi OS gateway
    answers with 404 on both login endpoints. The import form already used 443."""
    s = _unifi(tmp_path, unifi_host="10.0.0.1")
    assert s.unifi_effective_host == "10.0.0.1"
    assert s.unifi_effective_port == 443


@pytest.mark.parametrize(
    ("host", "expected_host", "expected_port"),
    [
        ("10.0.0.1:443", "10.0.0.1", 443),
        ("unifi.lan:8443", "unifi.lan", 8443),
        ("https://10.0.0.1", "10.0.0.1", 9999),
        ("https://10.0.0.1:8443/", "10.0.0.1", 8443),
        (" 10.0.0.1 ", "10.0.0.1", 9999),
        ("fe80::1", "fe80::1", 9999),  # bare IPv6 stays whole
        ("unifi.lan:abc", "unifi.lan:abc", 9999),
    ],
)
def test_unifi_host_may_carry_a_port(tmp_path, host, expected_host, expected_port):
    """Regression #551: UNIFI_HOST=ip:443 was joined with UNIFI_PORT into
    ip:443:8443. A port written in the host wins over UNIFI_PORT."""
    s = _unifi(tmp_path, unifi_host=host, unifi_port=9999)
    assert s.unifi_effective_host == expected_host
    assert s.unifi_effective_port == expected_port


def test_unifi_url_port_wins_else_unifi_port(tmp_path):
    s = _unifi(tmp_path, unifi_url="https://unifi.lan:8443", unifi_host="ignored")
    assert (s.unifi_effective_host, s.unifi_effective_port) == ("unifi.lan", 8443)
    s = _unifi(tmp_path, unifi_url="https://unifi.lan")
    assert (s.unifi_effective_host, s.unifi_effective_port) == ("unifi.lan", 443)
    s = _unifi(tmp_path, unifi_url="https://unifi.lan:bad")
    assert (s.unifi_effective_host, s.unifi_effective_port) == ("unifi.lan", 443)


def test_zigbee_mesh_links_setting_round_trips(tmp_path):
    """The auto-sync mesh-links opt-in is a UI setting: it must survive a restart."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    assert s.zigbee_sync_include_mesh_links is False
    s.zigbee_sync_include_mesh_links = True
    s.save_overrides()
    assert json.loads((tmp_path / "scan_config.json").read_text())["zigbee_sync_include_mesh_links"] is True
    fresh = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    fresh.load_overrides()
    assert fresh.zigbee_sync_include_mesh_links is True

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


# --- Env values arriving still quoted (podman-compose, issue #410) ---


def test_quoted_password_hash_is_unwrapped():
    """podman-compose passes .env quotes through verbatim; Docker Compose strips them."""
    configured = Settings(
        _env_file=None,
        secret_key="test-secret",
        auth_password_hash="'$2b$12$RtMbyw17l4N5UGzeXMNAWuzCaVV.XFBY7ZetWheQhxcBDcxahapkG'",
    )
    assert configured.auth_password_hash == "$2b$12$RtMbyw17l4N5UGzeXMNAWuzCaVV.XFBY7ZetWheQhxcBDcxahapkG"


def test_double_quoted_password_hash_is_unwrapped():
    configured = Settings(
        _env_file=None,
        secret_key="test-secret",
        auth_password_hash='"$2b$12$RtMbyw17l4N5UGzeXMNAWuzCaVV.XFBY7ZetWheQhxcBDcxahapkG"',
    )
    assert configured.auth_password_hash.startswith("$2b$12$")


def test_unquoted_password_hash_is_left_alone():
    raw = "$2b$12$RtMbyw17l4N5UGzeXMNAWuzCaVV.XFBY7ZetWheQhxcBDcxahapkG"
    configured = Settings(_env_file=None, secret_key="test-secret", auth_password_hash=raw)
    assert configured.auth_password_hash == raw


def test_unmatched_quote_is_not_stripped():
    """Only a matched pair is unwrapped, so a truly broken value still fails validation."""
    configured = Settings(
        _env_file=None,
        secret_key="test-secret",
        auth_password_hash="'$2b$12$RtMbyw17l4N5UGzeXMNAWu",
    )
    assert configured.auth_password_hash.startswith("'")


def test_quoted_secret_key_is_unwrapped():
    configured = _valid_oidc_settings(secret_key="'test-secret-key-that-is-at-least-32-bytes'")
    assert configured.secret_key == "test-secret-key-that-is-at-least-32-bytes"


def test_secret_key_length_is_checked_after_unwrapping():
    """The quotes must not pad a too-short key past the 32-byte OIDC floor."""
    with pytest.raises(ValueError, match="SECRET_KEY must be at least 32 bytes"):
        _valid_oidc_settings(secret_key="'" + "a" * 31 + "'")


def test_quoted_oidc_client_secret_is_unwrapped():
    configured = _valid_oidc_settings(oidc_client_secret="'sup3r$ecret'")
    assert configured.oidc_client_secret == "sup3r$ecret"


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", [True, False])
async def test_get_settings_reports_the_status_checker_switch(client: AsyncClient, headers, enabled):
    with patch("app.api.routes.settings.settings") as mock_settings:
        mock_settings.status_checker_enabled = enabled
        mock_settings.status_checker_interval = 60
        mock_settings.service_check_enabled = True
        mock_settings.service_check_interval = 300
        res = await client.get("/api/v1/settings", headers=headers)
    assert res.status_code == 200
    assert res.json()["status_checker_enabled"] is enabled


@pytest.mark.asyncio
async def test_update_settings_cannot_change_the_env_only_switch(client: AsyncClient, headers):
    """STATUS_CHECKER_ENABLED is env-only: a POST carrying the field neither
    persists it nor echoes it back as changed."""
    with patch("app.api.routes.settings.settings") as mock_settings, \
            patch("app.api.routes.settings.reschedule_status_checks"), \
            patch("app.api.routes.settings.set_service_checks_enabled"):
        mock_settings.status_checker_enabled = False
        mock_settings.save_overrides = lambda: None
        res = await client.post(
            "/api/v1/settings",
            json={"interval_seconds": 60, "service_check_enabled": False,
                  "service_check_interval": 300, "status_checker_enabled": True},
            headers=headers,
        )
        assert mock_settings.status_checker_enabled is False
    assert res.status_code == 200
    assert res.json()["status_checker_enabled"] is False


def test_omada_overrides_carry_sync_and_modes_only(tmp_path):
    """The Omada connection config and secret are env-only: saving writes only
    the auto-sync activation and import modes, and loading never reads the rest
    back over the env values."""
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.omada_url = "https://omada.lan:8043"
    s.omada_id = "c1d2"
    s.omada_client_id = "client"
    s.omada_client_secret = "supersecret"
    s.omada_site = "Home"
    s.omada_sync_enabled = True
    s.omada_sync_interval = 900
    s.omada_import_clients = True
    s.save_overrides()
    raw = (tmp_path / "scan_config.json").read_text()
    assert "supersecret" not in raw
    written = json.loads(raw)
    for key in ("omada_url", "omada_id", "omada_client_id", "omada_site", "omada_verify_tls"):
        assert key not in written
    assert written["omada_sync_interval"] == 900
    assert written["omada_import_clients"] is True

    fresh = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    fresh.omada_url = "https://other.lan"
    (tmp_path / "scan_config.json").write_text(json.dumps({
        **written,
        "omada_url": "",
        "omada_site": "Stale",
    }))
    fresh.load_overrides()
    assert fresh.omada_url == "https://other.lan"
    assert fresh.omada_site == ""
    assert fresh.omada_sync_enabled is True
    assert fresh.omada_sync_interval == 900
    assert fresh.omada_import_clients is True


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", ""),
        ("192.168.0.2:8043", "https://192.168.0.2:8043"),
        ("HTTPS://Omada.LAN:8043/", "https://omada.lan:8043"),
        ("https://euw1-omada-northbound.tplinkcloud.com", "https://euw1-omada-northbound.tplinkcloud.com"),
        ("ftp://omada.lan", ""),
    ],
)
def test_omada_effective_url_is_normalized(tmp_path, raw, expected):
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.omada_url = raw
    assert s.omada_effective_url == expected
