"""Pydantic v2 schemas for Z-Wave JS UI (zwavejs2mqtt) import."""

from pydantic import BaseModel, Field, model_validator


class ZwaveImportRequest(BaseModel):
    mqtt_host: str = Field(..., description="MQTT broker hostname or IP address")
    mqtt_port: int = Field(1883, ge=1, le=65535, description="MQTT broker port")
    mqtt_username: str | None = Field(None, description="MQTT username (optional)")
    mqtt_password: str | None = Field(None, description="MQTT password (optional)")
    prefix: str = Field("zwave", description="Z-Wave JS UI MQTT prefix")
    gateway_name: str = Field("zwavejs2mqtt", description="Z-Wave JS UI gateway name")
    mqtt_tls: bool = Field(False, description="Enable TLS (typically port 8883)")
    mqtt_tls_insecure: bool = Field(
        False, description="Skip TLS certificate verification (self-signed only)"
    )

    @model_validator(mode="after")
    def _insecure_requires_tls(self) -> "ZwaveImportRequest":
        if self.mqtt_tls_insecure and not self.mqtt_tls:
            raise ValueError("mqtt_tls_insecure requires mqtt_tls=true")
        return self


class ZwaveTestConnectionRequest(BaseModel):
    mqtt_host: str
    mqtt_port: int = Field(1883, ge=1, le=65535)
    mqtt_username: str | None = None
    mqtt_password: str | None = None
    mqtt_tls: bool = False
    mqtt_tls_insecure: bool = False

    @model_validator(mode="after")
    def _insecure_requires_tls(self) -> "ZwaveTestConnectionRequest":
        if self.mqtt_tls_insecure and not self.mqtt_tls:
            raise ValueError("mqtt_tls_insecure requires mqtt_tls=true")
        return self


class ZwaveNodeOut(BaseModel):
    """A homelable-ready node representation of a Z-Wave device."""

    id: str
    label: str
    type: str  # zwave_coordinator | zwave_router | zwave_enddevice
    ieee_address: str
    friendly_name: str
    device_type: str
    model: str | None = None
    vendor: str | None = None
    lqi: int | None = None
    parent_id: str | None = None


class ZwaveEdgeOut(BaseModel):
    source: str
    target: str


class ZwaveImportResponse(BaseModel):
    nodes: list[ZwaveNodeOut]
    edges: list[ZwaveEdgeOut]
    device_count: int


class ZwaveTestConnectionResponse(BaseModel):
    connected: bool
    message: str


class ZwaveCoordinatorOut(BaseModel):
    id: str
    label: str
    ieee_address: str


class ZwaveImportPendingResponse(BaseModel):
    """Result of importing a Z-Wave network into the pending section."""

    pending_created: int
    pending_updated: int
    coordinator: ZwaveCoordinatorOut | None = None
    coordinator_already_existed: bool = False
    links_recorded: int
    device_count: int
