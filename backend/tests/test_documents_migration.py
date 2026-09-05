"""The documents DDL `create_all` does not apply.

Column additions to an existing table (which `create_all` never makes), plus a
virtual table and three partial indexes (which it cannot express at all), all
applied through `_try_migrate` at boot. Every one has to survive a second boot
untouched, and the partial uniques are what stop two documents claiming the same
device behind the route's own check.
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


# ── columns added to a table that already exists ─────────────────────────────

# `documents` as an earlier build of the feature created it: no `edited_at`.
_DOCUMENTS_WITHOUT_EDITED_AT = (
    "CREATE TABLE documents ("
    "id VARCHAR NOT NULL PRIMARY KEY, kind VARCHAR NOT NULL, title VARCHAR NOT NULL, "
    "slug VARCHAR NOT NULL, icon VARCHAR, parent_id VARCHAR, sort_order INTEGER, "
    "device_id VARCHAR, node_id VARCHAR, design_id VARCHAR, body TEXT NOT NULL, "
    "frontmatter JSON, tags JSON, starred BOOLEAN, template_id VARCHAR, "
    "facts_snapshot JSON, facts_synced_at DATETIME, reviewed_at DATETIME, "
    "created_at DATETIME, updated_at DATETIME)"
)


async def _columns(engine, table: str) -> list[str]:
    async with engine.begin() as conn:
        rows = (await conn.exec_driver_sql(f"PRAGMA table_info({table})")).fetchall()
    return [row[1] for row in rows]


async def test_an_existing_table_gains_the_columns_create_all_would_not_add(tmp_path):
    """The regression: `create_all` makes a missing table, never a missing column.

    A database that met an earlier shape of `documents` kept it, and every query
    naming `edited_at` failed with ``no such column: documents.edited_at`` —
    including the one behind opening the Documentation section.
    """
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_DOCUMENTS_WITHOUT_EDITED_AT)
    assert "edited_at" not in await _columns(engine, "documents")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)  # sees the table, leaves it be
        for label, sql in DOCUMENT_DDL:
            await _try_migrate(conn, sql, label=label)

    assert "edited_at" in await _columns(engine, "documents")
    await engine.dispose()


async def test_the_old_rows_survive_the_column_being_added(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_DOCUMENTS_WITHOUT_EDITED_AT)
        await conn.exec_driver_sql(
            "INSERT INTO documents (id, kind, title, slug, body) "
            "VALUES ('d1', 'page', 'Rebuild plan', 'rebuild-plan', '# Rebuild plan')"
        )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for label, sql in DOCUMENT_DDL:
            await _try_migrate(conn, sql, label=label)

    async with engine.begin() as conn:
        row = (
            await conn.exec_driver_sql("SELECT title, body, edited_at FROM documents WHERE id = 'd1'")
        ).fetchone()
    assert row == ("Rebuild plan", "# Rebuild plan", None)
    await engine.dispose()


async def test_a_fresh_database_has_every_column(tmp_path):
    engine = await _boot(tmp_path, times=2)
    columns = await _columns(engine, "documents")
    assert "edited_at" in columns
    # The re-stated ALTERs are idempotent: no column is added twice.
    assert len(columns) == len(set(columns))
    await engine.dispose()
