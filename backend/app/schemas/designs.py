from datetime import datetime

from pydantic import BaseModel, field_validator

# Kept in sync with DesignType in frontend/src/types.
# "network" and "electrical" render the same React Flow canvas and differ only by
# palette and node set — the icon drives their presentation. "rack" is a genuinely
# different renderer (racks, mounted gear, port-to-port cables), so the frontend
# does branch on this field.
DESIGN_TYPES = {"network", "electrical", "rack"}


class DesignCreate(BaseModel):
    name: str
    icon: str = "dashboard"
    design_type: str = "network"

    @field_validator("design_type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in DESIGN_TYPES:
            raise ValueError(f"design_type must be one of {sorted(DESIGN_TYPES)}")
        return v


class DesignUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None


class DesignCopy(BaseModel):
    """Create a new design by deep-copying an existing one's canvas."""

    name: str
    icon: str = "dashboard"


class DesignResponse(BaseModel):
    id: str
    name: str
    design_type: str
    icon: str | None = None
    created_at: datetime
    updated_at: datetime
    # Populated by list_designs so the "copy from existing" picker can show what
    # each canvas holds. None on create/update/copy responses (not computed there).
    node_count: int | None = None
    group_count: int | None = None
    text_count: int | None = None

    model_config = {"from_attributes": True}
