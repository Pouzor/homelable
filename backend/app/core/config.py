import json
import logging
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

def _read_version() -> str:
    for candidate in [
        Path(__file__).parent.parent.parent.parent / "VERSION",  # repo root (dev)
        Path("/app/VERSION"),                                      # Docker image
    ]:
        if candidate.exists():
            return candidate.read_text().strip()
    return "unknown"

APP_VERSION = _read_version()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    secret_key: str  # Required — set SECRET_KEY in .env
    sqlite_path: str = "./data/homelab.db"
    # Uploaded media (floor plans, and future raw image uploads) live on disk,
    # not in the DB. Defaults to a `uploads/` folder next to the SQLite DB so it
    # sits on the same persistent Docker volume. Override with UPLOAD_DIR.
    upload_dir: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # JWT
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440  # 24h

    # Auth — set AUTH_USERNAME and AUTH_PASSWORD_HASH in .env
    auth_mode: Literal["local", "oidc"] = "local"
    auth_username: str = "admin"
    auth_password_hash: str = ""

    # OpenID Connect — required only when AUTH_MODE=oidc.
    oidc_discovery_url: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = ""
    oidc_scopes: str = "openid profile email"
    oidc_cookie_secure: bool = True
    oidc_session_expire_minutes: int = Field(default=480, ge=5, le=1440)
    oidc_transaction_expire_seconds: int = Field(default=600, ge=60, le=3600)

    @model_validator(mode="after")
    def validate_auth_settings(self) -> "Settings":
        h = self.auth_password_hash
        if h and not h.startswith("$2"):
            logger.error(
                "AUTH_PASSWORD_HASH looks invalid (does not start with '$2b$'). "
                "bcrypt hashes contain '$' signs — wrap the value in single quotes "
                "in your .env file: AUTH_PASSWORD_HASH='$2b$12$...'"
            )
        if self.auth_mode == "oidc":
            required = {
                "OIDC_DISCOVERY_URL": self.oidc_discovery_url,
                "OIDC_CLIENT_ID": self.oidc_client_id,
                "OIDC_CLIENT_SECRET": self.oidc_client_secret,
                "OIDC_REDIRECT_URI": self.oidc_redirect_uri,
            }
            missing = [name for name, value in required.items() if not value]
            if missing:
                raise ValueError(f"AUTH_MODE=oidc requires: {', '.join(missing)}")
            if len(self.secret_key.encode("utf-8")) < 32:
                raise ValueError("SECRET_KEY must be at least 32 bytes when AUTH_MODE=oidc")
            if "openid" not in self.oidc_scopes.split():
                raise ValueError("OIDC_SCOPES must contain 'openid'")
            for name, value in {
                "OIDC_DISCOVERY_URL": self.oidc_discovery_url,
                "OIDC_REDIRECT_URI": self.oidc_redirect_uri,
            }.items():
                if not value.startswith(("https://", "http://")):
                    raise ValueError(f"{name} must be an HTTP(S) URL")
            if self.oidc_cookie_secure and not self.oidc_redirect_uri.startswith("https://"):
                raise ValueError("OIDC_REDIRECT_URI must use HTTPS when OIDC_COOKIE_SECURE=true")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS cannot contain '*' when AUTH_MODE=oidc")
        return self

    # Scanner
    scanner_ranges: list[str] = ["192.168.1.0/24"]

    # Phase-2 version-detection (-sV) host timeout, seconds. Bounds the version
    # pass so a stalling TLS port (e.g. Proxmox 8006) can't hang it. Discovered
    # ports survive a timeout regardless; raise this on slow/overlay networks.
    scanner_version_host_timeout: int = 60

    # Deep scan — persisted defaults (overridable per-scan from the scan dialog).
    # http_ranges: extra nmap port ranges, opt-in, no default. Probe + TLS off by default.
    scanner_http_ranges: list[str] = []
    scanner_http_probe_enabled: bool = False
    scanner_http_verify_tls: bool = False

    # Status checker
    status_checker_interval: int = 60

    # Per-service status checker (independent of node checks). Off by default.
    service_check_enabled: bool = False
    service_check_interval: int = 300

    # MCP service key — set MCP_SERVICE_KEY in .env
    # Used by the MCP server to authenticate against the backend without a user password.
    # Leave empty to disable MCP service key auth.
    mcp_service_key: str = ""

    # Live view — optional read-only public canvas endpoint.
    # Set to a random secret string to enable /api/v1/liveview?key=<value>.
    # Leave unset (or empty) to keep the feature disabled (default).
    liveview_key: str | None = None

    # Homepage widget — optional read-only stats endpoint for gethomepage.
    # Set to a random secret to enable /api/v1/stats/summary (X-API-Key header).
    # Leave empty to keep the feature disabled (default).
    homepage_api_key: str = ""

    # Proxmox VE import.
    # Token = a real credential → env/.env ONLY, never persisted by the app to
    # scan_config.json and never returned by the API. token_id is
    # 'user@realm!tokenname'; use a read-only PVEAuditor role.
    proxmox_token_id: str = ""
    proxmox_token_secret: str = ""
    # Non-secret connection + auto-sync config (persisted via save_overrides).
    proxmox_host: str = ""
    proxmox_port: int = 8006
    proxmox_verify_tls: bool = True
    proxmox_sync_enabled: bool = False
    proxmox_sync_interval: int = 3600  # seconds (floor 300 enforced on write)

    # Zigbee2MQTT auto-sync import.
    # MQTT credentials are secrets → env/.env ONLY, never persisted by the app to
    # scan_config.json and never returned by the API. Only the auto-sync
    # activation (enabled + interval) is persisted; connection config is env-only.
    zigbee_mqtt_host: str = ""
    zigbee_mqtt_port: int = 1883
    zigbee_mqtt_username: str = ""
    zigbee_mqtt_password: str = ""
    zigbee_base_topic: str = "zigbee2mqtt"
    zigbee_mqtt_tls: bool = False
    zigbee_mqtt_tls_insecure: bool = False
    zigbee_sync_enabled: bool = False
    zigbee_sync_interval: int = 3600  # seconds (floor 300 enforced on write)

    # Z-Wave JS UI (zwavejs2mqtt) auto-sync import. Same secret/env rules.
    zwave_mqtt_host: str = ""
    zwave_mqtt_port: int = 1883
    zwave_mqtt_username: str = ""
    zwave_mqtt_password: str = ""
    zwave_prefix: str = "zwave"
    zwave_gateway_name: str = "zwavejs2mqtt"
    zwave_mqtt_tls: bool = False
    zwave_mqtt_tls_insecure: bool = False
    zwave_sync_enabled: bool = False
    zwave_sync_interval: int = 3600  # seconds (floor 300 enforced on write)

    def _override_path(self) -> Path:
        return Path(self.sqlite_path).parent / "scan_config.json"

    def media_dir(self) -> Path:
        """On-disk folder for uploaded media. Sits on the same persistent
        volume as the SQLite DB unless UPLOAD_DIR is set."""
        if self.upload_dir:
            return Path(self.upload_dir)
        return Path(self.sqlite_path).parent / "uploads"

    def load_overrides(self) -> None:
        """Load runtime scan config overrides written by the API."""
        try:
            data = json.loads(self._override_path().read_text())
            if "scanner_ranges" in data:
                self.scanner_ranges = data["scanner_ranges"]
            if "status_checker_interval" in data:
                self.status_checker_interval = int(data["status_checker_interval"])
            if "service_check_enabled" in data:
                self.service_check_enabled = bool(data["service_check_enabled"])
            if "service_check_interval" in data:
                self.service_check_interval = int(data["service_check_interval"])
            if "scanner_http_ranges" in data:
                self.scanner_http_ranges = list(data["scanner_http_ranges"])
            if "scanner_http_probe_enabled" in data:
                self.scanner_http_probe_enabled = bool(data["scanner_http_probe_enabled"])
            if "scanner_http_verify_tls" in data:
                self.scanner_http_verify_tls = bool(data["scanner_http_verify_tls"])
            # Proxmox auto-sync activation only. Connection config (host, port,
            # token, verify_tls) is env-only by design — never read from or
            # written to this file. Persisting host here previously created a
            # dual source of truth that silently clobbered PROXMOX_HOST.
            if "proxmox_sync_enabled" in data:
                self.proxmox_sync_enabled = bool(data["proxmox_sync_enabled"])
            if "proxmox_sync_interval" in data:
                self.proxmox_sync_interval = int(data["proxmox_sync_interval"])
            # Zigbee/Z-Wave: only the auto-sync activation is persisted. MQTT
            # connection config (host, port, credentials, topic, tls) is env-only
            # by design — never read from or written to this file.
            if "zigbee_sync_enabled" in data:
                self.zigbee_sync_enabled = bool(data["zigbee_sync_enabled"])
            if "zigbee_sync_interval" in data:
                self.zigbee_sync_interval = int(data["zigbee_sync_interval"])
            if "zwave_sync_enabled" in data:
                self.zwave_sync_enabled = bool(data["zwave_sync_enabled"])
            if "zwave_sync_interval" in data:
                self.zwave_sync_interval = int(data["zwave_sync_interval"])
        except Exception:
            pass

    def save_overrides(self) -> None:
        """Persist scan config so it survives container restarts."""
        self._override_path().parent.mkdir(parents=True, exist_ok=True)
        self._override_path().write_text(json.dumps({
            "scanner_ranges": self.scanner_ranges,
            "status_checker_interval": self.status_checker_interval,
            "service_check_enabled": self.service_check_enabled,
            "service_check_interval": self.service_check_interval,
            "scanner_http_ranges": self.scanner_http_ranges,
            "scanner_http_probe_enabled": self.scanner_http_probe_enabled,
            "scanner_http_verify_tls": self.scanner_http_verify_tls,
            # Proxmox: only the auto-sync activation is persisted. Connection
            # config (host, port, token, verify_tls) is env-only and must never
            # be written to disk — that is the single source of truth.
            "proxmox_sync_enabled": self.proxmox_sync_enabled,
            "proxmox_sync_interval": self.proxmox_sync_interval,
            # Zigbee/Z-Wave: only the auto-sync activation is persisted. MQTT
            # connection config (host/port/credentials/topic/tls) is env-only.
            "zigbee_sync_enabled": self.zigbee_sync_enabled,
            "zigbee_sync_interval": self.zigbee_sync_interval,
            "zwave_sync_enabled": self.zwave_sync_enabled,
            "zwave_sync_interval": self.zwave_sync_interval,
        }))


settings = Settings()  # type: ignore[call-arg]
