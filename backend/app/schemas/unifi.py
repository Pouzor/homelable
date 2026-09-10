"""Pydantic v2 schemas for UniFi Network Controller import."""

from pydantic import BaseModel, Field


class UnifiConnectionRequest(BaseModel):
    host: str = Field(..., description="UniFi controller host or IP")
    port: int = Field(8443, ge=1, le=65535, description="Controller port (8443 legacy, 443 UDM)")
    site: str = Field("default", description="UniFi site name")
    username: str | None = Field(None, description="Controller username (falls back to server env)")
    password: str | None = Field(None, description="Controller password (falls back to server env)")
    verify_tls: bool = Field(False, description="Verify TLS certificate (usually false for local controllers)")


class UnifiTestConnectionResponse(BaseModel):
    connected: bool
    message: str


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


class UnifiConfig(BaseModel):
    host: str
    port: int
    site: str
    verify_tls: bool
    sync_enabled: bool
    sync_interval: int
    credentials_configured: bool


class UnifiSyncConfig(BaseModel):
    sync_enabled: bool
    sync_interval: int = Field(3600, ge=300)
