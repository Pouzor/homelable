from datetime import datetime

from pydantic import BaseModel


class DesignCreate(BaseModel):
    name: str
    icon: str = "dashboard"
    # Vestigial: kept for backward compatibility. The UI no longer branches on it;
    # the chosen icon now drives presentation. Defaults to a generic canvas.
    design_type: str = "network"


class DesignUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None


class DesignResponse(BaseModel):
    id: str
    name: str
    design_type: str
    icon: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
