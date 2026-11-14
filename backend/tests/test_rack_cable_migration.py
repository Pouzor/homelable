"""Column additions to `rack_cables` and `rack_devices`, applied at boot through `_try_migrate`.

A database created before a column landed keeps its old shape — `create_all`
never alters an existing table — so every query naming the new column would fail
with `no such column`. Each migration must bring such a table up to date, keep
its rows, and survive a second boot untouched.
"""

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.database import RACK_CABLE_MIGRATIONS, RACK_DEVICE_COLOR_MIGRATIONS, _try_migrate

pytestmark = pytest.mark.asyncio

# `rack_cables` as the first rack release created it, before any annotation.
LEGACY_RACK_CABLES = """
CREATE TABLE rack_cables (
    id VARCHAR PRIMARY KEY,
    design_id VARCHAR NOT NULL,
    from_device_id VARCHAR NOT NULL,
    from_port_id VARCHAR NOT NULL,
    to_device_id VARCHAR NOT NULL,
    to_port_id VARCHAR NOT NULL,
    type VARCHAR,
    color VARCHAR,
    label VARCHAR,
    created_at DATETIME
)
"""


async def test_brings_a_legacy_table_up_to_date_and_runs_twice(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'legacy.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(LEGACY_RACK_CABLES)
        await conn.exec_driver_sql(
            "INSERT INTO rack_cables (id, design_id, from_device_id, from_port_id, "
            "to_device_id, to_port_id) VALUES ('c1', 'd1', 'a', 'p1', 'b', 'p2')"
        )

    for _ in range(2):
        async with engine.begin() as conn:
            for label, sql in RACK_CABLE_MIGRATIONS:
                await _try_migrate(conn, sql, label=label)

    async with engine.begin() as conn:
        columns = {
            row[1]
            for row in (await conn.exec_driver_sql("PRAGMA table_info(rack_cables)")).fetchall()
        }
        row = (
            await conn.exec_driver_sql(
                "SELECT label_offset_x, label_offset_y, label_visible FROM rack_cables"
            )
        ).one()
    await engine.dispose()

    assert {"label_visible", "properties", "label_offset_x", "label_offset_y"} <= columns
    # An existing cable keeps its plate on the midpoint, where it always was.
    assert tuple(row) == (0, 0, 0)


async def test_adds_the_plate_colour_columns_to_a_legacy_mount_table(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'legacy.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "CREATE TABLE rack_devices (id VARCHAR PRIMARY KEY, color VARCHAR)"
        )
        await conn.exec_driver_sql("INSERT INTO rack_devices (id, color) VALUES ('d1', '#fff')")

    for _ in range(2):
        async with engine.begin() as conn:
            for label, sql in RACK_DEVICE_COLOR_MIGRATIONS:
                await _try_migrate(conn, sql, label=label)

    async with engine.begin() as conn:
        row = (
            await conn.exec_driver_sql("SELECT color, text_color, bay_color FROM rack_devices")
        ).one()
    await engine.dispose()
    # An existing mount keeps its fill and gains no override.
    assert tuple(row) == ("#fff", None, None)
