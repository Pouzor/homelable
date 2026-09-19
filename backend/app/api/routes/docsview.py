"""Documentation view — the read-only public documentation space.

Disabled by default. Setting `DOCS_VIEW_KEY` in `.env` opens `/docs?key=<value>`,
which serves the documentation space to anyone holding the URL: the tree, a
page, and that page's earlier versions. The same bargain as live view, one knob,
off until someone turns it on.

Two rules shape this module, and both are structural rather than a matter of
being careful:

- **It reads.** No POST, PATCH or DELETE is declared here, so there is no write
  to forget to guard. Reading an old version is a read; *restoring* one is not,
  and the restore route stays where it was, behind a session.
- **It answers with its own schemas.** The `Public*` models in
  `schemas.documents` name their fields one by one instead of inheriting from
  the authenticated ones, so a document's links to a device, a canvas node or a
  design — handles onto rows this key grants nothing of — never ride along.
"""

import hmac

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.database import get_db
from app.db.models import Document, DocumentRevision
from app.schemas.documents import (
    PublicDocumentResponse,
    PublicDocumentSummary,
    PublicRevisionResponse,
    PublicRevisionSummary,
)

router = APIRouter()


class DocsViewConfigResponse(BaseModel):
    """Whether the documentation view is enabled, plus the key (admin-only)."""

    enabled: bool
    key: str | None = None


async def require_key(key: str | None = Query(default=None)) -> None:
    """Gate every public route below on the configured key.

    No key configured means the feature is off and the answer is 403 whatever is
    presented — the key is never compared against an unset value, so enabling
    this is always a deliberate edit to `.env`.
    """
    if not settings.docs_view_key:
        raise HTTPException(status_code=403, detail="Documentation view is disabled")
    if not key or not hmac.compare_digest(key, settings.docs_view_key):
        raise HTTPException(status_code=403, detail="Invalid documentation view key")


@router.get("/config", response_model=DocsViewConfigResponse)
async def docsview_config(
    _: str = Depends(get_current_user),
) -> DocsViewConfigResponse:
    """Authenticated: expose the configured key so the UI can build a
    ready-to-use link (`/docs?key=...`).

    Only reachable by a logged-in user — the key is never exposed publicly.
    """
    key = settings.docs_view_key or None
    return DocsViewConfigResponse(enabled=bool(key), key=key)


@router.get("/tree", response_model=list[PublicDocumentSummary])
async def docsview_tree(
    _: None = Depends(require_key),
    db: AsyncSession = Depends(get_db),
) -> list[PublicDocumentSummary]:
    """Every document as a summary, in the order the tree renders them.

    Bodies stay out, as they do for the authenticated listing: the tree badges
    from the frontmatter cache, and the filter box narrows what is already here
    without asking the server anything.
    """
    docs = (
        await db.execute(select(Document).order_by(Document.sort_order, Document.title))
    ).scalars().all()
    return [PublicDocumentSummary.model_validate(doc) for doc in docs]


@router.get("/revisions/{revision_id}", response_model=PublicRevisionResponse)
async def docsview_revision(
    revision_id: str,
    _: None = Depends(require_key),
    db: AsyncSession = Depends(get_db),
) -> PublicRevisionResponse:
    """One earlier version, to read. Declared above `/{document_id}` so
    "revisions" is never read as a document id."""
    revision = await db.get(DocumentRevision, revision_id)
    if not revision:
        raise HTTPException(404, "Revision not found")
    return PublicRevisionResponse(
        id=revision.id,
        document_id=revision.document_id,
        title=revision.title,
        reason=revision.reason,
        saved_at=revision.saved_at,
        size=len(revision.body or ""),
        body=revision.body or "",
    )


@router.get("/{document_id}", response_model=PublicDocumentResponse)
async def docsview_document(
    document_id: str,
    _: None = Depends(require_key),
    db: AsyncSession = Depends(get_db),
) -> PublicDocumentResponse:
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return PublicDocumentResponse.model_validate(doc)


@router.get("/{document_id}/revisions", response_model=list[PublicRevisionSummary])
async def docsview_revisions(
    document_id: str,
    _: None = Depends(require_key),
    db: AsyncSession = Depends(get_db),
) -> list[PublicRevisionSummary]:
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    revisions = (
        await db.execute(
            select(DocumentRevision)
            .where(DocumentRevision.document_id == document_id)
            .order_by(DocumentRevision.saved_at.desc(), DocumentRevision.id.desc())
        )
    ).scalars().all()
    return [
        PublicRevisionSummary(
            id=r.id,
            document_id=r.document_id,
            title=r.title,
            reason=r.reason,
            saved_at=r.saved_at,
            size=len(r.body or ""),
        )
        for r in revisions
    ]
