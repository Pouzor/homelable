"""Slugs, frontmatter parsing, and the two tree guards."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document
from app.services import doc_tree


def _doc(**kwargs) -> Document:
    base = dict(kind="folder", title="T", slug="t", body="")
    base.update(kwargs)
    return Document(**base)


# ── slugs ───────────────────────────────────────────────────────────────────


def test_slugify_lowercases_and_collapses_punctuation():
    assert doc_tree.slugify("NAS-01 / main storage!") == "nas-01-main-storage"


def test_slugify_of_nothing_is_untitled():
    assert doc_tree.slugify("") == "untitled"
    assert doc_tree.slugify("   ") == "untitled"
    assert doc_tree.slugify("!!!") == "untitled"


def test_slugify_truncates_a_long_title():
    assert len(doc_tree.slugify("x" * 200)) == 80


async def test_unique_slug_suffixes_a_taken_sibling(db_session: AsyncSession):
    db_session.add(_doc(title="Network", slug="network"))
    await db_session.flush()
    assert await doc_tree.unique_slug(db_session, "Network", parent_id=None) == "network-2"


async def test_unique_slug_keeps_counting_past_the_second(db_session: AsyncSession):
    db_session.add(_doc(slug="network"))
    db_session.add(_doc(slug="network-2"))
    await db_session.flush()
    assert await doc_tree.unique_slug(db_session, "Network", parent_id=None) == "network-3"


async def test_unique_slug_only_looks_at_siblings(db_session: AsyncSession):
    parent = _doc(title="Folder", slug="folder")
    db_session.add(parent)
    await db_session.flush()
    db_session.add(_doc(slug="network", parent_id=parent.id))
    await db_session.flush()
    # Same slug, different parent — no clash.
    assert await doc_tree.unique_slug(db_session, "Network", parent_id=None) == "network"


async def test_unique_slug_ignores_the_document_being_renamed(db_session: AsyncSession):
    doc = _doc(title="Network", slug="network")
    db_session.add(doc)
    await db_session.flush()
    assert await doc_tree.unique_slug(db_session, "Network", parent_id=None, exclude_id=doc.id) == "network"


# ── frontmatter ─────────────────────────────────────────────────────────────


def test_parse_frontmatter_reads_the_leading_block():
    body = "---\ntitle: NAS\ntags: [a, b]\n---\n\n# NAS\n"
    assert doc_tree.parse_frontmatter(body) == {"title": "NAS", "tags": ["a", "b"]}


def test_parse_frontmatter_ignores_a_block_that_is_not_first():
    assert doc_tree.parse_frontmatter("# Title\n\n---\ntitle: NAS\n---\n") == {}


def test_parse_frontmatter_of_malformed_yaml_is_empty_not_an_error():
    # The user is mid-edit; the cache goes stale, the save does not fail.
    assert doc_tree.parse_frontmatter("---\ntitle: [unclosed\n---\nbody") == {}


def test_parse_frontmatter_of_a_non_mapping_is_empty():
    assert doc_tree.parse_frontmatter("---\n- a\n- b\n---\n") == {}


def test_parse_frontmatter_of_an_empty_body_is_empty():
    assert doc_tree.parse_frontmatter("") == {}


def test_parse_frontmatter_keeps_a_trailing_space_on_the_fence():
    assert doc_tree.parse_frontmatter("--- \ntitle: NAS\n--- \n") == {"title": "NAS"}


def test_parse_frontmatter_of_an_unclosed_block_does_not_go_quadratic():
    """A body that opens a block and never closes it must still be linear.

    The shape a document has while the block is being typed, and the input the
    scanner named: `---\n` then many repetitions of `\n `. With `\s*` around the
    fences the closing alternative was reachable two ways and each added line
    multiplied the backtracking.
    """
    import time

    body = "---\n" + "\n " * 40_000
    started = time.perf_counter()
    assert doc_tree.parse_frontmatter(body) == {}
    assert time.perf_counter() - started < 1.0


def test_tags_accepts_a_list_or_a_comma_string():
    assert doc_tree.tags_from({"tags": ["a", " b "]}) == ["a", "b"]
    assert doc_tree.tags_from({"tags": "a, b"}) == ["a", "b"]
    assert doc_tree.tags_from({"tags": 7}) == []
    assert doc_tree.tags_from({}) == []


# ── tree guards ─────────────────────────────────────────────────────────────


async def _chain(db_session: AsyncSession, depth: int) -> list[Document]:
    docs: list[Document] = []
    parent_id = None
    for i in range(depth):
        doc = _doc(title=f"L{i}", slug=f"l{i}", parent_id=parent_id)
        db_session.add(doc)
        await db_session.flush()
        docs.append(doc)
        parent_id = doc.id
    return docs


async def test_is_ancestor_walks_the_whole_chain(db_session: AsyncSession):
    a, b, c = await _chain(db_session, 3)
    assert await doc_tree.is_ancestor(db_session, a.id, c.id)
    assert not await doc_tree.is_ancestor(db_session, c.id, a.id)


async def test_a_document_is_its_own_ancestor(db_session: AsyncSession):
    (a,) = await _chain(db_session, 1)
    assert await doc_tree.is_ancestor(db_session, a.id, a.id)


async def test_subtree_ids_collects_every_descendant(db_session: AsyncSession):
    a, b, c = await _chain(db_session, 3)
    sibling = _doc(title="S", slug="s", parent_id=a.id)
    db_session.add(sibling)
    await db_session.flush()
    ids = await doc_tree.subtree_ids(db_session, a.id)
    assert set(ids) == {a.id, b.id, c.id, sibling.id}
    # Root first, so a caller deleting in reverse removes leaves first.
    assert ids[0] == a.id


async def test_subtree_ids_of_a_leaf_is_just_itself(db_session: AsyncSession):
    (a,) = await _chain(db_session, 1)
    assert await doc_tree.subtree_ids(db_session, a.id) == [a.id]
