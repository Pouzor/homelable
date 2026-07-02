"""Backward-compatibility tests for the legacy → multi-design migration.

Simulates a database created by a pre-"designs" version of the app and asserts
that running init_db() adopts all existing nodes/edges/canvas into a single
default "Network Topology" design with no data loss. The rest of the test suite
builds the *current* schema via create_all and never exercises this upgrade
path, so this file guards real users upgrading in place.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

import app.db.database as database


@pytest.fixture
def legacy_engine(tmp_path, monkeypatch):
    """Point the module-global engine + sqlite_path at a throwaway legacy DB."""
    db_path = tmp_path / "legacy.db"
    monkeypatch.setattr(database.settings, "sqlite_path", str(db_path))
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setattr(database, "engine", engine)
    return db_path, engine


async def _build_legacy_schema(engine) -> None:
    """Create the pre-designs schema (no design_id, integer canvas_state PK)."""
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "CREATE TABLE nodes (id VARCHAR PRIMARY KEY, type VARCHAR, label VARCHAR, "
            "status VARCHAR, services JSON, pos_x FLOAT, pos_y FLOAT)"
        )
        await conn.exec_driver_sql(
            "CREATE TABLE edges (id VARCHAR PRIMARY KEY, source VARCHAR, target VARCHAR, type VARCHAR)"
        )
        await conn.exec_driver_sql(
            "CREATE TABLE canvas_state (id INTEGER PRIMARY KEY, viewport JSON, "
            "custom_style JSON, saved_at DATETIME)"
        )
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, status, services, pos_x, pos_y) "
            "VALUES ('n1','server','Old Server','online','[]',10,20)"
        )
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, status, services, pos_x, pos_y) "
            "VALUES ('n2','router','Old Router','offline','[]',30,40)"
        )
        await conn.exec_driver_sql(
            "INSERT INTO edges (id, source, target, type) VALUES ('e1','n1','n2','ethernet')"
        )
        await conn.exec_driver_sql(
            "INSERT INTO canvas_state (id, viewport, custom_style, saved_at) "
            "VALUES (1, '{\"x\":5,\"y\":6,\"zoom\":2}', NULL, '2024-01-01 00:00:00')"
        )


async def test_legacy_canvas_migrates_into_default_design(legacy_engine):
    db_path, engine = legacy_engine
    await _build_legacy_schema(engine)

    await database.init_db()

    check = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    try:
        async with check.begin() as conn:
            # Exactly one seeded default design.
            designs = (await conn.exec_driver_sql(
                "SELECT id, name, design_type, icon FROM designs"
            )).fetchall()
            assert len(designs) == 1
            did, name, dtype, icon = designs[0]
            assert name == "Network Topology"
            assert dtype == "network"
            assert icon == "dashboard"

            # Every legacy node adopted into the default design, data preserved.
            nodes = (await conn.exec_driver_sql(
                "SELECT id, label, status, design_id FROM nodes ORDER BY id"
            )).fetchall()
            assert [(n[0], n[1], n[2]) for n in nodes] == [
                ("n1", "Old Server", "online"),
                ("n2", "Old Router", "offline"),
            ]
            assert all(n[3] == did for n in nodes)

            # Legacy edge adopted too.
            edge = (await conn.exec_driver_sql(
                "SELECT design_id FROM edges WHERE id='e1'"
            )).fetchone()
            assert edge[0] == did

            # canvas_state rebuilt with design_id PK; the old id=1 row maps to the
            # default design and the viewport survives.
            cs = (await conn.exec_driver_sql(
                "SELECT design_id, viewport FROM canvas_state"
            )).fetchall()
            assert len(cs) == 1
            assert cs[0][0] == did
            assert "zoom" in (cs[0][1] or "")
    finally:
        await check.dispose()
        await engine.dispose()


async def test_legacy_nodes_gain_last_scan_column(legacy_engine):
    """A legacy nodes table (no last_scan) gains the column after init_db."""
    db_path, engine = legacy_engine
    await _build_legacy_schema(engine)

    await database.init_db()

    check = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    try:
        async with check.begin() as conn:
            cols = (await conn.exec_driver_sql("PRAGMA table_info(nodes)")).fetchall()
            assert "last_scan" in {c[1] for c in cols}
            # Existing rows backfill to NULL (never scanned yet).
            last_scan = (await conn.exec_driver_sql(
                "SELECT last_scan FROM nodes WHERE id='n1'"
            )).fetchone()
            assert last_scan[0] is None
    finally:
        await check.dispose()
        await engine.dispose()


async def test_migration_is_idempotent(legacy_engine):
    """Running init_db twice must not duplicate the design or drop any data."""
    db_path, engine = legacy_engine
    await _build_legacy_schema(engine)

    await database.init_db()
    await database.init_db()  # second boot — should be a no-op

    check = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    try:
        async with check.begin() as conn:
            designs = (await conn.exec_driver_sql("SELECT id FROM designs")).fetchall()
            assert len(designs) == 1
            did = designs[0][0]

            nodes = (await conn.exec_driver_sql(
                "SELECT design_id FROM nodes"
            )).fetchall()
            assert len(nodes) == 2
            assert all(n[0] == did for n in nodes)

            cs = (await conn.exec_driver_sql("SELECT design_id FROM canvas_state")).fetchall()
            assert len(cs) == 1
            assert cs[0][0] == did
    finally:
        await check.dispose()
        await engine.dispose()
