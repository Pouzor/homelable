"""Search over documents, on both engines.

FTS5 is not guaranteed by the SQLite build the LXC and Docker images ship, so
the LIKE fallback is a supported path, not a safety net — it gets the same
coverage as the index.
"""

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


def test_excerpt_centres_on_the_match():
    body = "x" * 200 + "needle" + "y" * 200
    excerpt = doc_search._excerpt(body, "needle")
    assert "needle" in excerpt
    assert excerpt.startswith("…") and excerpt.endswith("…")


def test_excerpt_falls_back_to_the_head_when_there_is_no_match():
    assert doc_search._excerpt("short body", "absent") == "short body"
