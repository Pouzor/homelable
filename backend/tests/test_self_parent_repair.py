"""Detaching nodes recorded as their own parent (#370).

A ``parent_id = id`` row is fatal on the canvas: every parent walk assumes an
acyclic tree, so dragging the node overflowed the stack inside the change
reducer and the move was silently dropped — the node selected but would not
move. It also renders unparented, sitting wherever its stored coordinates put
it rather than inside the container it appears to belong to.

The repair runs at startup because the bad rows are already in users' databases;
the write-path guards shipped alongside it only stop new ones.
"""
import pytest
from sqlalchemy.ext.asyncio import create_async_engine

import app.db.database as database

pytestmark = pytest.mark.asyncio

_DDL = "CREATE TABLE nodes (id VARCHAR PRIMARY KEY, label VARCHAR, parent_id VARCHAR)"


async def _engine(tmp_path, rows):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'selfparent.db'}")
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_DDL)
        for node_id, parent_id in rows:
            await conn.exec_driver_sql(
                "INSERT INTO nodes (id, label, parent_id) VALUES (?, ?, ?)",
                (node_id, node_id, parent_id),
            )
    return engine


async def _parents(engine) -> dict[str, str | None]:
    async with engine.begin() as conn:
        rows = (await conn.exec_driver_sql("SELECT id, parent_id FROM nodes")).fetchall()
    return {r[0]: r[1] for r in rows}


async def _run(engine, monkeypatch) -> None:
    monkeypatch.setattr(database, "engine", engine)
    await database._repair_self_parent_nodes()


async def test_detaches_a_self_parented_node(tmp_path, monkeypatch):
    engine = await _engine(tmp_path, [("pihole", "pihole")])

    await _run(engine, monkeypatch)

    assert (await _parents(engine))["pihole"] is None


async def test_leaves_real_parents_alone(tmp_path, monkeypatch):
    engine = await _engine(
        tmp_path,
        [("pve", None), ("vm", "pve"), ("broken", "broken")],
    )

    await _run(engine, monkeypatch)

    parents = await _parents(engine)
    assert parents == {"pve": None, "vm": "pve", "broken": None}


async def test_is_idempotent(tmp_path, monkeypatch):
    engine = await _engine(tmp_path, [("a", "a"), ("b", None)])

    await _run(engine, monkeypatch)
    await _run(engine, monkeypatch)

    assert await _parents(engine) == {"a": None, "b": None}


async def test_does_not_touch_a_two_node_cycle(tmp_path, monkeypatch):
    """Only the exact self-parent case is repairable here.

    A longer cycle has no single right answer for which link to cut, and the
    runtime cycle guards keep the canvas usable, so the rows are left as they
    are rather than guessed at.
    """
    engine = await _engine(tmp_path, [("a", "b"), ("b", "a")])

    await _run(engine, monkeypatch)

    assert await _parents(engine) == {"a": "b", "b": "a"}


async def test_survives_a_missing_table(tmp_path, monkeypatch):
    """Boot must not die on a repair; the canvas works either way."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}")

    await _run(engine, monkeypatch)
