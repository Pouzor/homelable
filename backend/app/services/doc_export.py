"""Export the documentation space as a zip of `.md` files.

`Document.body` is already the whole markdown file, YAML frontmatter included,
so exporting is a question of *where* each body lands, not what it contains —
nothing here rewrites a byte the user wrote.

The archive mirrors what the sidebar shows. The Library tree becomes real
directories, one per folder document; everything that is filed by a link rather
than by hand (a device, a piece of canvas furniture, a whole canvas) lands in a
flat directory named after its kind, because those are pivoted client-side and
have no single tree to mirror.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass

# Kinds that are placed by their link instead of by `parent_id`, and the
# directory each one exports into.
LINKED_DIRS = {"device": "devices", "node": "nodes", "design": "designs"}

# A folder carries an index body of its own, and a directory cannot hold one —
# so it becomes a file inside the directory it opens.
FOLDER_INDEX = "index"

_UNSAFE = re.compile(r"[^a-z0-9._-]+")


@dataclass(frozen=True)
class ExportDoc:
    """The fields the layout needs, so the mapping stays testable without a DB."""

    id: str
    kind: str
    title: str
    slug: str
    parent_id: str | None
    body: str


def safe_segment(raw: str) -> str:
    """One path segment that cannot escape the archive or collide with a device.

    Slugs come from `slugify` and are already tame, but a body can be exported
    long after a title was renamed by hand, and `..` or a leading dot would be a
    zip-slip waiting for whichever tool unpacks this.
    """
    cleaned = _UNSAFE.sub("-", (raw or "").strip().lower()).strip("-.")
    return cleaned or "untitled"


def _ancestors(doc: ExportDoc, by_id: dict[str, ExportDoc]) -> list[str]:
    """The folder segments above `doc`, outermost first.

    A parent chain that loops — which the move guards prevent, but a hand-edited
    database does not — stops at the first repeat rather than spinning.
    """
    segments: list[str] = []
    seen = {doc.id}
    current = by_id.get(doc.parent_id or "")
    while current is not None and current.id not in seen:
        seen.add(current.id)
        segments.append(safe_segment(current.slug or current.title))
        current = by_id.get(current.parent_id or "")
    segments.reverse()
    return segments


def _path_for(doc: ExportDoc, by_id: dict[str, ExportDoc]) -> str:
    name = safe_segment(doc.slug or doc.title)
    directory = LINKED_DIRS.get(doc.kind)
    if directory is not None:
        return f"{directory}/{name}.md"
    parts = _ancestors(doc, by_id)
    if doc.kind == "folder":
        # The folder's own body sits inside the directory it opens, so its
        # children are siblings of it rather than of the folder file.
        return "/".join([*parts, name, f"{FOLDER_INDEX}.md"])
    return "/".join([*parts, f"{name}.md"])


def export_paths(docs: list[ExportDoc]) -> list[tuple[str, str]]:
    """`(path, body)` for every document, in a stable order and never colliding.

    Slugs are only unique among siblings, and a linked document is a sibling of
    the Library root while exporting into `devices/`, so two documents really can
    want the same path. The second one gets a numbered name rather than
    overwriting the first — a silently short export is the worst outcome here.
    """
    by_id = {doc.id: doc for doc in docs}
    taken: set[str] = set()
    out: list[tuple[str, str]] = []
    for doc in sorted(docs, key=lambda d: (d.kind, d.title.lower(), d.id)):
        path = _path_for(doc, by_id)
        if path.lower() in taken:
            stem, _, extension = path.rpartition(".")
            suffix = 2
            while f"{stem}-{suffix}.{extension}".lower() in taken:
                suffix += 1
            path = f"{stem}-{suffix}.{extension}"
        taken.add(path.lower())
        out.append((path, doc.body or ""))
    return out


def build_zip(docs: list[ExportDoc]) -> bytes:
    """The whole documentation space as one deflated archive, built in memory.

    A homelab's worth of markdown is kilobytes; streaming it would buy nothing
    and cost the caller a temporary file.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, body in export_paths(docs):
            archive.writestr(path, body)
    return buffer.getvalue()
