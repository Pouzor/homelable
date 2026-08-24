"""Pydantic v2 schemas for Synology DSM import.

Username/password/OTP are accepted on requests only and are optional — when
omitted the backend falls back to the server-configured env credentials. No
response schema ever carries a secret; they are kept out of responses by
structural omission.
"""

from pydantic import BaseModel, ConfigDict, Field


class SynologyConnectionRequest(BaseModel):
    host: str = Field(..., description="Synology NAS hostname or IP")
    port: int = Field(5001, ge=1, le=65535, description="DSM HTTPS port")
    username: str | None = Field(
        None, description="DSM username (falls back to server env)"
    )
    password: str | None = Field(
        None, description="DSM password (falls back to server env)"
    )
    otp_code: str | None = Field(
        None, description="Optional 2FA OTP for one-off imports"
    )
    verify_tls: bool = Field(True, description="Verify the DSM TLS certificate")


class SynologyTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class SynologyNodeOut(BaseModel):
    """A homelable-ready node representation of a Synology NAS or container."""

    model_config = ConfigDict(extra="ignore")

    id: str
    label: str
    type: str  # nas | docker_container
    ieee_address: str
    hostname: str | None = None
    ip: str | None = None
    mac: str | None = None
    status: str
    ram_gb: float | None = None
    disk_gb: float | None = None
    vendor: str | None = None
    model: str | None = None
    parent_ieee: str | None = None
    image: str | None = None
    ports: str | None = None


class SynologyEdgeOut(BaseModel):
    source: str
    target: str


class SynologyImportResponse(BaseModel):
    nodes: list[SynologyNodeOut]
    edges: list[SynologyEdgeOut] = []
    device_count: int


class SynologyImportPendingResponse(BaseModel):
    """Result of importing a Synology NAS into the pending section."""

    pending_created: int
    pending_updated: int
    device_count: int
    links_recorded: int = 0


class SynologyConfig(BaseModel):
    """Non-secret Synology connection + auto-sync config (GET response).

    Connection fields (host/port/verify_tls) are env-only and read-only here —
    surfaced for display. ``credentials_configured`` reflects whether a
    server-side username+password is present. Never carries the password.
    """

    host: str = ""
    port: int = Field(5001, ge=1, le=65535)
    verify_tls: bool = True
    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300)
    credentials_configured: bool = False


class SynologySyncConfig(BaseModel):
    """User-editable auto-sync config (POST body). The ONLY persisted Synology
    settings. Connection fields (host/port/username/password/verify_tls) are
    env-only and are deliberately not accepted here."""

    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300)
