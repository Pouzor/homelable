"""The pending_devices -> device_inventory rename, run at startup.

It is the one migration that must happen *before* `create_all`, so it gets its
own suite: get the order wrong and every device a user ever scanned reads as
gone, because the app looks at a freshly created empty table.
"""
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.database import _rename_legacy_tables

pytestmark = pytest.mark.asyncio


def _legacy_ddl(table: str) -> str:
    return f"CREATE TABLE {table} (id VARCHAR PRIMARY KEY, hostname VARCHAR)"


async def _engine(tmp_path, *, statements: list[str]):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        for sql in statements:
            await conn.exec_driver_sql(sql)
    return engine


async def _tables(engine) -> set[str]:
    async with engine.begin() as conn:
        rows = (
            await conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")
        ).fetchall()
    return {r[0] for r in rows}


async def _rename(engine) -> None:
    async with engine.begin() as conn:
        await _rename_legacy_tables(conn)


async def test_renames_the_legacy_tables_keeping_their_rows(tmp_path):
    engine = await _engine(
        tmp_path,
        statements=[
            _legacy_ddl("pending_devices"),
            _legacy_ddl("pending_device_links"),
            "INSERT INTO pending_devices (id, hostname) VALUES ('d1', 'nas')",
        ],
    )

    await _rename(engine)

    assert await _tables(engine) == {"device_inventory", "device_inventory_links"}
    async with engine.begin() as conn:
        rows = (await conn.exec_driver_sql("SELECT hostname FROM device_inventory")).fetchall()
    assert [r[0] for r in rows] == ["nas"]
    await engine.dispose()


async def test_rewrites_the_reference_from_rack_devices(tmp_path):
    # `rack_devices.device_id` names the inventory table. Left pointing at the
    # old name, the schema references a table that no longer exists.
    engine = await _engine(
        tmp_path,
        statements=[
            _legacy_ddl("pending_devices"),
            "CREATE TABLE rack_devices (id VARCHAR PRIMARY KEY, device_id VARCHAR "
            "REFERENCES pending_devices(id) ON DELETE SET NULL)",
        ],
    )

    await _rename(engine)

    async with engine.begin() as conn:
        ddl = (
            await conn.exec_driver_sql(
                "SELECT sql FROM sqlite_master WHERE name='rack_devices'"
            )
        ).scalar()
    assert "device_inventory" in ddl
    assert "pending_devices" not in ddl
    await engine.dispose()


async def test_replaces_an_empty_table_left_by_an_earlier_start(tmp_path):
    # A start that ran `create_all` before this migration existed created the new
    # table empty, and the app read that one instead of the user's devices.
    engine = await _engine(
        tmp_path,
        statements=[
            _legacy_ddl("pending_devices"),
            _legacy_ddl("device_inventory"),
            "INSERT INTO pending_devices (id, hostname) VALUES ('d1', 'nas')",
        ],
    )

    await _rename(engine)

    assert await _tables(engine) == {"device_inventory"}
    async with engine.begin() as conn:
        count = (await conn.exec_driver_sql("SELECT COUNT(*) FROM device_inventory")).scalar()
    assert count == 1
    await engine.dispose()


async def test_leaves_two_populated_tables_alone(tmp_path):
    # Rows on both sides is not a state this migration created, and dropping
    # either one would lose data.
    engine = await _engine(
        tmp_path,
        statements=[
            _legacy_ddl("pending_devices"),
            _legacy_ddl("device_inventory"),
            "INSERT INTO pending_devices (id, hostname) VALUES ('d1', 'old')",
            "INSERT INTO device_inventory (id, hostname) VALUES ('d2', 'new')",
        ],
    )

    await _rename(engine)

    assert await _tables(engine) == {"pending_devices", "device_inventory"}
    await engine.dispose()


async def test_is_a_no_op_on_a_fresh_database(tmp_path):
    engine = await _engine(tmp_path, statements=[_legacy_ddl("device_inventory")])

    await _rename(engine)
    await _rename(engine)  # And still a no-op the second time round.

    assert await _tables(engine) == {"device_inventory"}
    await engine.dispose()
