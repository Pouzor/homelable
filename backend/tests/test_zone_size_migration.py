"""Moving a zone's size out of the custom_colors blob into the real columns.

Every node type stored its size in `nodes.width` / `nodes.height` except
`groupRect`, which kept it inside the style JSON. Get this backfill wrong and
every zone a user ever drew comes back at the default 360x240, losing a layout
they arranged by hand.
"""
import json

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

import app.db.database as database

pytestmark = pytest.mark.asyncio

_DDL = (
    "CREATE TABLE nodes ("
    "id VARCHAR PRIMARY KEY, type VARCHAR, label VARCHAR, "
    "custom_colors JSON, width FLOAT, height FLOAT)"
)


async def _engine(tmp_path, rows):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'zones.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_DDL)
        for node_id, node_type, colors, width, height in rows:
            await conn.exec_driver_sql(
                "INSERT INTO nodes (id, type, label, custom_colors, width, height) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (node_id, node_type, node_id, json.dumps(colors) if colors else None, width, height),
            )
    return engine


async def _sizes(engine) -> dict[str, tuple]:
    async with engine.begin() as conn:
        rows = (await conn.exec_driver_sql("SELECT id, width, height FROM nodes")).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


async def _run(engine, monkeypatch) -> None:
    monkeypatch.setattr(database, "engine", engine)
    await database._backfill_zone_size()


async def test_moves_the_size_from_the_blob_to_the_columns(tmp_path, monkeypatch):
    engine = await _engine(
        tmp_path,
        [("z1", "groupRect", {"width": 640, "height": 480, "border": "#0ff"}, None, None)],
    )

    await _run(engine, monkeypatch)

    assert (await _sizes(engine))["z1"] == (640, 480)
    # The style the blob actually owns is untouched.
    async with engine.begin() as conn:
        blob = (await conn.exec_driver_sql("SELECT custom_colors FROM nodes")).scalar()
    assert json.loads(blob)["border"] == "#0ff"
    await engine.dispose()


async def test_never_overwrites_a_size_already_in_the_columns(tmp_path, monkeypatch):
    # A zone resized since the upgrade: the column is the truth, and a stale
    # blob left over from before must not win.
    engine = await _engine(
        tmp_path,
        [("z1", "groupRect", {"width": 111, "height": 222}, 800, None)],
    )

    await _run(engine, monkeypatch)

    assert (await _sizes(engine))["z1"] == (800, 222)
    await engine.dispose()


async def test_leaves_other_node_types_alone(tmp_path, monkeypatch):
    # Only zones ever stashed their size in the blob. A width key on any other
    # type is not geometry we should be moving.
    engine = await _engine(tmp_path, [("s1", "server", {"width": 999}, None, None)])

    await _run(engine, monkeypatch)

    assert (await _sizes(engine))["s1"] == (None, None)
    await engine.dispose()


async def test_skips_a_blob_with_no_usable_size(tmp_path, monkeypatch):
    engine = await _engine(
        tmp_path,
        [
            ("colors_only", "groupRect", {"border": "#0ff"}, None, None),
            ("not_a_number", "groupRect", {"width": "wide", "height": True}, None, None),
            ("no_blob", "groupRect", None, None, None),
        ],
    )

    await _run(engine, monkeypatch)

    sizes = await _sizes(engine)
    assert sizes["colors_only"] == (None, None)
    assert sizes["not_a_number"] == (None, None)
    assert sizes["no_blob"] == (None, None)
    await engine.dispose()


async def test_survives_a_corrupt_blob_without_killing_boot(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'zones.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_DDL)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, custom_colors) VALUES ('bad', 'groupRect', 'b', '{oops')"
        )
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, custom_colors) "
            "VALUES ('good', 'groupRect', 'g', '{\"width\": 500, \"height\": 400}')"
        )

    await _run(engine, monkeypatch)

    sizes = await _sizes(engine)
    assert sizes["bad"] == (None, None)
    # One unreadable row must not cost the others their size.
    assert sizes["good"] == (500, 400)
    await engine.dispose()


async def test_is_idempotent(tmp_path, monkeypatch):
    engine = await _engine(
        tmp_path,
        [("z1", "groupRect", {"width": 640, "height": 480}, None, None)],
    )

    await _run(engine, monkeypatch)
    await _run(engine, monkeypatch)

    assert (await _sizes(engine))["z1"] == (640, 480)
    await engine.dispose()
