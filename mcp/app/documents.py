"""Documentation tools.

The documentation space (`documents`) is the homelab written down: one markdown
document per Device Inventory row, per canvas, per piece of canvas furniture,
plus a Library tree of free pages and folders. The body is the source of truth —
frontmatter and tags are derived from it — so every write here sends a body and
lets the backend re-derive the rest.

Reading is meant to be cheap: `search_documentation` is the entry point,
`list_documentation` returns summaries with no bodies, and only `read_document`
pays for a full body.
"""

from typing import Any
from urllib.parse import urlencode

from mcp.types import Tool

from .backend_client import backend

# Kept in sync with DOCUMENT_KINDS (backend/app/services/doc_tree.py), which is
# itself the DocKind union in frontend/src/documentation/types.ts.
DOC_KINDS = ["device", "node", "design", "page", "folder"]

# Filters `GET /api/v1/documents` understands. Anything else in the args is a
# tool argument the backend has no query parameter for, and is dropped.
_LIST_FILTERS = ("kind", "parent_id", "device_id", "tag")

# Kept in sync with TEMPLATE_IDS (backend/app/services/doc_template.py).
# "device" is the only one that reads the live inventory facts; the rest are
# empty skeletons of headings.
DOC_TEMPLATES = [
    "device",
    "blank",
    "runbook",
    "service",
    "network",
    "incident",
    "procedure",
    "decision",
    "zone",
]

# What the history records for anything written through this server. Not a tool
# argument: an AI client cannot sign its edits as a human's.
_MCP_REASON = "mcp"

_SECTION_EDIT_FIELDS: dict[str, Any] = {
    "document_id": {"type": "string"},
    "operation": {"type": "string", "enum": ["append", "replace", "insert"]},
    "section_index": {"type": "integer"},
    "content": {"type": "string"},
    "heading": {"type": "string"},
    "level": {"type": "integer", "minimum": 1, "maximum": 6},
    "expected_version": {"type": "integer", "minimum": 1},
    "proposal_token": {"type": "string"},
}

DOC_TOOLS = [
    Tool(name="search_documentation", description="Full-text search across every document, returning a snippet per hit. The first thing to call when the question is 'what do we know about X' — cheaper than listing and reading documents. `engine` is 'fts5', or 'like' on a SQLite build without FTS5, where snippets are unhighlighted.", inputSchema={
        "type": "object",
        "required": ["q"],
        "properties": {
            "q": {"type": "string", "description": "Query text. FTS5 syntax (AND, OR, \"quoted phrase\", prefix*) when the engine is fts5."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
        },
    }),
    Tool(name="list_documentation", description="List documents as summaries — id, kind, title, tags, frontmatter, drift and review dates, never a body. Use it to find what exists; call read_document for the text.", inputSchema={
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": DOC_KINDS, "description": "'device'/'node'/'design' describe one thing elsewhere in the app; 'page'/'folder' live in the Library tree."},
            "parent_id": {"type": "string", "description": "Library children of this folder."},
            "device_id": {"type": "string", "description": "The document describing this inventory device."},
            "tag": {"type": "string", "description": "Documents carrying this frontmatter tag."},
        },
    }),
    Tool(name="read_document", description="One document in full: its markdown body, frontmatter, tags, and the facts snapshot it was written against.", inputSchema={
        "type": "object",
        "required": ["id"],
        "properties": {"id": {"type": "string", "description": "Document id. Call search_documentation or list_documentation to discover ids."}},
    }),
    Tool(name="list_document_sections", description="List the current Markdown sections and document version without writing. Use its section index and version for a guarded section-edit preview.", inputSchema={
        "type": "object",
        "required": ["document_id"],
        "properties": {"document_id": {"type": "string"}},
    }),
    Tool(name="preview_document_section_edit", description="Preview a bounded change to one section without writing. Read the document first and use its version and section index. The returned token is required to apply this exact preview.", inputSchema={
        "type": "object",
        "required": ["document_id", "operation", "section_index", "content", "expected_version"],
        "properties": _SECTION_EDIT_FIELDS,
    }),
    Tool(name="apply_document_section_edit", description="Apply the exact bounded section change that was previewed. Stale versions and a token for different content are rejected, so it cannot overwrite an intervening edit.", inputSchema={
        "type": "object",
        "required": ["document_id", "operation", "section_index", "content", "expected_version", "proposal_token"],
        "properties": _SECTION_EDIT_FIELDS,
    }),
    Tool(name="list_document_revisions", description="The edit history of one document, newest first: who caused each revision ('edit' a human in the editor, 'mcp' an AI client, 'restore', 'regenerate', 'scaffold', 'migrate') and how big the body was. Bodies are not included — read_document_revision fetches one.", inputSchema={
        "type": "object",
        "required": ["document_id"],
        "properties": {"document_id": {"type": "string"}},
    }),
    Tool(name="read_document_revision", description="The body a document had at one point in its history. Pair it with read_document to see what an edit changed.", inputSchema={
        "type": "object",
        "required": ["revision_id"],
        "properties": {"revision_id": {"type": "string", "description": "Revision id, from list_document_revisions."}},
    }),
    Tool(name="document_backlinks", description="The documents linking to this one with [[wiki links]], and the line each link sits on. Inverted server-side, so it finds links a document does not know it has received.", inputSchema={
        "type": "object",
        "required": ["document_id"],
        "properties": {"document_id": {"type": "string"}},
    }),
    Tool(name="create_document", description="Write a new document. Send a body to write it outright, or a template_id to scaffold one from headings. A device/node/design document must name the thing it describes; a page or folder may name a parent folder.", inputSchema={
        "type": "object",
        "required": ["title"],
        "properties": {
            "title": {"type": "string"},
            "kind": {"type": "string", "enum": DOC_KINDS, "default": "page"},
            "body": {"type": "string", "description": "Markdown, optionally opening with a `---` frontmatter block. Wins over template_id."},
            "icon": {"type": "string"},
            "parent_id": {"type": "string", "description": "Library folder this page or folder is filed under."},
            "device_id": {"type": "string", "description": "Inventory device this document describes (kind 'device')."},
            "node_id": {"type": "string", "description": "Canvas node this document describes (kind 'node')."},
            "design_id": {"type": "string", "description": "Canvas this document describes (kind 'design')."},
            "template_id": {"type": "string", "enum": DOC_TEMPLATES, "description": "Scaffold the body from this template when no body is sent. 'device' is implied for a device document and is the only one that reads the live facts."},
        },
    }),
    Tool(name="update_document", description="Edit a document. Only the fields sent are applied. Changing the body snapshots the previous one into the history first, tagged as an AI edit, so nothing written here is lost and a human can restore what was there before.", inputSchema={
        "type": "object",
        "required": ["id"],
        "properties": {
            "id": {"type": "string"},
            "body": {"type": "string", "description": "The full replacement body, not a patch. Read the document first and send it back edited, or the rest of it is dropped."},
            "expected_version": {"type": "integer", "minimum": 1, "description": "Required when body is sent. Use the version from read_document; a stale write is rejected."},
            "title": {"type": "string", "description": "Renames the document. A `title:` in the body's frontmatter does the same and is the way the UI does it."},
            "icon": {"type": "string"},
            "parent_id": {"type": "string", "description": "Refile a page or folder under another folder."},
            "sort_order": {"type": "integer"},
            "starred": {"type": "boolean"},
            "reviewed": {"type": "boolean", "description": "Records 'I have re-read this and it is still true' at the server's clock."},
            "resync_facts": {"type": "boolean", "description": "Accept the device's current facts as documented, clearing the drift banner without touching the body."},
        },
    }),
    Tool(name="restore_document_revision", description="Put an earlier body back. The body being replaced becomes history too, so a restore is itself undoable.", inputSchema={
        "type": "object",
        "required": ["document_id", "revision_id", "expected_version"],
        "properties": {
            "document_id": {"type": "string"},
            "revision_id": {"type": "string", "description": "From list_document_revisions."},
            "expected_version": {"type": "integer", "minimum": 1},
        },
    }),
]

DOC_TOOL_NAMES = {tool.name for tool in DOC_TOOLS}


async def dispatch_document(name: str, args: dict) -> Any:
    if name == "search_documentation":
        query: dict[str, Any] = {"q": args["q"]}
        if args.get("limit"):
            query["limit"] = args["limit"]
        return await backend.get(f"/api/v1/documents/search?{urlencode(query)}")

    if name == "list_documentation":
        filters = {k: args[k] for k in _LIST_FILTERS if args.get(k)}
        path = "/api/v1/documents"
        if filters:
            path += f"?{urlencode(filters)}"
        return await backend.get(path)

    if name == "read_document":
        return await backend.get(f"/api/v1/documents/{args['id']}")

    if name == "list_document_sections":
        return await backend.get(f"/api/v1/documents/{args['document_id']}/sections")

    if name in ("preview_document_section_edit", "apply_document_section_edit"):
        allowed = (
            "operation", "section_index", "content", "heading", "level", "expected_version", "proposal_token",
        )
        body = {key: args[key] for key in allowed if args.get(key) is not None}
        endpoint = "preview" if name == "preview_document_section_edit" else "apply"
        return await backend.post(f"/api/v1/documents/{args['document_id']}/sections/{endpoint}", body)

    if name == "list_document_revisions":
        return await backend.get(f"/api/v1/documents/{args['document_id']}/revisions")

    if name == "read_document_revision":
        return await backend.get(f"/api/v1/documents/revisions/{args['revision_id']}")

    if name == "document_backlinks":
        return await backend.get(f"/api/v1/documents/{args['document_id']}/backlinks")

    if name == "create_document":
        return await backend.post("/api/v1/documents", args)

    if name == "update_document":
        body = {k: v for k, v in args.items() if k not in ("id", "revision_reason")}
        # Every body this server writes is attributed to it, whatever the
        # client asked for. The backend ignores the reason when the body is
        # unchanged, so a starred flag still snapshots nothing.
        body["revision_reason"] = _MCP_REASON
        return await backend.patch(f"/api/v1/documents/{args['id']}", body)

    if name == "restore_document_revision":
        path = f"/api/v1/documents/{args['document_id']}/revisions/{args['revision_id']}/restore"
        return await backend.post(path, {"expected_version": args["expected_version"]})

    raise ValueError(f"Unknown documentation tool: {name}")
