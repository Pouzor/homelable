"""The application engine's SQLite connection settings."""
import pytest

from app.db.database import SQLITE_LOCK_TIMEOUT, create_app_engine

pytestmark = pytest.mark.asyncio


async def test_engine_waits_for_the_write_lock(tmp_path):
    """Writers queue on a busy database instead of failing after the driver's
    default 5 s with "database is locked" (#539)."""
    engine = create_app_engine(tmp_path / "test.db")
    try:
        async with engine.connect() as conn:
            busy_ms = (await conn.exec_driver_sql("PRAGMA busy_timeout")).scalar()
    finally:
        await engine.dispose()

    assert SQLITE_LOCK_TIMEOUT > 5
    assert busy_ms == SQLITE_LOCK_TIMEOUT * 1000
