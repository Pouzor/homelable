# Documentation

A markdown document per device, plus a free-form Library of pages and folders,
behind the **Documentation** entry in the left sidebar.

Before this, the only writing surface in Homelable was `device_inventory.notes`
— one `TEXT` column rendered as plain text. This replaces it with something that
can be structured, linked, searched and kept honest, without ever throwing the
old notes away.

---

## The model

Three tables. See `docs/database-model.md` for the columns.

| Table | What |
|---|---|
| `documents` | One markdown document. Either a Library `page`/`folder`, or a `device` / `node` / `design` document describing exactly one thing. |
| `document_revisions` | Prior bodies, pruned to the most recent 50 per document. |
| `documents_fts` | The FTS5 search index. Optional — see *Search* below. |

**A document attaches to the device, not to the node.** Since 3.3.0 a node draws
a device and the facts live on `device_inventory`, so one device reads the same
on every canvas it appears on.

**Every link is `SET NULL` and the title is denormalized.** Deleting a device or
a canvas never destroys what was written: the document survives as an orphan and
can be re-linked or filed into the Library. Foreign keys are off in this SQLite
setup, so the delete paths clear the columns by hand through
`app/services/doc_links.py::unlink_documents` — `nodes`, `scan` and `designs`
each call it before they delete.

**A folder is a document** (`kind='folder'`). That is what allows an empty
folder, and lets a folder carry an index body.

**One document per target.** Enforced twice: a 409 in the route, and partial
unique indexes created in `init_db` (`DOCUMENT_DDL` in `db/database.py` —
`create_all` cannot express a partial index or a virtual table).

---

## The generated header

`app/services/doc_template.py` scaffolds a device document from the live facts:
addresses, hardware, one section per fingerprinted service, rack and zone
placement, canvas neighbours, custom properties. Old `notes` are appended
verbatim under `## Notes` behind an HTML-comment provenance marker.

**It is generated once and then belongs to the user.** Nothing rewrites a body
that already exists. Two things keep it from going stale silently:

- `facts_snapshot` records the facts as they read at generation time, so the UI
  can say *the device has changed* and list what.
- `GET /api/v1/documents/blocks?block=…&device_id=…` renders any single block on
  demand — that is what the editor's `/device`, `/services`, `/rack`… commands
  insert. Regeneration is always one keystroke away, and never automatic.

A section whose data is empty is still emitted, with an italic prompt: the
document is a checklist of what has not been written yet. Sections that are
structural rather than descriptive — the rack position of an unracked device —
are dropped instead.

Service URLs in a document follow `frontend/src/utils/serviceUrl.ts`, including
its non-HTTP port denylist, so a link in a document is the link the canvas
offers.

---

## The tree

Two roots, with different natures.

**Devices** is a pivot, rebuilt client-side in
`frontend/src/documentation/tree.ts` from data the app already holds. Grouping
by zone, group, type, physical/virtual, subnet, canvas, rack, vendor, discovery
source, status, tag, or flat A–Z is instant and needs no server round trip.

- Zone and group come from walking `parent_id` up to the nearest `groupRect` /
  `group` node.
- Subnet prefers a configured scanner range, else the address's own /24. A
  device with several IPs appears under each subnet it reaches.
- Physical / Virtual / Host is derived: `vm`/`lxc`/`docker_container` are
  virtual, `proxmox`/`docker_host` and anything drawn as a container are hosts.
- Canvas answers "on the loaded canvas or not" — the app only holds one at a
  time.

**Library** is the real folder tree, ordered by `sort_order` then title.

Badges: `·` no document, `○` only the generated header, `●` written, `⚠` the
device changed since, `⏰` past its `review_every`.

---

## Editing

Markdown source on the left, live preview on the right. Source rather than a
rich editor on purpose: the body is exported verbatim, so what is typed is what
the file holds.

**Saving is explicit** — Ctrl/Cmd+S or the Save button — matching the canvas
rule that nothing persists on a timer. An unsaved body is mirrored to
`localStorage` under `homelable_docdraft:<id>` on every keystroke and cleared on
save. On reopening, a draft taken against the version being opened is *offered*;
a draft taken against an older version is discarded, because replaying it would
revert a change made elsewhere.

`/` at the start of a line opens the insert menu: the generated blocks above,
plus table, checklist, callout, wiki-link and date.

---

## Links between documents

`[[device:nas-01]]`, `[[doc:vlan-plan]]`, `[[node:<id>]]`, or a bare
`[[VLAN plan]]`; `[[…|label]]` sets the text. A device resolves by id or label,
a document by id, slug, then title, all case-insensitively. An unresolved link
renders red and offers to create the document.

Parsed as a text pass over the rendered children (`wikilinks.ts` +
`markdown/WikiText.tsx`) rather than as a remark plugin, so the file stays
ordinary markdown for anything else that reads it.

**Raw HTML is deliberately not rendered** — `rehype-raw` is absent — so a
document cannot inject markup and no sanitiser is needed.

---

## Search

`GET /api/v1/documents/search?q=` over title, tags and body.

FTS5 is **not** assumed: the SQLite shipped in the LXC and Docker images may be
built without it, the same reason `database.py` avoids JSON1. `doc_search.py`
probes once and falls back to `LIKE`, and the response says which engine
answered (`fts5` or `like`) so the UI can drop snippet highlighting. The index is
maintained from Python on every write — no triggers — and `_reindex_documents_fts`
catches up on boot after an upgrade or a restored backup.

User input is never FTS5 syntax: `build_match_query` quotes every term, so an
IP or a stray quote is data.

---

## Migrating the old notes

Non-destructive and repeatable.

1. `GET /api/v1/documents/coverage` reports `notes_unmigrated`.
2. A banner offers to migrate.
3. `POST /api/v1/documents/scaffold {"only_with_notes": true}` creates one
   document per device, old notes appended verbatim, with a `migrate` revision.
4. **`device_inventory.notes` is left exactly as it was.** It is still the
   column the HACS integration, the YAML export, the MCP tools and the canvas
   search read. Deprecating it is a separate decision.

---

## API

| Method | Path |
|---|---|
| `GET` | `/api/v1/documents` — metadata only, filterable by `kind`, `parent_id`, `device_id`, `tag` |
| `GET` | `/api/v1/documents/{id}` |
| `POST` | `/api/v1/documents` |
| `PATCH` | `/api/v1/documents/{id}` |
| `DELETE` | `/api/v1/documents/{id}` — a folder takes its subtree |
| `GET` | `/api/v1/documents/{id}/revisions`, `/revisions/{rev_id}` |
| `POST` | `/api/v1/documents/{id}/revisions/{rev_id}/restore` |
| `POST` | `/api/v1/documents/{id}/regenerate` — erase the body and scaffold it again |
| `GET` | `/api/v1/documents/search?q=&limit=` |
| `GET` | `/api/v1/documents/blocks?block=&device_id=` |
| `GET` | `/api/v1/documents/coverage` |
| `POST` | `/api/v1/documents/scaffold` |

---

## Standalone mode

Documents are **full-mode only**. Standalone has no backend to store or search
them, and the same reasoning as ADR-001 applies: the section is hidden in the
sidebar and explains itself if reached directly, rather than being polyfilled
into `localStorage` with no search and no history.

---

## Not built yet

Export/import of the tree as `.md` files, a print/handbook view, an aggregated
open-tasks view, image upload inside a document (would reuse
`api/routes/media.py`, full-mode only), and the MCP tools — those are the
planned second lot.
