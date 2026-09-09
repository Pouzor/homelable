"""Full-text search over documents.

SQLite's FTS5 module is not guaranteed: the LXC and Docker images ship whatever
SQLite the base distribution built, and `database.py` already avoids depending
on JSON1 for the same reason. So the index is best-effort — every write keeps it
up to date when it exists, and `search` falls back to LIKE when it does not. The
endpoint reports which engine answered so the UI can drop snippet highlighting.

The index is maintained from Python rather than by triggers: the write paths are
few, they are already inside a transaction, and a trigger would have to be kept
in sync through `_try_migrate` forever.
"""

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Column positions inside documents_fts, for snippet().
_BODY_COLUMN = 3

_available: bool | None = None


def reset_availability_cache() -> None:
    """Forget the probed FTS5 state. Tests swap databases between cases."""
    global _available
    _available = None


async def fts_available(db: AsyncSession) -> bool:
    """Whether this SQLite build has FTS5 and the index table exists."""
    global _available
    if _available is None:
        try:
            await db.execute(text("SELECT doc_id FROM documents_fts LIMIT 1"))
            _available = True
        except OperationalError:
            # Don't cache False: a transient startup error (container ordering
            # race, brief DB unavailability) would permanently disable FTS5 for
            # the process lifetime. Re-probe each call until the index confirms
            # it exists; the probe is a single cheap SELECT.
            logger.info("FTS5 unavailable — document search falls back to LIKE")
            return False
    return _available


def tags_text(tags: Any) -> str:
    """Flatten a tag list into one indexable string."""
    if isinstance(tags, list):
        return " ".join(str(tag) for tag in tags)
    return ""


async def index_document(db: AsyncSession, doc: Any) -> None:
    """Re-index one document. Safe to call when FTS5 is missing."""
    if not await fts_available(db):
        return
    await unindex_document(db, doc.id)
    await db.execute(
        text("INSERT INTO documents_fts (doc_id, title, tags, body) VALUES (:i, :t, :g, :b)"),
        {"i": doc.id, "t": doc.title or "", "g": tags_text(doc.tags), "b": doc.body or ""},
    )


async def unindex_document(db: AsyncSession, doc_id: str) -> None:
    if not await fts_available(db):
        return
    await db.execute(text("DELETE FROM documents_fts WHERE doc_id = :i"), {"i": doc_id})


def build_match_query(raw: str) -> str:
    """Turn user input into an FTS5 MATCH expression.

    Every term is quoted, so punctuation a user types (`192.168.1.1`, `nas-01`,
    an unbalanced quote) is data rather than FTS5 syntax, and gets a prefix `*`
    so typing half a word still matches.
    """
    terms = [term.replace('"', '""') for term in raw.split() if term.strip()]
    return " AND ".join(f'"{term}"*' for term in terms)


async def search(db: AsyncSession, query: str, limit: int = 25) -> tuple[str, list[dict[str, Any]]]:
    """Return `(engine, hits)`; engine is "fts5" or "like"."""
    query = query.strip()
    if not query:
        return ("fts5" if await fts_available(db) else "like", [])

    if await fts_available(db):
        match = build_match_query(query)
        if not match:
            return ("fts5", [])
        try:
            rows = (
                await db.execute(
                    text(
                        "SELECT doc_id, "
                        f"snippet(documents_fts, {_BODY_COLUMN}, '<<', '>>', '…', 14) AS snip, "
                        "rank AS score "
                        "FROM documents_fts WHERE documents_fts MATCH :q "
                        "ORDER BY rank LIMIT :n"
                    ),
                    {"q": match, "n": limit},
                )
            ).fetchall()
            return ("fts5", [{"doc_id": r[0], "snippet": r[1], "score": r[2]} for r in rows])
        except OperationalError as exc:
            # A malformed MATCH must degrade, never 500.
            logger.debug("FTS query failed, falling back to LIKE: %s", exc)

    like = f"%{query.lower()}%"
    rows = (
        await db.execute(
            text(
                "SELECT id, body FROM documents "
                "WHERE lower(title) LIKE :q OR lower(body) LIKE :q "
                "ORDER BY updated_at DESC LIMIT :n"
            ),
            {"q": like, "n": limit},
        )
    ).fetchall()
    return ("like", [{"doc_id": r[0], "snippet": _excerpt(r[1] or "", query), "score": None} for r in rows])


def _excerpt(body: str, query: str, width: int = 120) -> str:
    """A LIKE-mode stand-in for snippet(): the text around the first match."""
    at = body.lower().find(query.lower())
    if at < 0:
        return body[:width].strip()
    start = max(0, at - width // 2)
    end = min(len(body), at + len(query) + width // 2)
    return ("…" if start else "") + body[start:end].strip() + ("…" if end < len(body) else "")
