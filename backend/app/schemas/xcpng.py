"""Pydantic v2 schemas for XCP-ng XAPI import.

Credentials (username/password) are never returned by any response schema.
"""

from pydantic import BaseModel, Field


class XcpngConnectionRequest(BaseModel):
    host: str = Field(..., description="XCP-ng host or IP")
    username: str | None = Field(None, description="XAPI username (falls back to server env)")
    password: str | None = Field(None, description="XAPI password (falls back to server env)")
    verify_tls: bool = Field(False, description="Verify the XCP-ng TLS certificate")


class XcpngTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class XcpngNodeOut(BaseModel):
    id: str
    label: str
    type: str  # xcpng | vm
    ieee_address: str
    hostname: str | None = None
    ip: str | None = None
    mac: str | None = None
    status: str
    cpu_count: int | None = None
    ram_gb: float | None = None
    vendor: str | None = None
    model: str | None = None
    parent_ieee: str | None = None
    device_id: str | None = None


class XcpngEdgeOut(BaseModel):
    source: str
    target: str


class XcpngImportResponse(BaseModel):
    nodes: list[XcpngNodeOut]
    edges: list[XcpngEdgeOut]
    device_count: int


class XcpngImportPendingResponse(BaseModel):
    pending_created: int
    pending_updated: int
    links_recorded: int
    device_count: int


class XcpngConfig(BaseModel):
    host: str = ""
    verify_tls: bool = False
    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300)
    credentials_configured: bool = False


class XcpngSyncConfig(BaseModel):
    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300)
