from typing import Any

from pydantic import BaseModel

from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse


class NodeSave(BaseModel):
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
    parent_id: str | None = None
    container_mode: bool = False
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


class CanvasSaveRequest(BaseModel):
    nodes: list[NodeSave] = []
    edges: list[EdgeSave] = []
    viewport: dict = {}


class CanvasStateResponse(BaseModel):
    nodes: list[NodeResponse]
    edges: list[EdgeResponse]
    viewport: dict
