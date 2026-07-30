from typing import Any

from pydantic import BaseModel, field_validator

# Kept in sync with the frontend rack model (frontend/src/types).
WIDTH_STANDARDS = {"19", "10"}
NUMBERINGS = {"bottom-up", "top-down"}
CABLE_TYPES = {"ethernet", "fiber"}
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
    ports: list[Any] = []

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


class RackCableSave(BaseModel):
    id: str
    from_device_id: str
    from_port_id: str
    to_device_id: str
    to_port_id: str
    type: str = "ethernet"
    color: str = "#39d353"
    label: str | None = None

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in CABLE_TYPES:
            raise ValueError(f"type must be one of {sorted(CABLE_TYPES)}")
        return v


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
    ports: list[Any] = []

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

    model_config = {"from_attributes": True}


class RackStateResponse(BaseModel):
    racks: list[RackResponse]
    devices: list[RackDeviceResponse]
    cables: list[RackCableResponse]
    viewport: dict[str, Any] = {}


class RackInventoryItem(BaseModel):
    """A Device Inventory entry offered to the rack tray."""

    id: str
    label: str
    suggested_type: str | None = None
    ip: str | None = None
    status: str
    discovery_source: str | None = None
    # Live status of the matching canvas node, when the device is on one.
    node_id: str | None = None
    node_status: str | None = None
    # True when this device is already mounted somewhere in this design.
    racked: bool = False


class RackInventoryResponse(BaseModel):
    items: list[RackInventoryItem]
