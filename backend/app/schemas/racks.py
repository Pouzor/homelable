from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, field_validator, model_validator

# Kept in sync with the frontend rack model (frontend/src/types).
WIDTH_STANDARDS = {"19", "10"}
NUMBERINGS = {"bottom-up", "top-down"}
CABLE_TYPES = {"ethernet", "fiber"}
# When a mount draws its ports; "auto" leaves the faceplate in charge.
PORT_VISIBILITIES = {"auto", "always", "hover"}
# 12-column horizontal grid: full = 12, half = 6, third = 4, quarter = 3.
RACK_COLUMNS = 12


class RackSave(BaseModel):
    id: str
    name: str
    u_height: int = 42
    width_standard: str = "19"
    numbering: str = "bottom-up"
    location: str | None = None
    style: dict[str, Any] = {}
    pos_x: float = 0
    pos_y: float = 0

    @field_validator("u_height")
    @classmethod
    def _positive_height(cls, v: int) -> int:
        if not 1 <= v <= 100:
            raise ValueError("u_height must be between 1 and 100")
        return v

    @field_validator("width_standard")
    @classmethod
    def _known_width(cls, v: str) -> str:
        if v not in WIDTH_STANDARDS:
            raise ValueError(f"width_standard must be one of {sorted(WIDTH_STANDARDS)}")
        return v

    @field_validator("numbering")
    @classmethod
    def _known_numbering(cls, v: str) -> str:
        if v not in NUMBERINGS:
            raise ValueError(f"numbering must be one of {sorted(NUMBERINGS)}")
        return v


class RackDeviceSave(BaseModel):
    id: str
    rack_id: str
    device_id: str | None = None
    node_id: str | None = None
    label: str
    u_start: int = 1
    u_height: int = 1
    col_start: int = 0
    col_span: int = RACK_COLUMNS
    faceplate_id: str = "blank-1u"
    color: str | None = None
    status: str = "unknown"
    port_visibility: str = "auto"
    ports: list[Any] = []

    @field_validator("port_visibility", mode="before")
    @classmethod
    def _known_port_visibility(cls, v: Any) -> str:
        """Anything unknown — including the NULL of a pre-column row — is `auto`."""
        return str(v) if v in PORT_VISIBILITIES else "auto"

    @field_validator("u_start", "u_height")
    @classmethod
    def _positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("u_start and u_height are 1-based and must be >= 1")
        return v

    @field_validator("col_start")
    @classmethod
    def _column_in_grid(cls, v: int) -> int:
        if not 0 <= v < RACK_COLUMNS:
            raise ValueError(f"col_start must be within the {RACK_COLUMNS}-column grid")
        return v

    @field_validator("col_span")
    @classmethod
    def _span_in_grid(cls, v: int) -> int:
        if not 1 <= v <= RACK_COLUMNS:
            raise ValueError(f"col_span must be between 1 and {RACK_COLUMNS}")
        return v

    @model_validator(mode="after")
    def _fits_the_column_grid(self) -> "RackDeviceSave":
        """`col_start` and `col_span` are legal apart and still illegal together.

        11 + 12 spans to column 23 of a 12-column grid — each field passes its
        own check, and the frontend serializer clamps them independently, so
        nothing caught it before this.
        """
        if self.col_start + self.col_span > RACK_COLUMNS:
            raise ValueError(
                f"col_start + col_span must not exceed the {RACK_COLUMNS}-column grid"
            )
        return self


class RackCableSave(BaseModel):
    id: str
    from_device_id: str
    from_port_id: str
    to_device_id: str
    to_port_id: str
    type: str = "ethernet"
    color: str = "#39d353"
    label: str | None = None
    label_visible: bool = False
    # [{key, value, icon, visible}] — free-form, same shape as node properties.
    properties: list[dict[str, Any]] = []

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in CABLE_TYPES:
            raise ValueError(f"type must be one of {sorted(CABLE_TYPES)}")
        return v

    @field_validator("properties", mode="before")
    @classmethod
    def _clean_properties(cls, v: Any) -> list[dict[str, Any]]:
        """Keep only usable records — a property with no key draws an empty badge."""
        if not isinstance(v, list):
            return []
        return [p for p in v if isinstance(p, dict) and str(p.get("key", "")).strip()]


class RackSaveRequest(BaseModel):
    """Full rack state for one design — upserted, with anything missing pruned.

    Same contract as ``POST /api/v1/canvas/save``: the client owns the state and
    sends all of it on an explicit Save.
    """

    design_id: str
    racks: list[RackSave] = []
    devices: list[RackDeviceSave] = []
    cables: list[RackCableSave] = []
    # Pan/zoom, stored on the design's shared CanvasState row like the logical canvas.
    viewport: dict[str, Any] = {}

    @model_validator(mode="after")
    def _devices_fit_their_rack(self) -> "RackSaveRequest":
        """A mount must fit inside the rack it names.

        `RackDeviceSave` validates each field in isolation and never sees the
        rack, so `u_start: 40` in a 12U rack passed. A mount above the top rail
        draws outside the chassis and nothing in the UI can drag it back, so the
        server refuses to store it. Rack membership itself is checked in the
        route, which knows what is already persisted.
        """
        heights = {r.id: r.u_height for r in self.racks}
        for device in self.devices:
            u_height = heights.get(device.rack_id)
            if u_height is None:
                continue  # unknown rack — the route reports that with a 400
            if device.u_start + device.u_height - 1 > u_height:
                raise ValueError(
                    f"Device {device.id} does not fit in rack {device.rack_id}: "
                    f"U {device.u_start}–{device.u_start + device.u_height - 1} "
                    f"of {u_height}U"
                )
        return self

    @model_validator(mode="after")
    def _devices_do_not_overlap(self) -> "RackSaveRequest":
        """Two mounts may not claim the same square of a rack.

        The canvas already refuses such a drop (`canPlace`), so this is the same
        rule stated where the state is persisted rather than where it is dragged
        — a stale tab, a hand-built payload or a bug upstream would otherwise
        store two plates drawn on top of each other, with no way to grab the one
        underneath.
        """
        by_rack: dict[str, list[RackDeviceSave]] = {}
        for device in self.devices:
            by_rack.setdefault(device.rack_id, []).append(device)
        for mounts in by_rack.values():
            for i, a in enumerate(mounts):
                for b in mounts[i + 1 :]:
                    if (
                        a.u_start < b.u_start + b.u_height
                        and b.u_start < a.u_start + a.u_height
                        and a.col_start < b.col_start + b.col_span
                        and b.col_start < a.col_start + a.col_span
                    ):
                        raise ValueError(
                            f"Devices {a.id} and {b.id} overlap in rack {a.rack_id}"
                        )
        return self


class RackResponse(BaseModel):
    id: str
    design_id: str
    name: str
    u_height: int
    width_standard: str
    numbering: str
    location: str | None = None
    style: dict[str, Any] = {}
    pos_x: float
    pos_y: float

    @field_validator("style", mode="before")
    @classmethod
    def _coerce_style(cls, v: Any) -> dict[str, Any]:
        return v if isinstance(v, dict) else {}

    model_config = {"from_attributes": True}


class RackDeviceResponse(BaseModel):
    id: str
    design_id: str
    rack_id: str
    device_id: str | None = None
    node_id: str | None = None
    label: str
    u_start: int
    u_height: int
    col_start: int
    col_span: int
    faceplate_id: str
    color: str | None = None
    status: str
    port_visibility: str = "auto"
    ports: list[Any] = []

    @field_validator("port_visibility", mode="before")
    @classmethod
    def _port_visibility_or_auto(cls, v: Any) -> str:
        """Rows written before the column existed read back as NULL."""
        return str(v) if v in PORT_VISIBILITIES else "auto"

    @field_validator("ports", mode="before")
    @classmethod
    def _coerce_ports(cls, v: Any) -> list[Any]:
        return v if isinstance(v, list) else []

    model_config = {"from_attributes": True}


class RackCableResponse(BaseModel):
    id: str
    design_id: str
    from_device_id: str
    from_port_id: str
    to_device_id: str
    to_port_id: str
    type: str
    color: str
    label: str | None = None
    label_visible: bool = False
    properties: list[dict[str, Any]] = []

    @field_validator("properties", mode="before")
    @classmethod
    def _list_properties(cls, v: Any) -> list[dict[str, Any]]:
        """Rows written before the column existed read back as NULL."""
        return v if isinstance(v, list) else []

    @field_validator("label_visible", mode="before")
    @classmethod
    def _bool_label_visible(cls, v: Any) -> bool:
        return bool(v)

    model_config = {"from_attributes": True}


class RackStateResponse(BaseModel):
    racks: list[RackResponse]
    devices: list[RackDeviceResponse]
    cables: list[RackCableResponse]
    viewport: dict[str, Any] = {}


class RackServiceInfo(BaseModel):
    """One service fingerprinted on a device, as the rack view prints it."""

    port: int | None = None
    name: str | None = None


class RackInventoryItem(BaseModel):
    """A Device Inventory entry offered to the rack tray.

    Carries the technical facts the logical canvas already knows about the same
    hardware (`node_*`), so a mount can print them without the user leaving the
    rack. Everything node-side is read-only here: the logical canvas owns it.
    """

    id: str
    label: str
    suggested_type: str | None = None
    ip: str | None = None
    status: str
    discovery_source: str | None = None
    # Inventory-side technical detail, from discovery.
    mac: str | None = None
    hostname: str | None = None
    os: str | None = None
    services: list[RackServiceInfo] = []
    # Live status of the matching canvas node, when the device is on one.
    node_id: str | None = None
    node_status: str | None = None
    # What that node holds — the logical view of the same box.
    node_label: str | None = None
    node_type: str | None = None
    node_ip: str | None = None
    node_mac: str | None = None
    node_hostname: str | None = None
    node_os: str | None = None
    node_check_method: str | None = None
    node_design_id: str | None = None
    node_design_name: str | None = None
    node_last_seen: datetime | None = None
    # True when this device is already mounted somewhere in this design.
    racked: bool = False
    # Rack modelisation the inventory row owns — the same front panel wherever
    # the device is mounted. All None/empty for a device never modelled; the
    # tray then falls back to the type-suggested faceplate.
    rack_faceplate_id: str | None = None
    rack_u_height: int | None = None
    rack_col_span: int | None = None
    rack_color: str | None = None
    rack_ports: list[dict[str, Any]] = []

    @field_validator("rack_ports", mode="before")
    @classmethod
    def _clean_ports(cls, v: Any) -> list[dict[str, Any]]:
        """NULL for a row written before the column existed; junk stays out."""
        if not isinstance(v, list):
            return []
        return [p for p in v if isinstance(p, dict) and p.get("id")]

    @field_validator("node_last_seen")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        """Stamp UTC on a naive timestamp before it goes on the wire.

        SQLite has no timezone type: an aware datetime written to `last_seen`
        reads back naive, and Pydantic then serializes it without an offset.
        `new Date("2026-08-08T10:00:00")` in the browser is *local* time, so the
        rack printed a last-seen shifted by the viewer's offset.
        """
        if v is not None and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class RackInventoryResponse(BaseModel):
    items: list[RackInventoryItem]
