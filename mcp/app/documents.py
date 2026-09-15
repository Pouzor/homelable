"""Documentation tools: read, search and safely extend Markdown documents.

The Documentation space is a set of full Markdown documents served under
`/api/v1/documents`. These tools give an assistant the read side and a
*bounded* write side: prose is added to one named section of an existing
document, previewed first, then applied against the exact version it was
prepared on.

Reading never creates, regenerates or modifies a document. If a device has no
document yet, `read_document` answers that fact instead of picking another
target or writing one. Applying an edit whose version is stale is refused by
the backend — the assistant must re-read and re-preview.
"""

from typing import Any
from urllib.parse import quote

from mcp.types import Tool

from .backend_client import backend

_DOC_KINDS = ["device", "node", "design", "page", "folder"]

_SHARED_EDIT_FIELDS: dict[str, Any] = {
    "document_id": {"type": "string", "description": "The document to edit — from read_document."},
    "operation": {
        "type": "string",
        "enum": ["append", "replace", "insert"],
        "description": "append adds prose at the end of the section; replace swaps its body; insert adds a new subsection (heading + level required).",
    },
    "section_index": {
        "type": "integer",
        "description": "Which section, as the index in read_document's section outline. Valid only against that outline's version.",
    },
    "content": {"type": "string", "description": "The Markdown block to add or to become the section's body. Must not open a code fence or introduce a heading at or above the section's own level."},
    "heading": {"type": "string", "description": "Heading text for operation 'insert', without the '#' markers."},
    "level": {"type": "integer", "description": "ATX level for operation 'insert' (default: the target section's level + 1)."},
    "expected_version": {
        "type": "integer",
        "description": "The document version the outline was read from. Stale versions are refused; re-read and re-preview.",
    },
}

DOCUMENT_TOOLS: list[Tool] = [
    Tool(name="list_documents", description="List documents in the Documentation space with their metadata (id, kind, title, version) — never the bodies. Filter by kind, or by the persistent inventory device id to find a device's document. Reading bodies is a deliberate separate step: call read_document.", inputSchema={
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": _DOC_KINDS, "description": "Filter to one document kind: device, node, design, page or folder."},
            "device_id": {"type": "string", "description": "The persistent inventory device id whose document to list (at most one match)."},
            "tag": {"type": "string", "description": "Filter to documents carrying this frontmatter tag."},
        },
    }),
    Tool(name="search_documents", description="Full-text search over the Documentation space. Returns bounded hits with a snippet — call read_document for the full text.", inputSchema={
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "Free-text query, e.g. 'backup retention'."},
            "limit": {"type": "integer", "description": "Maximum hits (default 25)."},
        },
    }),
    Tool(name="read_document", description="Read one document in full: identity, current version, section outline, and the whole Markdown body. Give exactly one of document_id or device_id. Never creates a document; a device with none is answered as such.", inputSchema={
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "The document id — from list_documents / search_documents / list_inventory."},
            "device_id": {"type": "string", "description": "Persistent inventory device id; resolves to that device's document, like the GUI does."},
        },
    }),
    Tool(name="document_edit_preview", description="Prepare a bounded edit to one section of an existing document and preview it — nothing is written. Returns the affected section before and after, plus the version and proposal id an apply must use. If a section is missing, that is returned rather than picking another target.", inputSchema={
        "type": "object",
        "required": ["document_id", "operation", "section_index", "content", "expected_version"],
        "properties": _SHARED_EDIT_FIELDS,
    }),
    Tool(name="document_edit_apply", description="Store a bounded edit that was previewed, against the exact version it was prepared on. Applying the same proposal twice (e.g. a retried lost response) is answered with the stored result instead of writing twice. The new version and the affected section are returned.", inputSchema={
        "type": "object",
        "required": ["document_id", "operation", "section_index", "content", "expected_version"],
        "properties": _SHARED_EDIT_FIELDS,
    }),
]

DOCUMENT_TOOL_NAMES: set[str] = {tool.name for tool in DOCUMENT_TOOLS}


def _slim_doc(doc: dict) -> dict:
    keep = (
        "id", "kind", "title", "slug", "version", "device_id", "node_id",
        "design_id", "parent_id", "template_id", "tags", "starred",
        "created_at", "updated_at",
    )
    return {k: doc[k] for k in keep if k in doc}


async def dispatch_document(name: str, args: dict[str, Any]) -> Any:
    if name == "list_documents":
        docs = await backend.get("/api/v1/documents")
        rows: list[dict] = docs if isinstance(docs, list) else []
        if args.get("kind"):
            rows = [d for d in rows if d.get("kind") == args["kind"]]
        if args.get("device_id"):
            rows = [d for d in rows if d.get("device_id") == args["device_id"]]
        if args.get("tag"):
            wanted = args["tag"].lower()
            rows = [d for d in rows if any(str(t).lower() == wanted for t in (d.get("tags") or []))]
        return [_slim_doc(d) for d in rows]

    if name == "search_documents":
        limit = args.get("limit", 25)
        return await backend.get(f"/api/v1/documents/search?q={quote(args['query'])}&limit={limit}")

    if name == "read_document":
        return await _read(args)

    if name in ("document_edit_preview", "document_edit_apply"):
        return await _edit(name, args)

    raise ValueError(f"Unknown documentation tool: {name}")


async def _read(args: dict[str, Any]) -> dict[str, Any]:
    document_id: str | None = args.get("document_id")
    device_id: str | None = args.get("device_id")
    if document_id and device_id:
        raise ValueError("read_document: provide exactly one of document_id or device_id")
    if device_id:
        docs = await backend.get(f"/api/v1/documents?device_id={quote(device_id)}")
        rows: list[dict] = docs if isinstance(docs, list) else []
        if not rows:
            return {
                "document": None,
                "message": (
                    f"No document exists for device {device_id} yet — nothing was "
                    "created or modified. Create one explicitly if you need a target."
                ),
            }
        document_id = str(rows[0]["id"])
    if not document_id:
        raise ValueError("read_document: provide document_id or device_id")
    doc: dict[str, Any] = await backend.get(f"/api/v1/documents/{document_id}")  # type: ignore[assignment]
    outline: dict[str, Any] = await backend.get(f"/api/v1/documents/{document_id}/sections")  # type: ignore[assignment]
    return {
        "document": {
            "id": doc.get("id"),
            "kind": doc.get("kind"),
            "title": doc.get("title"),
            "slug": doc.get("slug"),
            "version": doc.get("version"),
            "device_id": doc.get("device_id"),
            "node_id": doc.get("node_id"),
            "design_id": doc.get("design_id"),
            "parent_id": doc.get("parent_id"),
            "template_id": doc.get("template_id"),
            "tags": doc.get("tags") or [],
            "sections": outline.get("sections") or [],
            "body": doc.get("body") or "",
        }
    }


async def _edit(name: str, args: dict[str, Any]) -> dict[str, Any]:
    document_id: str = args["document_id"]
    body = {
        k: v
        for k, v in args.items()
        if k in ("operation", "section_index", "content", "heading", "level", "expected_version")
        and v is not None
    }
    endpoint = "preview" if name == "document_edit_preview" else "apply"
    return await backend.post(f"/api/v1/documents/{document_id}/sections/{endpoint}", body)  # type: ignore[return-value]
