from typing import Any

from pydantic import BaseModel, field_validator, Field, ConfigDict

from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse
from app.schemas.utils import normalize_animated


class NodeSave(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: str
    label: str
    hostname: str | None = None
    ip: str | None = None
    mac: str | None = None
    os: str | None = None
    status: str = "unknown"
    check_method: str | None = None
    check_target: str | None = None
    services: list[Any] = []
    notes: str | None = None
    # Accept frontend alias `parentId` while keeping internal `parent_id` name
    parent_id: str | None = Field(None, alias="parentId")
    container_mode: bool = False
    custom_colors: dict[str, Any] | None = None
    custom_icon: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool = False
    properties: list[Any] = []
    width: float | None = None
    height: float | None = None
    bottom_handles: int = 1
    pos_x: float = 0
    pos_y: float = 0


class EdgeSave(BaseModel):
    id: str
    source: str
    target: str
    type: str = "ethernet"
    label: str | None = None
    vlan_id: int | None = None
    speed: str | None = None
    custom_color: str | None = None
    path_style: str | None = None
    animated: str = 'none'
    source_handle: str | None = None
    target_handle: str | None = None
    waypoints: list[dict[str, float]] | None = None

    @field_validator('animated', mode='before')
    @classmethod
    def validate_animated(cls, v: object) -> str:
        return normalize_animated(v)


class CanvasSaveRequest(BaseModel):
    nodes: list[NodeSave] = []
    edges: list[EdgeSave] = []
    viewport: dict[str, Any] = {}


class CanvasStateResponse(BaseModel):
    nodes: list[NodeResponse]
    edges: list[EdgeResponse]
    viewport: dict[str, Any]
