from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from app.schemas.racks import RACK_COLUMNS

# Tallest plate the rack canvas offers; `MAX_RACK_U` on the frontend.
MAX_PLATE_U = 48


class InventoryDeviceResponse(BaseModel):
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
    # Curated device facts (3.3.0). `label`/`type` supersede friendly_name/
    # suggested_type once the user has named the device; the older pair stays for
    # discovery imports and the source filters.
    label: str | None = None
    type: str | None = None
    notes: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool = False
    check_method: str | None = None
    check_target: str | None = None
    # Live reachability, distinct from `status` (the pending/approved/hidden
    # lifecycle).
    status_live: str = "unknown"
    last_seen: datetime | None = None
    last_scan: datetime | None = None
    response_time_ms: int | None = None
    updated_at: datetime | None = None
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
    # Rack modelisation: the front panel this device wears in every rack it is
    # mounted in. The row owns it — see `RackDevice` and `/api/v1/racks`. All
    # None/empty for a device that has never been racked or modelled.
    rack_faceplate_id: str | None = None
    rack_u_height: int | None = None
    rack_col_span: int | None = None
    rack_color: str | None = None
    rack_ports: list[Any] = []

    @field_validator("rack_ports", mode="before")
    @classmethod
    def _coerce_rack_ports(cls, v: Any) -> list[Any]:
        """NULL on every row written before the column existed."""
        return v if isinstance(v, list) else []

    @field_validator("properties", "discovery_sources", "services", mode="before")
    @classmethod
    def _coerce_list(cls, v: Any) -> list[Any]:
        # Legacy rows (columns added by migration) have these = NULL.
        return v if isinstance(v, list) else []

    @field_validator("status_live", mode="before")
    @classmethod
    def _coerce_status_live(cls, v: Any) -> str:
        return v if isinstance(v, str) and v else "unknown"

    @field_validator("show_hardware", mode="before")
    @classmethod
    def _coerce_show_hardware(cls, v: Any) -> bool:
        return bool(v)

    model_config = {"from_attributes": True}


"""Sources a hand-made inventory entry may claim.

``rack`` marks gear created from a rack canvas. Those rows live in the Device
Inventory like any other, but they describe a physical mount rather than a host
on the network, so they are never placed on a logical canvas.
"""
MANUAL_SOURCES = {"manual", "rack"}


class InventoryDeviceCreate(BaseModel):
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
    # Curated fields, so a hand-made entry can carry everything the edit modal
    # shows rather than needing a create-then-PATCH round trip.
    os: str | None = None
    services: list[Any] = []
    friendly_name: str | None = None
    device_subtype: str | None = None
    label: str | None = None
    type: str | None = None
    notes: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool = False
    check_method: str | None = None
    check_target: str | None = None

    @field_validator("discovery_source")
    @classmethod
    def _known_source(cls, v: str) -> str:
        if v not in MANUAL_SOURCES:
            raise ValueError(f"discovery_source must be one of {sorted(MANUAL_SOURCES)}")
        return v


class InventoryDeviceUpdate(BaseModel):
    """Partial edit of an inventory row — the write half of the detail modal.

    Every field is optional and only what the client sends is applied
    (`exclude_unset`), so a caller editing one field never clears the rest.
    Lifecycle (`status`) and discovery bookkeeping (`discovery_source(s)`,
    `discovered_at`, `ieee_address`) are deliberately not editable here: those
    are owned by the approve/hide routes and the importers.
    """

    ip: str | None = None
    mac: str | None = None
    hostname: str | None = None
    os: str | None = None
    label: str | None = None
    type: str | None = None
    suggested_type: str | None = None
    friendly_name: str | None = None
    device_subtype: str | None = None
    model: str | None = None
    vendor: str | None = None
    services: list[Any] | None = None
    properties: list[Any] | None = None
    notes: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool | None = None
    check_method: str | None = None
    check_target: str | None = None
    # Rack modelisation, edited from the Device Inventory as well as from a rack
    # canvas. Sending `rack_faceplate_id` is what models a device; the rest
    # describes the plate it wears.
    rack_faceplate_id: str | None = None
    rack_u_height: int | None = None
    rack_col_span: int | None = None
    rack_color: str | None = None
    rack_ports: list[Any] | None = None

    @field_validator("rack_u_height")
    @classmethod
    def _plate_height(cls, v: int | None) -> int | None:
        if v is not None and not 1 <= v <= MAX_PLATE_U:
            raise ValueError(f"rack_u_height must be between 1 and {MAX_PLATE_U}")
        return v

    @field_validator("rack_col_span")
    @classmethod
    def _plate_span(cls, v: int | None) -> int | None:
        if v is not None and not 1 <= v <= RACK_COLUMNS:
            raise ValueError(f"rack_col_span must be between 1 and {RACK_COLUMNS}")
        return v

    @field_validator("rack_ports")
    @classmethod
    def _plate_ports(cls, v: list[Any] | None) -> list[Any] | None:
        """A port with no id is not a port: no cable could ever name it."""
        if v is None:
            return None
        return [p for p in v if isinstance(p, dict) and p.get("id")]


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
