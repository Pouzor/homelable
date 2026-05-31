from datetime import datetime

from pydantic import BaseModel


class DesignCreate(BaseModel):
    name: str
    design_type: str = "electrical"


class DesignUpdate(BaseModel):
    name: str | None = None


class DesignResponse(BaseModel):
    id: str
    name: str
    design_type: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
