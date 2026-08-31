from typing import Any

from pydantic import BaseModel, field_validator, model_validator

from app.schemas.edges import EdgeResponse
from app.schemas.nodes import NodeResponse
from app.schemas.utils import normalize_animated, normalize_marker


class NodeSave(BaseModel):
    id: str
    type: str
    label: str
    # Round-tripped so a save keeps the node pointed at its inventory row. The
    # device fields below are still accepted at their canvas values and routed
    # to that row server-side.
    device_id: str | None = None
    # Which device facts this canvas edited since it loaded them, if the client
    # tracked that. The payload always carries a *full* copy of the device — it
    # was hydrated from the inventory row on load — so without this a save made
    # for nothing but a moved node would rewrite the row from a snapshot that may
    # be hours old. `None` (an older client, an import, the MCP server) keeps the
    # previous behaviour: every fact is a candidate write.
    changed_facts: list[str] | None = None
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
    custom_colors: dict[str, Any] | None = None
    custom_icon: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool = False
    show_port_numbers: bool = False
    properties: list[Any] = []
    width: float | None = None
    height: float | None = None
    bottom_handles: int = 1
    top_handles: int = 1
    left_handles: int = 0
    right_handles: int = 0
    pos_x: float = 0
    pos_y: float = 0

    @model_validator(mode="after")
    def drop_self_parent(self) -> "NodeSave":
        """A node can never be its own parent.

        Every parent walk on the canvas — waypoint propagation, ordering
        parents before children, collapse — assumes an acyclic tree, and a
        self-parent row makes the node undraggable once it is reloaded (#370).

        Dropped rather than rejected: a canvas that already carries the bad row
        must still be able to save, and a 422 here would cost the user the whole
        save. The startup repair clears what is already persisted.
        """
        if self.parent_id is not None and self.parent_id == self.id:
            self.parent_id = None
        return self


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
    line_style: str | None = None
    width_mult: float | None = None
    animated: str = 'none'
    marker_start: str = 'none'
    marker_end: str = 'none'
    source_handle: str | None = None
    target_handle: str | None = None
    waypoints: list[dict[str, float]] | None = None

    @field_validator('animated', mode='before')
    @classmethod
    def validate_animated(cls, v: object) -> str:
        return normalize_animated(v)

    @field_validator('marker_start', 'marker_end', mode='before')
    @classmethod
    def validate_marker(cls, v: object) -> str:
        return normalize_marker(v)


class CanvasSaveRequest(BaseModel):
    nodes: list[NodeSave] = []
    edges: list[EdgeSave] = []
    viewport: dict[str, Any] = {}
    custom_style: dict[str, Any] | None = None
    design_id: str | None = None


class CanvasStateResponse(BaseModel):
    nodes: list[NodeResponse]
    edges: list[EdgeResponse]
    viewport: dict[str, Any]
    custom_style: dict[str, Any] | None = None
    # True once this design's canvas has ever been persisted (a CanvasState row
    # exists). Lets the frontend tell a brand-new user (show demo) apart from one
    # who intentionally cleared their canvas (keep it empty). False also for a
    # missing/uninitialized design.
    initialized: bool = False
