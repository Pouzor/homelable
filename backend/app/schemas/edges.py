from datetime import datetime

from pydantic import BaseModel, field_validator

from app.schemas.utils import normalize_animated, normalize_marker


class EdgeBase(BaseModel):
    source: str
    target: str
    type: str = "ethernet"
    label: str | None = None
    vlan_id: int | None = None
    speed: str | None = None
    custom_color: str | None = None
    path_style: str | None = None
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


class EdgeCreate(EdgeBase):
    design_id: str | None = None


class EdgeUpdate(BaseModel):
    type: str | None = None
    label: str | None = None
    vlan_id: int | None = None
    speed: str | None = None
    custom_color: str | None = None
    path_style: str | None = None
    animated: str | None = None
    marker_start: str | None = None
    marker_end: str | None = None
    source_handle: str | None = None
    target_handle: str | None = None
    waypoints: list[dict[str, float]] | None = None

    @field_validator('animated', mode='before')
    @classmethod
    def validate_animated(cls, v: object) -> str | None:
        if v is None:
            return None
        return normalize_animated(v)

    @field_validator('marker_start', 'marker_end', mode='before')
    @classmethod
    def validate_marker(cls, v: object) -> str | None:
        if v is None:
            return None
        return normalize_marker(v)


class EdgeResponse(EdgeBase):
    id: str
    design_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
