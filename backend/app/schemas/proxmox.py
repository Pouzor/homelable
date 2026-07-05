"""Pydantic v2 schemas for Proxmox VE import.

Token fields are accepted on requests only and are optional — when omitted the
backend falls back to the server-configured token (env). No response schema ever
carries a token; secrets are kept out of responses by structural omission.
"""

from pydantic import BaseModel, Field


class ProxmoxConnectionRequest(BaseModel):
    host: str = Field(..., description="Proxmox VE host or IP")
    port: int = Field(8006, ge=1, le=65535, description="Proxmox API port")
    token_id: str | None = Field(
        None, description="API token id 'user@realm!tokenname' (falls back to server env)"
    )
    token_secret: str | None = Field(
        None, description="API token secret (falls back to server env)"
    )
    verify_tls: bool = Field(True, description="Verify the Proxmox TLS certificate")


class ProxmoxTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class ProxmoxNodeOut(BaseModel):
    """A homelable-ready node representation of a Proxmox host / VM / LXC."""

    id: str
    label: str
    type: str  # proxmox | vm | lxc
    ieee_address: str
    hostname: str | None = None
    ip: str | None = None
    status: str
    cpu_count: int | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    vendor: str | None = None
    model: str | None = None
    parent_ieee: str | None = None


class ProxmoxEdgeOut(BaseModel):
    source: str
    target: str


class ProxmoxImportResponse(BaseModel):
    nodes: list[ProxmoxNodeOut]
    edges: list[ProxmoxEdgeOut]
    device_count: int


class ProxmoxImportPendingResponse(BaseModel):
    """Result of importing a Proxmox inventory into the pending section."""

    pending_created: int
    pending_updated: int
    links_recorded: int
    device_count: int


class ProxmoxConfig(BaseModel):
    """Non-secret Proxmox connection + auto-sync config. Never carries a token —
    ``token_configured`` reflects whether a server-side token is present."""

    host: str = ""
    port: int = Field(8006, ge=1, le=65535)
    verify_tls: bool = True
    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300)
    token_configured: bool = False
