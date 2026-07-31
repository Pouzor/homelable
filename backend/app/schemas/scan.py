from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


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
    # All sources that have observed this device (e.g. ["arp", "proxmox"]). Drives
    # the inventory source filter + badges; falls back to [discovery_source].
    discovery_sources: list[str] = []
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

    @field_validator("properties", "discovery_sources", mode="before")
    @classmethod
    def _coerce_list(cls, v: Any) -> list[Any]:
        # Legacy rows (columns added by migration) have these = NULL.
        return v if isinstance(v, list) else []

    model_config = {"from_attributes": True}


"""Sources a hand-made inventory entry may claim.

``rack`` marks gear created from a rack canvas. Those rows live in the Device
Inventory like any other, but they describe a physical mount rather than a host
on the network, so they are never placed on a logical canvas.
"""
MANUAL_SOURCES = {"manual", "rack"}


class PendingDeviceCreate(BaseModel):
    """Manually add an entry to the Device Inventory.

    Used when the user documents hardware no scan can find — a dumb switch, a
    patch panel, a machine that is powered off. Lands with
    `discovery_source="manual"` (or `"rack"`) so the inventory filters can tell
    it apart.
    """

    hostname: str
    ip: str | None = None
    mac: str | None = None
    suggested_type: str | None = None
    model: str | None = None
    vendor: str | None = None
    properties: list[Any] = []
    discovery_source: str = "manual"

    @field_validator("discovery_source")
    @classmethod
    def _known_source(cls, v: str) -> str:
        if v not in MANUAL_SOURCES:
            raise ValueError(f"discovery_source must be one of {sorted(MANUAL_SOURCES)}")
        return v


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
