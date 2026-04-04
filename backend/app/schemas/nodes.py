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
    isp_layout: str = "single"
    custom_colors: dict[str, Any] | None = None
    custom_icon: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool = False
    width: float | None = None
    height: float | None = None


class NodeCreate(NodeBase):
    pass


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
    isp_layout: str | None = None
    custom_colors: dict[str, Any] | None = None
    custom_icon: str | None = None
    cpu_count: int | None = None
    cpu_model: str | None = None
    ram_gb: float | None = None
    disk_gb: float | None = None
    show_hardware: bool | None = None
    width: float | None = None
    height: float | None = None


class NodeResponse(NodeBase):
    id: str
    last_seen: datetime | None = None
    response_time_ms: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
