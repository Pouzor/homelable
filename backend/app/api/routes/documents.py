"""Documents — the markdown documentation space.

A document is either a page or a folder in the Library tree, or it describes one
thing elsewhere in the app: a Device Inventory row, a piece of canvas furniture
(a zone, a group), or a whole canvas. The tree the user navigates is *not* stored
here: device documents are pivoted client-side by zone, subnet, type and so on,
because every one of those groupings is derivable from data the frontend already
holds and re-pivoting must be instant.

The generated header is written once, at creation. Nothing in this module ever
rewrites a body the user owns; `GET /blocks` hands the editor a freshly generated
section on request, and `facts_snapshot` is what lets the UI say the device has
moved on since the document was written.
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Document, DocumentRevision, Edge, InventoryDevice, Node, Rack, RackDevice
from app.schemas.documents import (
    BacklinkHit,
    CoverageResponse,
    DocumentCreate,
    DocumentResponse,
    DocumentSummary,
    DocumentUpdate,
    RevisionResponse,
    RevisionSummary,
    ScaffoldRequest,
    ScaffoldResponse,
    SearchHit,
    SearchResponse,
)
from app.services import doc_backlinks, doc_search
from app.services.doc_export import ExportDoc, build_zip
from app.services.doc_template import (
    BLOCKS,
    TEMPLATE_DEVICE,
    facts_snapshot,
    render_block,
    render_device_document,
    render_library_document,
)
from app.services.doc_tree import (
    REVISION_LIMIT,
    TREE_KINDS,
    is_ancestor,
    parse_frontmatter,
    subtree_ids,
    tags_from,
    unique_slug,
)

router = APIRouter()

# Node.type values that are canvas furniture. A zone or a group is documented
# through its node; everything else is documented through its device.
_FURNITURE_TYPES = {"group", "groupRect"}

_INTERVAL = re.compile(r"^\s*(\d+)\s*([dwmy])\s*$", re.IGNORECASE)
_INTERVAL_DAYS = {"d": 1, "w": 7, "m": 30, "y": 365}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; compare them as UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _parse_interval(raw: Any) -> timedelta | None:
    """`review_every: 6m` → 180 days. Anything unparseable means "never due"."""
    match = _INTERVAL.match(str(raw or ""))
    if not match:
        return None
    return timedelta(days=int(match.group(1)) * _INTERVAL_DAYS[match.group(2).lower()])


def _apply_body(doc: Document, body: str) -> None:
    """Store a body and refresh the frontmatter/tags cache from it.

    The body is the source of truth — it is what exports to disk — so the two
    JSON columns are only ever derived from it, never edited on their own.
    """
    doc.body = body
    frontmatter = parse_frontmatter(body)
    doc.frontmatter = frontmatter
    doc.tags = tags_from(frontmatter)


async def _adopt_frontmatter_title(db: AsyncSession, doc: Document) -> None:
    """Follow the name the body gives, since the body is what the user edits.

    `title:` in the frontmatter is the only place a document is named — there is
    no rename field anywhere in the UI — so a row that kept the title it was
    created with went stale the moment someone edited that line, and the tree
    went on showing the old name.
    """
    front = doc.frontmatter if isinstance(doc.frontmatter, dict) else {}
    title = front.get("title")
    if not isinstance(title, str) or not title.strip() or title.strip() == doc.title:
        return
    doc.title = title.strip()
    doc.slug = await unique_slug(db, doc.title, parent_id=doc.parent_id, exclude_id=doc.id)


async def _record_revision(db: AsyncSession, doc: Document, reason: str) -> None:
    """Snapshot the current body, then prune the document's oldest history."""
    db.add(DocumentRevision(document_id=doc.id, title=doc.title, body=doc.body or "", reason=reason))
    await db.flush()
    stale = (
        await db.execute(
            select(DocumentRevision)
            .where(DocumentRevision.document_id == doc.id)
            .order_by(DocumentRevision.saved_at.desc(), DocumentRevision.id.desc())
            .offset(REVISION_LIMIT)
        )
    ).scalars().all()
    for revision in stale:
        await db.delete(revision)


async def _device_context(db: AsyncSession, device_id: str) -> dict[str, Any]:
    """Zone, rack placement and canvas neighbours for a device.

    All three are optional: a device may be on no canvas, in no rack and in no
    zone, and the template drops those sections rather than printing them empty.
    """
    context: dict[str, Any] = {"zone_label": None, "rack": None, "connections": []}

    node = (
        await db.execute(select(Node).where(Node.device_id == device_id).order_by(Node.created_at))
    ).scalars().first()
    if node is not None:
        parent_id = node.parent_id
        seen: set[str] = set()
        while parent_id and parent_id not in seen:
            seen.add(parent_id)
            parent = await db.get(Node, parent_id)
            if parent is None:
                break
            if parent.type in _FURNITURE_TYPES:
                context["zone_label"] = parent.label
                break
            parent_id = parent.parent_id

        edges = (
            await db.execute(select(Edge).where((Edge.source == node.id) | (Edge.target == node.id)))
        ).scalars().all()
        peer_ids = [e.target if e.source == node.id else e.source for e in edges]
        if peer_ids:
            peers = (await db.execute(select(Node.label).where(Node.id.in_(peer_ids)))).scalars().all()
            context["connections"] = sorted({label for label in peers if label})

    mount = (
        await db.execute(select(RackDevice).where(RackDevice.device_id == device_id))
    ).scalars().first()
    if mount is not None:
        rack = await db.get(Rack, mount.rack_id)
        context["rack"] = {
            "name": rack.name if rack else None,
            "u_start": mount.u_start,
            "u_height": mount.u_height,
            "col_span": mount.col_span,
        }
    return context


async def _scaffold_body(db: AsyncSession, doc: Document, template_id: str | None) -> None:
    """Generate this document's initial body. Called once, at creation."""
    if doc.device_id:
        device = await db.get(InventoryDevice, doc.device_id)
        if device is not None:
            context = await _device_context(db, doc.device_id)
            _apply_body(doc, render_device_document(device, **context))
            doc.facts_snapshot = facts_snapshot(device)
            doc.facts_synced_at = _now()
            doc.template_id = TEMPLATE_DEVICE
            return
    _apply_body(doc, render_library_document(template_id or "blank", doc.title))
    doc.template_id = template_id or "blank"


def _has_drifted(doc: Document, device: InventoryDevice | None) -> bool:
    """Whether the device has moved on since this document was snapshotted.

    The comparison lives on the server rather than in the UI because
    `facts_snapshot` is the server's own shape — `label` and `type` are stored
    through their fallbacks and `properties` as a flat map — so nothing else
    can compare it to a device row correctly. Same rule as the coverage count.
    """
    if not doc.device_id or not doc.facts_snapshot or device is None:
        return False
    return doc.facts_snapshot != facts_snapshot(device)


async def _devices_for(db: AsyncSession, docs: list[Document]) -> dict[str, InventoryDevice]:
    """The devices a batch of documents describes, in one query."""
    wanted = {d.device_id for d in docs if d.device_id and d.facts_snapshot}
    if not wanted:
        return {}
    rows = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id.in_(wanted)))
    ).scalars().all()
    return {device.id: device for device in rows}


def _summary(doc: Document, device: InventoryDevice | None) -> DocumentSummary:
    payload = DocumentSummary.model_validate(doc)
    payload.drifted = _has_drifted(doc, device)
    return payload


async def _response(db: AsyncSession, doc: Document) -> DocumentResponse:
    """One document, with the drift flag resolved against the live device."""
    payload = DocumentResponse.model_validate(doc)
    payload.drifted = _has_drifted(doc, await db.get(InventoryDevice, doc.device_id) if doc.device_id else None)
    return payload


# ── list / read ─────────────────────────────────────────────────────────────


@router.get("", response_model=list[DocumentSummary])
async def list_documents(
    kind: str | None = Query(None, description="Filter to one document kind"),
    parent_id: str | None = Query(None, description="Library children of this folder"),
    device_id: str | None = Query(None, description="The document describing this device"),
    tag: str | None = Query(None, description="Documents carrying this frontmatter tag"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[DocumentSummary]:
    query = select(Document)
    if kind:
        query = query.where(Document.kind == kind)
    if parent_id:
        query = query.where(Document.parent_id == parent_id)
    if device_id:
        query = query.where(Document.device_id == device_id)
    docs = (await db.execute(query.order_by(Document.sort_order, Document.title))).scalars().all()
    if tag:
        wanted = tag.lower()
        docs = [d for d in docs if any(str(t).lower() == wanted for t in (d.tags or []))]
    devices = await _devices_for(db, list(docs))
    return [_summary(d, devices.get(d.device_id or "")) for d in docs]


@router.get("/coverage", response_model=CoverageResponse)
async def coverage(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> CoverageResponse:
    """How much of the homelab is actually written down."""
    devices = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.status != "hidden"))
    ).scalars().all()
    docs = (await db.execute(select(Document))).scalars().all()
    by_device = {d.device_id: d for d in docs if d.device_id}

    header_only = drifted = overdue = 0
    now = _now()
    for device in devices:
        doc = by_device.get(device.id)
        if doc is None:
            continue
        # Never edited since it was generated: the template is all there is.
        if doc.edited_at is None and doc.reviewed_at is None:
            header_only += 1
        if doc.facts_snapshot and doc.facts_snapshot != facts_snapshot(device):
            drifted += 1
        interval = _parse_interval((doc.frontmatter or {}).get("review_every"))
        since = _aware(doc.reviewed_at) or _aware(doc.created_at)
        if interval and since and now - since > interval:
            overdue += 1

    documented = sum(1 for device in devices if device.id in by_device)
    return CoverageResponse(
        devices=len(devices),
        documented=documented,
        header_only=header_only,
        missing=len(devices) - documented,
        drifted=drifted,
        overdue=overdue,
        notes_unmigrated=sum(
            1 for device in devices if (device.notes or "").strip() and device.id not in by_device
        ),
        library_pages=sum(1 for d in docs if d.kind in TREE_KINDS),
    )


@router.get("/search", response_model=SearchResponse)
async def search_documents(
    q: str = Query(..., description="Full-text query"),
    limit: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> SearchResponse:
    engine, rows = await doc_search.search(db, q, limit)
    if not rows:
        return SearchResponse(engine=engine, hits=[])
    docs = {
        d.id: d
        for d in (
            await db.execute(select(Document).where(Document.id.in_([r["doc_id"] for r in rows])))
        ).scalars().all()
    }
    hits = [
        SearchHit(
            doc_id=row["doc_id"],
            title=docs[row["doc_id"]].title,
            kind=docs[row["doc_id"]].kind,
            snippet=row["snippet"] or "",
            device_id=docs[row["doc_id"]].device_id,
        )
        for row in rows
        if row["doc_id"] in docs
    ]
    return SearchResponse(engine=engine, hits=hits)


@router.get("/blocks", response_model=dict)
async def generated_block(
    block: str = Query(..., description=f"One of {sorted(BLOCKS)}"),
    device_id: str = Query(..., description="Device to read the facts from"),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, str]:
    """Render one generated section, for the editor's `/` insert menu.

    This is the counterpart to generating the header only once: the user can
    always pull a fresh block in, but nothing pushes one at them.
    """
    if block not in BLOCKS:
        raise HTTPException(400, f"block must be one of {sorted(BLOCKS)}")
    device = await db.get(InventoryDevice, device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    context = await _device_context(db, device_id) if block in {"rack", "network"} else {}
    return {"block": block, "markdown": render_block(block, device, **context)}


@router.get("/export")
async def export_documents(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> Response:
    """Every document as a zip of `.md` files mirroring the tree.

    Declared above `/{document_id}` so "export" is not read as an id.
    """
    docs = (await db.execute(select(Document))).scalars().all()
    archive = build_zip(
        [
            ExportDoc(
                id=doc.id,
                kind=doc.kind,
                title=doc.title,
                slug=doc.slug,
                parent_id=doc.parent_id,
                body=doc.body or "",
            )
            for doc in docs
        ]
    )
    filename = f"homelable-documentation-{_now():%Y%m%d}.zip"
    return Response(
        content=archive,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # The browser reads the name from the header, and a cross-origin
            # fetch cannot see it unless it is exposed.
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DocumentResponse:
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return await _response(db, doc)


@router.get("/{document_id}/revisions", response_model=list[RevisionSummary])
async def list_revisions(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[RevisionSummary]:
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
        RevisionSummary(
            id=r.id,
            document_id=r.document_id,
            title=r.title,
            reason=r.reason,
            saved_at=r.saved_at,
            size=len(r.body or ""),
        )
        for r in revisions
    ]


@router.get("/{document_id}/backlinks", response_model=list[BacklinkHit])
async def list_backlinks(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[BacklinkHit]:
    """The documents whose body links here.

    Answered on the server because the browser only holds document *metadata* —
    the list endpoint carries no bodies, and loading every body to invert the
    links client-side would trade a small query for a large download on every
    open.
    """
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Every document is loaded because every one is a possible *target* of a
    # link — a bare `[[VLAN plan]]` resolves by title. Only the bodies carrying
    # `[[` are walked as sources, and the inventory is fetched only when a
    # `[[device:…]]` is actually in play.
    docs = list(
        (
            await db.execute(select(Document).order_by(Document.sort_order, Document.title))
        ).scalars().all()
    )
    devices = (
        list((await db.execute(select(InventoryDevice))).scalars().all())
        if doc_backlinks.has_device_link(docs)
        else []
    )

    titles = {d.id: d for d in docs}
    return [
        BacklinkHit(
            doc_id=hit.doc_id,
            title=titles[hit.doc_id].title,
            kind=titles[hit.doc_id].kind,
            device_id=titles[hit.doc_id].device_id,
            label=hit.label,
            context=hit.context,
            count=hit.count,
        )
        for hit in doc_backlinks.backlinks_for(document_id, docs, devices)
        if hit.doc_id in titles
    ]


@router.get("/revisions/{revision_id}", response_model=RevisionResponse)
async def get_revision(
    revision_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> RevisionResponse:
    revision = await db.get(DocumentRevision, revision_id)
    if not revision:
        raise HTTPException(404, "Revision not found")
    return RevisionResponse(
        id=revision.id,
        document_id=revision.document_id,
        title=revision.title,
        reason=revision.reason,
        saved_at=revision.saved_at,
        size=len(revision.body or ""),
        body=revision.body or "",
    )


# ── write ───────────────────────────────────────────────────────────────────


@router.post("", response_model=DocumentResponse, status_code=201)
async def create_document(
    body: DocumentCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DocumentResponse:
    links = [body.device_id, body.node_id, body.design_id]
    if sum(1 for link in links if link) > 1:
        raise HTTPException(400, "A document describes at most one device, node or design")
    if body.kind in TREE_KINDS and any(links):
        raise HTTPException(400, "A page or folder cannot also describe a device, node or design")
    if body.kind not in TREE_KINDS and not any(links):
        raise HTTPException(400, f"A '{body.kind}' document must name what it describes")
    if body.parent_id and body.kind not in TREE_KINDS:
        raise HTTPException(400, "Only pages and folders live in the Library tree")

    for link, model, what in (
        (body.device_id, InventoryDevice, "Device"),
        (body.node_id, Node, "Node"),
    ):
        if link and not await db.get(model, link):
            raise HTTPException(404, f"{what} not found")
    if body.parent_id and not await db.get(Document, body.parent_id):
        raise HTTPException(404, "Parent folder not found")

    for column, value in (
        (Document.device_id, body.device_id),
        (Document.node_id, body.node_id),
        (Document.design_id, body.design_id),
    ):
        if value and (await db.execute(select(Document).where(column == value))).scalars().first():
            raise HTTPException(409, "That already has a document")

    doc = Document(
        kind=body.kind,
        title=body.title,
        slug=await unique_slug(db, body.title, parent_id=body.parent_id),
        icon=body.icon,
        parent_id=body.parent_id,
        device_id=body.device_id,
        node_id=body.node_id,
        design_id=body.design_id,
    )
    if body.body is not None:
        _apply_body(doc, body.body)
        doc.template_id = body.template_id
    else:
        await _scaffold_body(db, doc, body.template_id)

    db.add(doc)
    await db.flush()
    await doc_search.index_document(db, doc)
    await db.commit()
    await db.refresh(doc)
    return await _response(db, doc)


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: str,
    body: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DocumentResponse:
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    sent = body.model_dump(exclude_unset=True)

    if "parent_id" in sent:
        parent_id = sent["parent_id"]
        if doc.kind not in TREE_KINDS:
            raise HTTPException(400, "Only pages and folders live in the Library tree")
        if parent_id:
            parent = await db.get(Document, parent_id)
            if not parent:
                raise HTTPException(404, "Parent folder not found")
            if parent.kind != "folder":
                raise HTTPException(400, "A document can only be filed under a folder")
            if await is_ancestor(db, document_id, parent_id):
                raise HTTPException(400, "A folder cannot be moved inside itself")
        doc.parent_id = parent_id
        doc.slug = await unique_slug(db, doc.title, parent_id=parent_id, exclude_id=doc.id)

    if "body" in sent and sent["body"] is not None and sent["body"] != doc.body:
        await _record_revision(db, doc, "edit")
        _apply_body(doc, sent["body"])
        doc.edited_at = _now()
        # An explicit title in the same request still wins: it is applied below.
        await _adopt_frontmatter_title(db, doc)

    if "title" in sent and sent["title"]:
        doc.title = sent["title"]
        doc.slug = await unique_slug(db, doc.title, parent_id=doc.parent_id, exclude_id=doc.id)
    if "icon" in sent:
        doc.icon = sent["icon"]
    if "sort_order" in sent and sent["sort_order"] is not None:
        doc.sort_order = sent["sort_order"]
    if "starred" in sent and sent["starred"] is not None:
        doc.starred = sent["starred"]
    if sent.get("reviewed"):
        doc.reviewed_at = _now()
    if sent.get("resync_facts") and doc.device_id:
        device = await db.get(InventoryDevice, doc.device_id)
        if device is not None:
            doc.facts_snapshot = facts_snapshot(device)
            doc.facts_synced_at = _now()

    await db.flush()
    await doc_search.index_document(db, doc)
    await db.commit()
    await db.refresh(doc)
    return await _response(db, doc)


@router.post("/{document_id}/revisions/{revision_id}/restore", response_model=DocumentResponse)
async def restore_revision(
    document_id: str,
    revision_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DocumentResponse:
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    revision = await db.get(DocumentRevision, revision_id)
    if not revision or revision.document_id != document_id:
        raise HTTPException(404, "Revision not found")
    # The body being replaced becomes history too, so a restore is undoable.
    await _record_revision(db, doc, "restore")
    _apply_body(doc, revision.body or "")
    # A restored body brings its own title back with it.
    await _adopt_frontmatter_title(db, doc)
    await db.flush()
    await doc_search.index_document(db, doc)
    await db.commit()
    await db.refresh(doc)
    return await _response(db, doc)


@router.post("/{document_id}/regenerate", response_model=DocumentResponse)
async def regenerate_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> DocumentResponse:
    """Throw the body away and scaffold it again from what the database holds.

    The one place that overwrites a body the user owns, so it is only ever
    reached from an explicit confirmation. The replaced body is snapshotted
    first, which makes the whole thing undoable from the history list.
    """
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.kind == "folder":
        raise HTTPException(400, "A folder has no body to regenerate")
    if doc.device_id and not await db.get(InventoryDevice, doc.device_id):
        raise HTTPException(404, "Device not found")

    await _record_revision(db, doc, "regenerate")
    await _scaffold_body(db, doc, doc.template_id)
    # Back to a freshly generated document: nothing of the user's is left in it.
    doc.edited_at = None
    await db.flush()
    await doc_search.index_document(db, doc)
    await db.commit()
    await db.refresh(doc)
    return await _response(db, doc)


@router.post("/scaffold", response_model=ScaffoldResponse)
async def scaffold_documents(
    body: ScaffoldRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScaffoldResponse:
    """Create the device documents that do not exist yet.

    This is the migration off `device_inventory.notes`: the old text is appended
    verbatim under `## Notes` and the column is left untouched, so nothing is
    lost and the move is repeatable.
    """
    query = select(InventoryDevice).where(InventoryDevice.status != "hidden")
    if body.device_ids:
        query = query.where(InventoryDevice.id.in_(body.device_ids))
    devices = (await db.execute(query.order_by(InventoryDevice.discovered_at))).scalars().all()
    existing = {
        doc_id
        for doc_id in (
            await db.execute(select(Document.device_id).where(Document.device_id.is_not(None)))
        ).scalars().all()
    }

    created: list[Document] = []
    skipped = 0
    for device in devices:
        if device.id in existing:
            skipped += 1
            continue
        if body.only_with_notes and not (device.notes or "").strip():
            skipped += 1
            continue
        context = await _device_context(db, device.id)
        doc = Document(
            kind="device",
            title=device.label or device.friendly_name or device.hostname or device.ip or "device",
            slug="",
            device_id=device.id,
            template_id=TEMPLATE_DEVICE,
            facts_snapshot=facts_snapshot(device),
            facts_synced_at=_now(),
        )
        doc.slug = await unique_slug(db, doc.title, parent_id=None)
        _apply_body(doc, render_device_document(device, **context))
        db.add(doc)
        await db.flush()
        db.add(
            DocumentRevision(
                document_id=doc.id,
                title=doc.title,
                body=doc.body,
                reason="migrate" if (device.notes or "").strip() else "scaffold",
            )
        )
        await doc_search.index_document(db, doc)
        created.append(doc)

    await db.commit()
    for doc in created:
        await db.refresh(doc)
    return ScaffoldResponse(created=[DocumentSummary.model_validate(d) for d in created], skipped=skipped)


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> None:
    doc = await db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    # SQLite does not always enforce the ON DELETE CASCADE, so walk the subtree
    # by hand — a folder takes its children with it.
    for doc_id in reversed(await subtree_ids(db, document_id)):
        target = await db.get(Document, doc_id)
        if target is None:
            continue
        for revision in (
            await db.execute(select(DocumentRevision).where(DocumentRevision.document_id == doc_id))
        ).scalars().all():
            await db.delete(revision)
        await doc_search.unindex_document(db, doc_id)
        await db.delete(target)
    await db.commit()
