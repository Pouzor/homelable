from datetime import datetime
from typing import Any

from pydantic import BaseModel


class NodeBase(BaseModel):
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
    pos_x: float = 0
    pos_y: float = 0
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
    properties: list[dict[str, Any]] = []
    width: float | None = None
    height: float | None = None
    bottom_handles: int = 1
    top_handles: int = 1
    left_handles: int = 0
    right_handles: int = 0


class NodeCreate(NodeBase):
    # Override pos_x/pos_y so callers can omit them; None signals "auto-place".
    # The create_node route resolves None to a free grid slot before persisting.
    pos_x: float | None = None  # type: ignore[assignment]
    pos_y: float | None = None  # type: ignore[assignment]
    design_id: str | None = None
    # When a node with the same ip/mac already exists on the target design, the
    # create/approve endpoints reject with 409 so the UI can ask the user. Set
    # force=True to bypass that guard and create the duplicate deliberately.
    force: bool = False


class NodeUpdate(BaseModel):
    type: str | None = None
    label: str | None = None
    hostname: str | None = None
    ip: str | None = None
    mac: str | None = None
    os: str | None = None
    status: str | None = None
    check_method: str | None = None
    check_target: str | None = None
    services: list[Any] | None = None
    notes: str | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    parent_id: str | None = None
    container_mode: bool | None = None
    custom_colors: dict[str, Any] | None = None
    custom_icon: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool | None = None
    show_port_numbers: bool | None = None
    properties: list[dict[str, Any]] | None = None
    width: float | None = None
    height: float | None = None
    bottom_handles: int | None = None
    top_handles: int | None = None
    left_handles: int | None = None
    right_handles: int | None = None


class NodeResponse(NodeBase):
    id: str
    design_id: str | None = None
    # The Device Inventory row this node draws; None for canvas furniture. The
    # device fields above are hydrated from that row on read, so the wire shape
    # is unchanged even though the row, not the node, owns them.
    device_id: str | None = None
    ieee_address: str | None = None
    last_seen: datetime | None = None
    last_scan: datetime | None = None
    response_time_ms: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
