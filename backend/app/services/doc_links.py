"""Clear document links when the thing a document describes is deleted.

The schema declares `ON DELETE SET NULL` on `documents.device_id`, `node_id` and
`design_id`, but SQLite runs here with foreign keys off (see
`api/routes/scan.py::delete_pending`), so nothing enforces it. Without this the
column would keep naming a row that no longer exists and the document would look
linked while resolving to nothing.

Clearing rather than deleting is deliberate: the inventory outlives the canvas,
and what the user wrote outlives both. The document survives as an orphan,
keeping its denormalized `title`, and can be re-linked or filed into the Library.
"""

from collections.abc import Sequence

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document


async def unlink_documents(
    db: AsyncSession,
    *,
    device_ids: Sequence[str] | None = None,
    node_ids: Sequence[str] | None = None,
    design_ids: Sequence[str] | None = None,
) -> None:
    """Orphan every document pointing at any of the given rows.

    Caller commits — this is meant to run inside the same transaction as the
    delete it accompanies.
    """
    for column, ids in (
        (Document.device_id, device_ids),
        (Document.node_id, node_ids),
        (Document.design_id, design_ids),
    ):
        if ids:
            await db.execute(update(Document).where(column.in_(list(ids))).values({column: None}))
