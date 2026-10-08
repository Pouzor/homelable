"""Pydantic v2 schemas for the Unraid import.

The API key is accepted on requests only and is optional - when omitted the
backend falls back to the server-configured key (env), for the configured host
only. No response schema ever carries the key.
"""

from typing import Any

from pydantic import BaseModel, Field


class UnraidConnectionRequest(BaseModel):
    host: str = Field(..., description="Unraid server host or IP")
    port: int | None = Field(None, ge=1, le=65535, description="Unraid port (default 443 for HTTPS, 80 for HTTP)")
    api_key: str | None = Field(None, description="Unraid API key (falls back to server env)")
    # Off by default, like Unraid's own "Use SSL/TLS" setting.
    use_https: bool = Field(False, description="Talk to the Unraid API over HTTPS")
    # Off by default: Unraid's own certificate is self-signed. HTTPS only.
    verify_tls: bool = Field(False, description="Verify the Unraid TLS certificate")
    # Stopped containers and VMs: imported (and, in canvas mode, listed) like
    # running ones, or left out entirely.
    include_offline: bool = True

    @property
    def effective_port(self) -> int:
        return self.port or (443 if self.use_https else 80)


class UnraidTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class UnraidNodeOut(BaseModel):
    """A homelable-ready node for the Unraid host or one of its containers."""

    id: str
    label: str
    type: str  # docker_host | docker_container | vm
    ieee_address: str
    hostname: str | None = None
    ip: str | None = None
    status: str
    vendor: str | None = None
    model: str | None = None
    parent_ieee: str | None = None
    # The Device Inventory row this node draws, stamped by the import.
    device_id: str | None = None
    # The row's lists, so the node's first canvas save writes them back intact.
    services: list[dict[str, Any]] = []
    properties: list[dict[str, Any]] = []


class UnraidEdgeOut(BaseModel):
    source: str
    target: str


class UnraidImportResponse(BaseModel):
    nodes: list[UnraidNodeOut]
    edges: list[UnraidEdgeOut]
    device_count: int
    # Why VMs were left out (e.g. the key has no VM access); None when they weren't.
    notice: str | None = None


class UnraidImportPendingResponse(BaseModel):
    pending_created: int
    pending_updated: int
    links_recorded: int
    device_count: int


class UnraidConfig(BaseModel):
    """Non-secret Unraid connection + auto-sync config (GET response)."""

    host: str = ""
    port: int = Field(80, ge=1, le=65535)
    use_https: bool = False
    verify_tls: bool = False
    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300)
    include_offline: bool = True
    api_key_configured: bool = False


class UnraidSyncConfig(BaseModel):
    """User-editable auto-sync config (POST body). Connection fields are env-only."""

    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300, le=86400)
    include_offline: bool = True
