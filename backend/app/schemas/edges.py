from datetime import datetime

from pydantic import BaseModel, field_validator

from app.schemas.utils import normalize_animated


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
    source_handle: str | None = None
    target_handle: str | None = None
    waypoints: list[dict[str, float]] | None = None

    @field_validator('animated', mode='before')
    @classmethod
    def validate_animated(cls, v: object) -> str:
        return normalize_animated(v)


class EdgeCreate(EdgeBase):
    pass


class EdgeUpdate(BaseModel):
    type: str | None = None
    label: str | None = None
    vlan_id: int | None = None
    speed: str | None = None
    custom_color: str | None = None
    path_style: str | None = None
    animated: str | None = None
    source_handle: str | None = None
    target_handle: str | None = None
    waypoints: list[dict[str, float]] | None = None

    @field_validator('animated', mode='before')
    @classmethod
    def validate_animated(cls, v: object) -> str | None:
        if v is None:
            return None
        return normalize_animated(v)


class EdgeResponse(EdgeBase):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}
