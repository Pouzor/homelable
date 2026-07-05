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
    # Display properties carried from discovery (e.g. Proxmox specs). Merged into
    # the node on approve; empty for scan/mesh sources that don't set them.
    properties: list[Any] = []
    discovered_at: datetime
    # Number of distinct canvases (designs) this device already appears on,
    # correlated by ip / ieee_address against existing nodes. Computed per-request.
    canvas_count: int = 0
    # Timestamps from the linked canvas node(s), correlated by ip / ieee_address.
    # Null when the device is not on any canvas yet. Aggregated across matches:
    # created_at = oldest; last_scan / last_modified / last_seen = newest.
    node_created_at: datetime | None = None
    node_last_scan: datetime | None = None
    node_last_modified: datetime | None = None
    node_last_seen: datetime | None = None

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
