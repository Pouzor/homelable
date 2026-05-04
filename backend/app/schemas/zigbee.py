"""Pydantic v2 schemas for Zigbee2MQTT import."""

from pydantic import BaseModel, Field


class ZigbeeImportRequest(BaseModel):
    mqtt_host: str = Field(..., description="MQTT broker hostname or IP address")
    mqtt_port: int = Field(1883, ge=1, le=65535, description="MQTT broker port")
    mqtt_username: str | None = Field(None, description="MQTT username (optional)")
    mqtt_password: str | None = Field(None, description="MQTT password (optional)")
    base_topic: str = Field("zigbee2mqtt", description="Zigbee2MQTT base topic")


class ZigbeeTestConnectionRequest(BaseModel):
    mqtt_host: str
    mqtt_port: int = Field(1883, ge=1, le=65535)
    mqtt_username: str | None = None
    mqtt_password: str | None = None


class ZigbeeDeviceData(BaseModel):
    ieee_address: str
    friendly_name: str
    device_type: str  # Coordinator, Router, EndDevice
    model: str | None = None
    vendor: str | None = None
    description: str | None = None
    lqi: int | None = None
    last_seen: str | None = None


class ZigbeeNodeOut(BaseModel):
    """A homelable-ready node representation of a Zigbee device."""

    id: str
    label: str
    type: str  # zigbee_coordinator | zigbee_router | zigbee_enddevice
    ieee_address: str
    friendly_name: str
    device_type: str
    model: str | None = None
    vendor: str | None = None
    lqi: int | None = None
    parent_id: str | None = None


class ZigbeeEdgeOut(BaseModel):
    source: str
    target: str


class ZigbeeImportResponse(BaseModel):
    nodes: list[ZigbeeNodeOut]
    edges: list[ZigbeeEdgeOut]
    device_count: int


class ZigbeeTestConnectionResponse(BaseModel):
    connected: bool
    message: str
