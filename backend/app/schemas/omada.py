"""Pydantic v2 schemas for TP-Link Omada SDN Controller import."""

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.omada_service import normalize_omada_url


class OmadaImportModes(BaseModel):
    """Which of the controller's lists to import.

    Clients are opt-in: a busy site lists far more of them than there is gear,
    and they come and go.
    """

    infrastructure: bool = Field(True, description="Adopted gateways, switches and APs")
    clients: bool = Field(False, description="Clients online right now")

    @model_validator(mode="after")
    def _at_least_one(self) -> "OmadaImportModes":
        if not (self.infrastructure or self.clients):
            raise ValueError("Select at least one Omada source to import.")
        return self


def _default_modes() -> OmadaImportModes:
    """Infrastructure only — the conservative default for both entry points."""
    return OmadaImportModes(infrastructure=True, clients=False)


class OmadaConnectionRequest(BaseModel):
    url: str = Field(
        ...,
        description="Controller URL: https://host:8043 (software), https://host (OC200/OC300) "
        "or the cloud interface URL from Platform Integration",
    )
    omada_id: str | None = Field(
        None, description="Omada ID (read from a local controller when blank; required for cloud)"
    )
    client_id: str | None = Field(None, description="Open API client ID (falls back to server env)")
    client_secret: str | None = Field(
        None, description="Open API client secret (falls back to server env)"
    )
    site: str = Field("", description="Site name to import; blank imports every site")
    verify_tls: bool = Field(False, description="Verify TLS certificate (usually false for local controllers)")
    modes: OmadaImportModes = Field(
        default_factory=_default_modes,
        description="Which sources to import (infrastructure only by default)",
    )

    @field_validator("url")
    @classmethod
    def _normalize_url(cls, value: str) -> str:
        return normalize_omada_url(value)


class OmadaTestConnectionResponse(BaseModel):
    connected: bool
    message: str
    # Rows each queried source holds right now, so the import UI can show what
    # a box would pull in. Only the sources asked for are present.
    counts: dict[str, int] = Field(default_factory=dict)


class OmadaImportResponse(BaseModel):
    device_count: int
    pending_created: int
    pending_updated: int
    infra_count: int = 0
    client_count: int = 0


class OmadaConfig(BaseModel):
    url: str
    omada_id: str
    site: str
    verify_tls: bool
    sync_enabled: bool
    sync_interval: int
    credentials_configured: bool
    modes: OmadaImportModes


class OmadaSyncConfig(BaseModel):
    sync_enabled: bool
    sync_interval: int = Field(3600, ge=300, le=86400)
    modes: OmadaImportModes = Field(default_factory=_default_modes)
