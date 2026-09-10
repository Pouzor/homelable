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
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Column positions inside documents_fts, for snippet().
_BODY_COLUMN = 3

_available: bool | None = None
_checked_at: float = 0.0

# How long an "unavailable" answer stands before the probe is worth repeating.
# A build without FTS5 never gains it, so the retry is pure waste there and the
# interval keeps that waste to one failed SELECT a minute; a lock that closed the
# index for one request clears in milliseconds, so a minute of LIKE is the cost
# of not hammering a database that is already busy.
_RECHECK_SECONDS = 60.0


def reset_availability_cache() -> None:
    """Forget the probed FTS5 state. Tests swap databases between cases."""
    global _available, _checked_at
    _available = None
    _checked_at = 0.0


def _mark_unavailable(reason: str) -> None:
    """Record that the index is not usable, logging only on the way down."""
    global _available, _checked_at
    if _available is not False:
        logger.info("FTS5 unavailable — document search falls back to LIKE (%s)", reason)
    _available = False
    _checked_at = time.monotonic()


async def fts_available(db: AsyncSession) -> bool:
    """Whether this SQLite build has FTS5 and the index table exists.

    The answer is cached, but a negative one only for `_RECHECK_SECONDS`. The
    probe is one statement against a local file, and the errors it can raise are
    not all permanent: `database is locked` while the boot reindex or the scanner
    thread holds a write is transient, and caching it forever cost the process
    every ranked search it would ever run. So a failure is a "not right now",
    re-asked on the first call after the interval; only success is final.
    """
    global _available, _checked_at
    if _available is True:
        return True
    if _available is False and time.monotonic() - _checked_at < _RECHECK_SECONDS:
        return False
    try:
        await db.execute(text("SELECT doc_id FROM documents_fts LIMIT 1"))
    except OperationalError as exc:
        _mark_unavailable(str(exc))
        return False
    _available = True
    _checked_at = time.monotonic()
    return True


def tags_text(tags: Any) -> str:
    """Flatten a tag list into one indexable string."""
    if isinstance(tags, list):
        return " ".join(str(tag) for tag in tags)
    return ""


async def index_document(db: AsyncSession, doc: Any) -> None:
    """Re-index one document. Safe to call when FTS5 is missing."""
    if not await fts_available(db):
        return
    # A savepoint, so a write against an index that vanished under us rolls back
    # to here instead of poisoning the document write this is part of. Saving a
    # document must not fail because its search index did.
    try:
        async with db.begin_nested():
            await _delete_indexed(db, doc.id)
            await db.execute(
                text(
                    "INSERT INTO documents_fts (doc_id, title, tags, body) "
                    "VALUES (:i, :t, :g, :b)"
                ),
                {"i": doc.id, "t": doc.title or "", "g": tags_text(doc.tags), "b": doc.body or ""},
            )
    except OperationalError as exc:
        _mark_unavailable(str(exc))


async def unindex_document(db: AsyncSession, doc_id: str) -> None:
    if not await fts_available(db):
        return
    try:
        async with db.begin_nested():
            await _delete_indexed(db, doc_id)
    except OperationalError as exc:
        _mark_unavailable(str(exc))


async def _delete_indexed(db: AsyncSession, doc_id: str) -> None:
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
