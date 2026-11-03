"""scan_runs.label, added at startup to a database created before it existed."""
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


async def _columns(engine) -> set[str]:
    async with engine.begin() as conn:
        rows = (await conn.exec_driver_sql("PRAGMA table_info(scan_runs)")).fetchall()
    return {r[1] for r in rows}


async def test_adds_label_keeping_existing_runs(legacy_engine):
    async with legacy_engine.begin() as conn:
        await conn.exec_driver_sql(
            "CREATE TABLE scan_runs (id VARCHAR PRIMARY KEY, status VARCHAR, "
            "kind TEXT NOT NULL DEFAULT 'ip', ranges JSON, devices_found INTEGER, "
            "started_at DATETIME, finished_at DATETIME, error TEXT)"
        )
        await conn.exec_driver_sql(
            "INSERT INTO scan_runs (id, status, kind, ranges, devices_found) "
            "VALUES ('r1', 'done', 'proxmox', '[\"pve:8006\"]', 3)"
        )

    await database.init_db()
    await database.init_db()  # safe to run twice

    assert "label" in await _columns(legacy_engine)
    async with legacy_engine.begin() as conn:
        row = (await conn.exec_driver_sql("SELECT id, label FROM scan_runs")).fetchall()
    assert [tuple(r) for r in row] == [("r1", None)]
    await legacy_engine.dispose()
