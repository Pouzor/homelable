from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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
    # Optimistic-lock guard for body writes: the version the caller's draft was
    # based on. A whole-body save that does not name a version is allowed (a
    # rename or a star is not a body edit), but a save that names a version
    # newer than the current one is refused so an MCP edit cannot be silently
    # overwritten by a GUI save made from a stale draft.
    expected_version: int | None = Field(default=None, ge=1)


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
    # The optimistic-lock counter: every body change bumps it, and a write that
    # was prepared against an older version is refused. The section-outline and
    # read endpoints return it so editors and MCP clients can land safely.
    version: int = 1
    # Whether the device has moved on since the snapshot was taken. Computed by
    # the server because only the server knows the snapshot's shape: it holds
    # `label` and `type` through their fallbacks and `properties` as a flat
    # map, none of which the inventory wire shape can be compared against
    # field by field.
    drifted: bool = False
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


class BacklinkHit(BaseModel):
    """A document that links here, and the line it does it on."""

    doc_id: str
    title: str
    kind: str
    device_id: str | None = None
    # What the link was written as, so a `[[…|label]]` reads back as the author
    # meant it rather than as the target's own title.
    label: str
    context: str
    count: int = 1


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


# ── bounded section edits (the MCP documentation workflow) ──────────────────


class SectionItem(BaseModel):
    """One ATX heading in a document, addressed by its outline index.

    The index is stable only for the version it was read from; a section edit
    always names the version it was prepared against, so an index cannot drift
    onto a different section silently.
    """

    index: int
    level: int
    heading: str
    parent_index: int | None = None
    # A taste of the section's body — enough to tell two same-named headings
    # apart without shipping the document.
    excerpt: str = ""


class SectionOutline(BaseModel):
    document_id: str
    title: str
    version: int
    sections: list[SectionItem]


class SectionEditRequest(BaseModel):
    """What one bounded edit must name.

    `append` adds prose at the end of the named section (replacing the
    template's empty prompt when the section is still a placeholder), `replace`
    swaps the section's body for `content`, and `insert` adds a new subsection
    — `heading` / `level` required — at the top of the named section's body.
    """

    operation: Literal["append", "replace", "insert"]
    section_index: int = Field(ge=0)
    content: str
    heading: str | None = Field(
        default=None, description="Heading text for `insert`, without the `#` markers."
    )
    level: int | None = Field(
        default=None, ge=1, le=6, description="ATX level for `insert`; defaults to the target's level + 1."
    )
    # The version the caller's outline was read from. The preview and the apply
    # both refuse to work against any other version.
    expected_version: int = Field(ge=1)


class SectionPreview(BaseModel):
    """The bounded edit, without a single byte written."""

    document_id: str
    title: str
    version: int
    proposal_id: str
    section: SectionItem
    operation: str
    # The section's body before and after the edit, so the caller can read
    # exactly what an apply would change before approving it.
    before: str
    after: str


class SectionApplyResponse(BaseModel):
    """The document after an applied bounded edit.

    `retried` is true when the apply was a replayed version of an edit that had
    already been committed (a lost response, retried) — nothing was written a
    second time, and the document is returned as it stands.
    """

    document_id: str
    title: str
    version: int
    proposal_id: str
    retried: bool = False
    section: SectionItem
    # The section's body as it reads after the edit.
    body: str
