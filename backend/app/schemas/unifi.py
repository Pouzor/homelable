"""Pydantic v2 schemas for UniFi Network Controller import."""

from pydantic import BaseModel, Field, model_validator


class UnifiImportModes(BaseModel):
    """Which of the controller's three inventories to import.

    They answer different questions, so they are opt-in separately:
    ``stat/device`` is the adopted gear, ``list/user`` every client ever seen
    (no IP, and long on a real site), ``stat/sta`` the live sessions.
    """

    infrastructure: bool = Field(True, description="stat/device — adopted APs, switches, gateways")
    known_clients: bool = Field(False, description="list/user — every client the controller knows")
    active_clients: bool = Field(False, description="stat/sta — clients connected right now")

    @model_validator(mode="after")
    def _at_least_one(self) -> "UnifiImportModes":
        if not (self.infrastructure or self.known_clients or self.active_clients):
            raise ValueError("Select at least one UniFi source to import.")
        return self


def _default_modes() -> UnifiImportModes:
    """Infrastructure only — the conservative default for both entry points."""
    return UnifiImportModes(infrastructure=True, known_clients=False, active_clients=False)


class UnifiConnectionRequest(BaseModel):
    host: str = Field(..., description="UniFi controller host or IP")
    port: int = Field(8443, ge=1, le=65535, description="Controller port (8443 legacy, 443 UDM)")
    site: str = Field("default", description="UniFi site name")
    username: str | None = Field(None, description="Controller username (falls back to server env)")
    password: str | None = Field(None, description="Controller password (falls back to server env)")
    verify_tls: bool = Field(False, description="Verify TLS certificate (usually false for local controllers)")
    modes: UnifiImportModes = Field(
        default_factory=_default_modes,
        description="Which sources to import (infrastructure only by default)",
    )


class UnifiTestConnectionResponse(BaseModel):
    connected: bool
    message: str
    # Rows each queried source holds right now, so the import UI can show what
    # a box would pull in. Only the sources asked for are present.
    counts: dict[str, int] = Field(default_factory=dict)


class UnifiDeviceOut(BaseModel):
    ieee_address: str
    mac: str | None = None
    ip: str | None = None
    hostname: str | None = None
    label: str | None = None
    type: str
    vendor: str | None = None
    model: str | None = None
    raw_type: str | None = None


class UnifiImportResponse(BaseModel):
    device_count: int
    pending_created: int
    pending_updated: int
    infra_count: int = 0
    client_count: int = 0


class UnifiConfig(BaseModel):
    host: str
    port: int
    site: str
    verify_tls: bool
    sync_enabled: bool
    sync_interval: int
    credentials_configured: bool
    modes: UnifiImportModes


class UnifiSyncConfig(BaseModel):
    sync_enabled: bool
    sync_interval: int = Field(3600, ge=300)
    modes: UnifiImportModes = Field(default_factory=_default_modes)
