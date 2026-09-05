"""The documents DDL `create_all` cannot express.

A virtual table and three partial indexes, applied through `_try_migrate` at
boot. Both have to survive a second boot untouched, and the partial uniques are
what stop two documents claiming the same device behind the route's own check.
"""

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.database import DOCUMENT_DDL, Base, _try_migrate

pytestmark = pytest.mark.asyncio


async def _boot(tmp_path, times: int = 1):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    for _ in range(times):
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            for label, sql in DOCUMENT_DDL:
                await _try_migrate(conn, sql, label=label)
    return engine


async def _names(engine, kind: str) -> set[str]:
    async with engine.begin() as conn:
        rows = (
            await conn.exec_driver_sql(f"SELECT name FROM sqlite_master WHERE type = '{kind}'")
        ).fetchall()
    return {row[0] for row in rows}


async def test_the_tables_and_the_search_index_are_created(tmp_path):
    engine = await _boot(tmp_path)
    tables = await _names(engine, "table")
    assert {"documents", "document_revisions", "documents_fts"} <= tables
    await engine.dispose()


async def test_the_partial_uniques_are_created(tmp_path):
    engine = await _boot(tmp_path)
    indexes = await _names(engine, "index")
    assert {"ux_documents_device", "ux_documents_node", "ux_documents_design"} <= indexes
    await engine.dispose()


async def test_a_second_boot_changes_nothing(tmp_path):
    engine = await _boot(tmp_path, times=3)
    tables = await _names(engine, "table")
    assert {"documents", "documents_fts"} <= tables
    await engine.dispose()


async def test_two_documents_cannot_claim_the_same_device(tmp_path):
    engine = await _boot(tmp_path)
    async with engine.begin() as conn:
        insert = (
            "INSERT INTO documents (id, kind, title, slug, body, device_id, sort_order, "
            "frontmatter, tags, starred, created_at, updated_at) "
            "VALUES (?, 'device', 'nas', ?, '', 'dev-1', 0, '{}', '[]', 0, "
            "'2026-09-05', '2026-09-05')"
        )
        await conn.exec_driver_sql(insert, ("a", "nas"))
        with pytest.raises(IntegrityError):
            await conn.exec_driver_sql(insert, ("b", "nas-2"))
    await engine.dispose()


async def test_many_documents_may_have_no_device(tmp_path):
    engine = await _boot(tmp_path)
    async with engine.begin() as conn:
        insert = (
            "INSERT INTO documents (id, kind, title, slug, body, device_id, sort_order, "
            "frontmatter, tags, starred, created_at, updated_at) "
            "VALUES (?, 'page', 'p', ?, '', NULL, 0, '{}', '[]', 0, "
            "'2026-09-05', '2026-09-05')"
        )
        await conn.exec_driver_sql(insert, ("a", "p1"))
        await conn.exec_driver_sql(insert, ("b", "p2"))
        count = (await conn.exec_driver_sql("SELECT COUNT(*) FROM documents")).scalar_one()
    assert count == 2
    await engine.dispose()
