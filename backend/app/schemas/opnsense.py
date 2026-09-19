"""Pydantic v2 schemas for OPNsense import."""

from pydantic import BaseModel, Field


class OpnsenseImportResponse(BaseModel):
    device_count: int
    pending_created: int
    pending_updated: int


class OpnsenseTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class OpnsenseConfig(BaseModel):
    url: str
    verify_tls: bool
    sync_enabled: bool
    sync_interval: int
    credentials_configured: bool


class OpnsenseSyncConfig(BaseModel):
    sync_enabled: bool
    sync_interval: int = Field(3600, ge=300)
