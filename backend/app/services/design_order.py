"""Order of the canvas list (#461).

`designs.position` is the user's order. The list is read through `LIST_ORDER`,
so a row with no position — written by something that predates the column —
still shows, after the positioned ones, by creation date.

The "default canvas" a request falls back to when it names no design stays the
oldest one (`order_by(Design.created_at)` at those call sites): reordering the
list must not silently change where a scan or an MCP write lands.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Design

LIST_ORDER = (Design.position.is_(None), Design.position, Design.created_at, Design.id)


async def next_design_position(db: AsyncSession) -> int:
    """Position for a new design: after every existing one."""
    top = (await db.execute(select(func.max(Design.position)))).scalar()
    return 0 if top is None else top + 1
