"""Search over documents, on both engines.

FTS5 is not guaranteed by the SQLite build the LXC and Docker images ship, so
the LIKE fallback is a supported path, not a safety net — it gets the same
coverage as the index.
"""

import logging

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document
from app.services import doc_search


def _doc(**kwargs) -> Document:
    base = dict(kind="page", title="T", slug="t", body="", tags=[])
    base.update(kwargs)
    return Document(**base)


async def _seed(db: AsyncSession) -> list[Document]:
    docs = [
        _doc(title="NAS", slug="nas", body="The Synology holds every backup.", tags=["storage"]),
        _doc(title="Router", slug="router", body="Runs OPNsense on 192.168.1.1.", tags=["network"]),
        _doc(title="VLAN plan", slug="vlan-plan", body="Guest traffic is isolated.", tags=["network"]),
    ]
    for doc in docs:
        db.add(doc)
        await db.flush()
        await doc_search.index_document(db, doc)
    await db.flush()
    return docs


# ── the MATCH expression ────────────────────────────────────────────────────


def test_match_query_quotes_every_term_and_prefixes_it():
    assert doc_search.build_match_query("nas backup") == '"nas"* AND "backup"*'


def test_match_query_neutralises_punctuation_a_user_types():
    # An IP and a lone quote are data, not FTS5 syntax.
    assert doc_search.build_match_query("192.168.1.1") == '"192.168.1.1"*'
    assert doc_search.build_match_query('a"b') == '"a""b"*'


def test_match_query_of_whitespace_is_empty():
    assert doc_search.build_match_query("   ") == ""


def test_tags_text_flattens_a_list():
    assert doc_search.tags_text(["a", "b"]) == "a b"
    assert doc_search.tags_text(None) == ""


# ── FTS5 ────────────────────────────────────────────────────────────────────


async def test_fts_is_available_when_the_index_table_exists(db_session: AsyncSession):
    assert await doc_search.fts_available(db_session) is True


async def test_search_finds_a_word_that_is_only_in_a_body(db_session: AsyncSession):
    await _seed(db_session)
    engine, hits = await doc_search.search(db_session, "Synology")
    assert engine == "fts5"
    assert len(hits) == 1
    assert "Synology" in hits[0]["snippet"]


async def test_search_matches_a_prefix(db_session: AsyncSession):
    await _seed(db_session)
    _, hits = await doc_search.search(db_session, "OPNsen")
    assert len(hits) == 1


async def test_search_matches_a_title(db_session: AsyncSession):
    await _seed(db_session)
    _, hits = await doc_search.search(db_session, "VLAN")
    assert len(hits) == 1


async def test_search_matches_a_tag(db_session: AsyncSession):
    await _seed(db_session)
    _, hits = await doc_search.search(db_session, "network")
    assert len(hits) == 2


async def test_search_ands_its_terms(db_session: AsyncSession):
    await _seed(db_session)
    _, hits = await doc_search.search(db_session, "guest traffic")
    assert len(hits) == 1
    _, none = await doc_search.search(db_session, "guest Synology")
    assert none == []


async def test_search_of_an_empty_query_returns_nothing(db_session: AsyncSession):
    await _seed(db_session)
    _, hits = await doc_search.search(db_session, "   ")
    assert hits == []


async def test_reindexing_replaces_the_previous_body(db_session: AsyncSession):
    docs = await _seed(db_session)
    docs[0].body = "Replaced entirely."
    await doc_search.index_document(db_session, docs[0])
    _, gone = await doc_search.search(db_session, "Synology")
    assert gone == []
    _, found = await doc_search.search(db_session, "Replaced")
    assert len(found) == 1


async def test_unindexing_removes_the_document(db_session: AsyncSession):
    docs = await _seed(db_session)
    await doc_search.unindex_document(db_session, docs[0].id)
    _, hits = await doc_search.search(db_session, "Synology")
    assert hits == []


async def test_the_limit_is_honoured(db_session: AsyncSession):
    for i in range(8):
        doc = _doc(title=f"D{i}", slug=f"d{i}", body="shared word here")
        db_session.add(doc)
        await db_session.flush()
        await doc_search.index_document(db_session, doc)
    _, hits = await doc_search.search(db_session, "shared", limit=3)
    assert len(hits) == 3


# ── the LIKE fallback ───────────────────────────────────────────────────────


async def test_search_falls_back_to_like_without_fts5(db_session: AsyncSession):
    await _seed(db_session)
    await db_session.execute(text("DROP TABLE documents_fts"))
    doc_search.reset_availability_cache()

    engine, hits = await doc_search.search(db_session, "Synology")
    assert engine == "like"
    assert len(hits) == 1
    assert "Synology" in hits[0]["snippet"]


async def test_indexing_is_a_no_op_without_fts5(db_session: AsyncSession):
    await db_session.execute(text("DROP TABLE documents_fts"))
    doc_search.reset_availability_cache()
    doc = _doc(title="NAS", slug="nas", body="body")
    db_session.add(doc)
    await db_session.flush()
    # Must not raise — writes carry on, only search degrades.
    await doc_search.index_document(db_session, doc)
    await doc_search.unindex_document(db_session, doc.id)


async def test_like_fallback_is_case_insensitive(db_session: AsyncSession):
    await _seed(db_session)
    await db_session.execute(text("DROP TABLE documents_fts"))
    doc_search.reset_availability_cache()
    _, hits = await doc_search.search(db_session, "synology")
    assert len(hits) == 1


# ── the availability probe ──────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _forget_probe():
    """Every case in this file decides for itself whether the index exists."""
    doc_search.reset_availability_cache()
    yield
    doc_search.reset_availability_cache()


async def test_a_failed_probe_is_retried_once_the_interval_passes(db_session: AsyncSession):
    """Regression for #448: a transient failure must not disable FTS5 for good.

    `database is locked` while the boot reindex or the scanner thread holds a
    write used to be cached as "this build has no FTS5", costing the process
    every ranked search it would ever run.
    """
    await _seed(db_session)
    await db_session.execute(text("DROP TABLE documents_fts"))
    doc_search.reset_availability_cache()
    assert await doc_search.fts_available(db_session) is False

    await db_session.execute(text(
        "CREATE VIRTUAL TABLE documents_fts USING fts5(doc_id UNINDEXED, title, tags, body)"
    ))
    doc_search._checked_at -= doc_search._RECHECK_SECONDS

    assert await doc_search.fts_available(db_session) is True


async def test_a_failed_probe_is_not_repeated_within_the_interval(db_session: AsyncSession):
    """The retry is bounded: a build genuinely without FTS5 must not re-probe
    on every document write for the life of the process."""
    await db_session.execute(text("DROP TABLE documents_fts"))
    doc_search.reset_availability_cache()
    assert await doc_search.fts_available(db_session) is False

    # The index is back, but the negative answer is still fresh, so nothing
    # probes and the caller keeps getting LIKE until the interval is up.
    await db_session.execute(text(
        "CREATE VIRTUAL TABLE documents_fts USING fts5(doc_id UNINDEXED, title, tags, body)"
    ))
    assert await doc_search.fts_available(db_session) is False


async def test_an_available_index_is_not_re_probed(db_session: AsyncSession):
    """Success is final — the hot path stays one dict lookup."""
    assert await doc_search.fts_available(db_session) is True
    await db_session.execute(text("DROP TABLE documents_fts"))

    assert await doc_search.fts_available(db_session) is True


async def test_unavailability_is_logged_once_not_on_every_probe(
    db_session: AsyncSession, caplog
):
    """The fallback is a supported mode, not an incident to report per request."""
    await db_session.execute(text("DROP TABLE documents_fts"))
    doc_search.reset_availability_cache()

    with caplog.at_level(logging.INFO, logger="app.services.doc_search"):
        await doc_search.fts_available(db_session)
        doc_search._checked_at -= doc_search._RECHECK_SECONDS
        await doc_search.fts_available(db_session)

    assert sum("FTS5 unavailable" in r.message for r in caplog.records) == 1


async def test_an_index_that_vanishes_degrades_the_write_instead_of_failing_it(
    db_session: AsyncSession,
):
    """Regression for #448, the other direction.

    A cached "available" plus an index dropped underneath used to raise straight
    out of `index_document` and 500 the document save. The index is best-effort:
    the document write survives it, and search drops to LIKE.
    """
    await _seed(db_session)
    assert await doc_search.fts_available(db_session) is True
    await db_session.execute(text("DROP TABLE documents_fts"))

    doc = _doc(title="Switch", slug="switch", body="A stack of two.")
    db_session.add(doc)
    await db_session.flush()
    await doc_search.index_document(db_session, doc)

    assert doc_search._available is False
    # The savepoint rolled back the index write alone — the document is intact.
    await db_session.flush()
    stored = (await db_session.execute(
        text("SELECT title FROM documents WHERE slug = 'switch'")
    )).scalar_one()
    assert stored == "Switch"


async def test_unindexing_against_a_vanished_index_does_not_raise(db_session: AsyncSession):
    docs = await _seed(db_session)
    assert await doc_search.fts_available(db_session) is True
    await db_session.execute(text("DROP TABLE documents_fts"))

    await doc_search.unindex_document(db_session, docs[0].id)

    assert doc_search._available is False


def test_excerpt_centres_on_the_match():
    body = "x" * 200 + "needle" + "y" * 200
    excerpt = doc_search._excerpt(body, "needle")
    assert "needle" in excerpt
    assert excerpt.startswith("…") and excerpt.endswith("…")


def test_excerpt_falls_back_to_the_head_when_there_is_no_match():
    assert doc_search._excerpt("short body", "absent") == "short body"
