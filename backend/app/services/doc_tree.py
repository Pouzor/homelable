"""Placement and parsing helpers for documents.

The Library is a real tree — a folder is a document with `kind='folder'`, so an
empty folder exists and a folder can carry an index body. That makes three
things this module owns: slugs that stay unique among siblings, a re-parent
guard so the tree cannot be knotted into a cycle, and the subtree walk that
`DELETE` needs because SQLite does not always enforce `ON DELETE CASCADE`
(`api/routes/designs.py` unwinds its own deletes for the same reason).

It also parses the YAML frontmatter out of a body. The body is the source of
truth — it is what exports to disk — and `documents.frontmatter` / `documents.tags`
are only a cache so a listing can filter without reading every body.
"""

import re
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document

# A document is addressed by id; the slug is for readable URLs and export
# filenames, so it only has to be filesystem- and URL-safe.
_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
# `[ \t]*`, not `\s*`: `\s` matches the newline the fence line ends with, and an
# alternative that can be reached two ways makes the match quadratic on a body
# that opens with `---` and never closes it — the shape a half-typed document
# has for as long as the user is typing it.
_FRONTMATTER = re.compile(r"\A---[ \t]*\n(.*?)\n---[ \t]*(?:\n|\Z)", re.DOTALL)

DOCUMENT_KINDS = frozenset({"device", "node", "design", "page", "folder"})

# Kinds that live in the Library tree and may therefore carry a parent.
TREE_KINDS = frozenset({"page", "folder"})

REVISION_LIMIT = 50


def slugify(title: str) -> str:
    slug = _SLUG_STRIP.sub("-", (title or "").strip().lower()).strip("-")
    return slug[:80] or "untitled"


async def unique_slug(db: AsyncSession, title: str, *, parent_id: str | None, exclude_id: str | None = None) -> str:
    """A slug no sibling is already using."""
    base = slugify(title)
    sibling = Document.parent_id.is_(None) if parent_id is None else Document.parent_id == parent_id
    query = select(Document.slug).where(sibling)
    if exclude_id is not None:
        query = query.where(Document.id != exclude_id)
    taken = {row for row in (await db.execute(query)).scalars().all()}
    if base not in taken:
        return base
    suffix = 2
    while f"{base}-{suffix}" in taken:
        suffix += 1
    return f"{base}-{suffix}"


def parse_frontmatter(body: str) -> dict[str, Any]:
    """The YAML block at the top of a body, or `{}`.

    Malformed YAML is not an error the user should be blocked by — they are
    mid-edit. The cache simply stays empty until the block parses again.
    """
    match = _FRONTMATTER.match(body or "")
    if not match:
        return {}
    try:
        parsed = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(key): _jsonable(value) for key, value in parsed.items()}


def _jsonable(value: Any) -> Any:
    """Coerce a parsed YAML value into something the JSON column can hold.

    YAML resolves `created: 2026-09-05` to a `date` and `at: 10:30` to an int,
    neither of which survives `json.dumps`. The cache is only ever read back for
    filtering and display, so a string is the right shape — the body keeps the
    literal the user typed either way.
    """
    if isinstance(value, str | int | float | bool) or value is None:
        return value
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return str(value)


def tags_from(frontmatter: dict[str, Any]) -> list[str]:
    raw = frontmatter.get("tags")
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.split(",")]
    if not isinstance(raw, list):
        return []
    return [str(tag).strip() for tag in raw if str(tag).strip()]


async def is_ancestor(db: AsyncSession, candidate_id: str, of_id: str) -> bool:
    """Whether `candidate_id` is `of_id` or sits above it.

    Guards re-parenting: moving a folder inside its own subtree would orphan
    everything under it. Mirrors the `_is_ancestor` guard the MCP zone tools use.
    """
    if candidate_id == of_id:
        return True
    seen: set[str] = set()
    current: str | None = of_id
    while current and current not in seen:
        seen.add(current)
        current = (await db.execute(select(Document.parent_id).where(Document.id == current))).scalar_one_or_none()
        if current == candidate_id:
            return True
    return False


async def subtree_ids(db: AsyncSession, root_id: str) -> list[str]:
    """`root_id` plus every document beneath it, deepest last."""
    collected = [root_id]
    frontier = [root_id]
    while frontier:
        children = (
            await db.execute(select(Document.id).where(Document.parent_id.in_(frontier)))
        ).scalars().all()
        children = [child for child in children if child not in collected]
        if not children:
            break
        collected.extend(children)
        frontier = children
    return collected
