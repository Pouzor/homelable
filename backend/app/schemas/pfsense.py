"""Pydantic v2 schemas for pfSense import."""

from pydantic import BaseModel, Field


class PfsenseImportResponse(BaseModel):
    device_count: int
    pending_created: int
    pending_updated: int


class PfsenseTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class PfsenseConfig(BaseModel):
    url: str
    verify_tls: bool
    sync_enabled: bool
    sync_interval: int
    credentials_configured: bool


class PfsenseSyncConfig(BaseModel):
    sync_enabled: bool
    sync_interval: int = Field(3600, ge=300)
