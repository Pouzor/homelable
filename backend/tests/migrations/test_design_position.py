"""designs.position (#461), added at startup to a database created before it existed."""
import os

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

import app.db.database as database

pytestmark = pytest.mark.asyncio


@pytest.fixture
def legacy_engine(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    monkeypatch.setattr(database.settings, "sqlite_path", str(db_path))
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setattr(database, "engine", engine)
    return engine


async def _positions(engine) -> list[tuple[str, int | None]]:
    async with engine.begin() as conn:
        rows = (await conn.exec_driver_sql("SELECT id, position FROM designs ORDER BY id")).fetchall()
    return [tuple(r) for r in rows]


async def test_backfills_positions_in_creation_order(legacy_engine):
    async with legacy_engine.begin() as conn:
        await conn.exec_driver_sql(
            "CREATE TABLE designs (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, "
            "design_type VARCHAR NOT NULL DEFAULT 'network', icon VARCHAR, "
            "created_at DATETIME, updated_at DATETIME)"
        )
        # Inserted out of creation order, so the backfill must sort, not follow rowid.
        for design_id, created in (("b", "2026-02-01"), ("c", "2026-03-01"), ("a", "2026-01-01")):
            await conn.exec_driver_sql(
                "INSERT INTO designs (id, name, created_at) VALUES (?, ?, ?)", (design_id, design_id, created)
            )

    await database.init_db()
    assert await _positions(legacy_engine) == [("a", 0), ("b", 1), ("c", 2)]

    # A user reorder survives a restart: the backfill only fills NULLs.
    async with legacy_engine.begin() as conn:
        await conn.exec_driver_sql("UPDATE designs SET position = 2 WHERE id = 'a'")
        await conn.exec_driver_sql("UPDATE designs SET position = 0 WHERE id = 'c'")
    await database.init_db()
    assert await _positions(legacy_engine) == [("a", 2), ("b", 1), ("c", 0)]
    await legacy_engine.dispose()


async def test_row_without_position_goes_after_the_positioned_ones(legacy_engine):
    await database.init_db()  # fresh database: seeds one design at position 0
    async with legacy_engine.begin() as conn:
        await conn.exec_driver_sql(
            "INSERT INTO designs (id, name, design_type, created_at, updated_at) "
            "VALUES ('late', 'Late', 'network', '2000-01-01', '2000-01-01')"
        )
    await database.init_db()

    async with legacy_engine.begin() as conn:
        rows = (await conn.exec_driver_sql("SELECT id, position FROM designs ORDER BY position")).fetchall()
    assert [r[1] for r in rows] == [0, 1]
    assert rows[1][0] == "late"
    await legacy_engine.dispose()
