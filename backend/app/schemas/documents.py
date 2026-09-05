from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from app.services.doc_template import TEMPLATE_IDS
from app.services.doc_tree import DOCUMENT_KINDS

# Kept in sync with DocKind in frontend/src/documentation/types.ts.
# "page" and "folder" live in the Library tree and carry a parent; "device",
# "node" and "design" each point at exactly one thing elsewhere in the app and
# are placed by that link instead, so the frontend can pivot them however the
# user asks (by zone, subnet, type…) without the server storing a tree.
DOC_KINDS = set(DOCUMENT_KINDS)


class DocumentCreate(BaseModel):
    kind: str = "page"
    title: str
    icon: str | None = None
    parent_id: str | None = None
    device_id: str | None = None
    node_id: str | None = None
    design_id: str | None = None
    # Scaffolds the body when no body is supplied. "device" is implied for a
    # device document and is the only template that reads the live facts.
    template_id: str | None = None
    body: str | None = None

    @field_validator("kind")
    @classmethod
    def _known_kind(cls, v: str) -> str:
        if v not in DOC_KINDS:
            raise ValueError(f"kind must be one of {sorted(DOC_KINDS)}")
        return v

    @field_validator("template_id")
    @classmethod
    def _known_template(cls, v: str | None) -> str | None:
        if v is not None and v not in TEMPLATE_IDS:
            raise ValueError(f"template_id must be one of {sorted(TEMPLATE_IDS)}")
        return v


class DocumentUpdate(BaseModel):
    title: str | None = None
    icon: str | None = None
    body: str | None = None
    parent_id: str | None = None
    sort_order: int | None = None
    starred: bool | None = None
    # Explicit: "I have re-read this and it is still true." Sent as a bare true
    # rather than a timestamp so the server owns the clock.
    reviewed: bool | None = None
    # Accept the device's current facts as documented, clearing the drift
    # banner without touching the body.
    resync_facts: bool | None = None


class DocumentSummary(BaseModel):
    """Everything the tree needs. Never carries a body — listings stay small."""

    id: str
    kind: str
    title: str
    slug: str
    icon: str | None = None
    parent_id: str | None = None
    sort_order: int = 0
    device_id: str | None = None
    node_id: str | None = None
    design_id: str | None = None
    tags: list[str] = []
    # The parsed frontmatter travels with the summary so the tree can badge a
    # document as due for review without fetching every body.
    frontmatter: dict[str, Any] = {}
    starred: bool = False
    template_id: str | None = None
    reviewed_at: datetime | None = None
    edited_at: datetime | None = None
    facts_synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentResponse(DocumentSummary):
    body: str = ""
    facts_snapshot: dict[str, Any] | None = None


class RevisionSummary(BaseModel):
    id: str
    document_id: str
    title: str
    reason: str
    saved_at: datetime
    # Character count, so the history list can show how much changed without
    # shipping every body.
    size: int = 0

    model_config = {"from_attributes": True}


class RevisionResponse(RevisionSummary):
    body: str = ""


class SearchHit(BaseModel):
    doc_id: str
    title: str
    kind: str
    snippet: str
    device_id: str | None = None


class SearchResponse(BaseModel):
    # "fts5" or "like" — the UI drops snippet highlighting on the fallback.
    engine: str
    hits: list[SearchHit]


class ScaffoldRequest(BaseModel):
    """Create the missing device documents.

    Omitting `device_ids` means every approved device that has none, which is
    the one-click migration off the old notes field.
    """

    device_ids: list[str] | None = None
    template_id: str = "device"
    # Only devices whose notes are not empty. What the migration banner sends.
    only_with_notes: bool = False


class ScaffoldResponse(BaseModel):
    created: list[DocumentSummary]
    skipped: int


class DriftField(BaseModel):
    field: str
    documented: Any = None
    current: Any = None


class CoverageResponse(BaseModel):
    devices: int
    documented: int
    # A document whose body is still only what the template generated.
    header_only: int
    missing: int
    drifted: int
    overdue: int
    notes_unmigrated: int
    library_pages: int
