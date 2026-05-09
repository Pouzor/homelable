from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PendingDeviceResponse(BaseModel):
    id: str
    ip: str | None
    mac: str | None
    hostname: str | None
    os: str | None
    services: list[Any]
    suggested_type: str | None
    status: str
    discovery_source: str | None
    ieee_address: str | None = None
    friendly_name: str | None = None
    device_subtype: str | None = None
    model: str | None = None
    vendor: str | None = None
    lqi: int | None = None
    discovered_at: datetime

    model_config = {"from_attributes": True}


class ScanRunResponse(BaseModel):
    id: str
    status: str
    kind: str = "ip"
    ranges: list[str]
    devices_found: int
    started_at: datetime
    finished_at: datetime | None
    error: str | None

    model_config = {"from_attributes": True}
