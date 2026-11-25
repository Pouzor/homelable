"""Pydantic v2 schemas for the Tailscale import.

Credentials are accepted on requests only and are optional - when omitted the
backend falls back to the server-configured ones (env). No response schema
ever carries a credential.
"""

from pydantic import BaseModel, Field, field_validator


def _clean_tags(tags: list[str]) -> list[str]:
    """Trim, drop blanks and duplicates, and add the ``tag:`` prefix if missing."""
    out: list[str] = []
    for raw in tags:
        tag = raw.strip()
        if not tag:
            continue
        if not tag.startswith("tag:"):
            tag = f"tag:{tag}"
        if tag not in out:
            out.append(tag)
    return out


class TailscaleFilters(BaseModel):
    include_shared: bool = Field(False, description="Also import devices shared in from another tailnet")
    tags: list[str] = Field(
        default_factory=list,
        description="Only import devices carrying one of these tags (empty imports all)",
    )

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, v: list[str]) -> list[str]:
        return _clean_tags(v)


class TailscaleConnectionRequest(TailscaleFilters):
    api_key: str | None = Field(None, description="API access token (falls back to server env)")
    oauth_client_id: str | None = Field(None, description="OAuth client id (falls back to server env)")
    oauth_client_secret: str | None = Field(None, description="OAuth client secret (falls back to server env)")
    tailnet: str | None = Field(None, description="Tailnet name; '-' for the credential's own (default)")


class TailscaleTestConnectionResponse(BaseModel):
    connected: bool
    message: str
    device_count: int = 0


class TailscaleImportResponse(BaseModel):
    device_count: int
    pending_created: int
    pending_updated: int
    online_count: int = 0


class TailscaleConfig(BaseModel):
    """Non-secret Tailscale config (GET response). Never includes a credential."""

    tailnet: str
    sync_enabled: bool
    sync_interval: int
    include_shared: bool
    tags: list[str]
    credentials_configured: bool


class TailscaleSyncConfig(TailscaleFilters):
    """User-editable auto-sync config (POST body). Credentials are env-only."""

    sync_enabled: bool = False
    sync_interval: int = Field(3600, ge=300, le=86400)
