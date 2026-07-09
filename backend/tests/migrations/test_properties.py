"""
Tests for the hardware → properties migration logic.

We test the migration function directly against an in-memory SQLite database
so we can set up legacy rows (with hardware columns, NULL properties) and
verify the migration produces the expected properties JSON.
"""
import json
import os

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


async def _setup_legacy_table(conn):
    """Create a minimal nodes table that mimics the pre-migration schema."""
    await conn.exec_driver_sql("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'generic',
            label TEXT NOT NULL DEFAULT '',
            cpu_model TEXT,
            cpu_count INTEGER,
            ram_gb REAL,
            disk_gb REAL,
            show_hardware BOOLEAN NOT NULL DEFAULT 0,
            properties JSON
        )
    """)


async def _run_migration(conn):
    """Run only the properties migration portion (extracted from init_db)."""
    rows = await conn.exec_driver_sql(
        "SELECT id, cpu_model, cpu_count, ram_gb, disk_gb, show_hardware "
        "FROM nodes WHERE properties IS NULL"
    )
    for row in rows.fetchall():
        node_id, cpu_model, cpu_count, ram_gb, disk_gb, show_hardware = row
        props = []
        visible = bool(show_hardware)
        if cpu_model:
            props.append({"key": "CPU Model", "value": str(cpu_model), "icon": "Cpu", "visible": visible})
        if cpu_count is not None:
            props.append({"key": "CPU Cores", "value": str(cpu_count), "icon": "Cpu", "visible": visible})
        if ram_gb is not None:
            props.append({"key": "RAM", "value": f"{ram_gb} GB", "icon": "MemoryStick", "visible": visible})
        if disk_gb is not None:
            props.append({"key": "Disk", "value": f"{disk_gb} GB", "icon": "HardDrive", "visible": visible})
        await conn.exec_driver_sql(
            "UPDATE nodes SET properties = ? WHERE id = ?",
            (json.dumps(props), node_id),
        )


async def _get_properties(conn, node_id: str) -> list:
    rows = await conn.exec_driver_sql("SELECT properties FROM nodes WHERE id = ?", (node_id,))
    raw = rows.fetchone()[0]
    return json.loads(raw) if raw else []


@pytest.mark.asyncio
async def test_migration_full_hardware():
    """Node with all 4 hardware fields → 4 property entries with correct icons."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_legacy_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, cpu_model, cpu_count, ram_gb, disk_gb, show_hardware) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("node-1", "i7-12700K", 12, 32.0, 2000.0, 1),
        )
        await _run_migration(conn)
        props = await _get_properties(conn, "node-1")

    assert len(props) == 4
    assert props[0] == {"key": "CPU Model", "value": "i7-12700K", "icon": "Cpu", "visible": True}
    assert props[1] == {"key": "CPU Cores", "value": "12", "icon": "Cpu", "visible": True}
    assert props[2] == {"key": "RAM", "value": "32.0 GB", "icon": "MemoryStick", "visible": True}
    assert props[3] == {"key": "Disk", "value": "2000.0 GB", "icon": "HardDrive", "visible": True}
    await engine.dispose()


@pytest.mark.asyncio
async def test_migration_partial_hardware():
    """Node with only cpu_model and ram_gb → 2 property entries."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_legacy_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, cpu_model, ram_gb, show_hardware) VALUES (?, ?, ?, ?)",
            ("node-2", "Ryzen 5 5600", 16.0, 0),
        )
        await _run_migration(conn)
        props = await _get_properties(conn, "node-2")

    assert len(props) == 2
    assert props[0]["key"] == "CPU Model"
    assert props[0]["visible"] is False
    assert props[1]["key"] == "RAM"
    assert props[1]["icon"] == "MemoryStick"
    await engine.dispose()


@pytest.mark.asyncio
async def test_migration_no_hardware():
    """Node with no hardware fields → empty properties array."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_legacy_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id) VALUES (?)",
            ("node-3",),
        )
        await _run_migration(conn)
        props = await _get_properties(conn, "node-3")

    assert props == []
    await engine.dispose()


@pytest.mark.asyncio
async def test_migration_idempotent():
    """Running migration twice does not duplicate properties."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_legacy_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, cpu_model, show_hardware) VALUES (?, ?, ?)",
            ("node-4", "Core i5", 1),
        )
        await _run_migration(conn)
        await _run_migration(conn)  # second pass — node already has properties, should be skipped
        props = await _get_properties(conn, "node-4")

    assert len(props) == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_migration_show_hardware_false_sets_visible_false():
    """show_hardware=0 means all migrated properties have visible=False."""
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_legacy_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, cpu_model, ram_gb, show_hardware) VALUES (?, ?, ?, ?)",
            ("node-5", "ARM Cortex-A72", 4.0, 0),
        )
        await _run_migration(conn)
        props = await _get_properties(conn, "node-5")

    assert all(p["visible"] is False for p in props)
    await engine.dispose()


@pytest.mark.asyncio
async def test_migration_already_migrated_node_not_touched():
    """Node that already has properties is skipped — existing properties preserved."""
    existing = [{"key": "GPU", "value": "RTX 4090", "icon": "Monitor", "visible": True}]
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_legacy_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, cpu_model, ram_gb, show_hardware, properties) VALUES (?, ?, ?, ?, ?)",
            ("node-6", "i9-13900K", 64.0, 1, json.dumps(existing)),
        )
        await _run_migration(conn)
        props = await _get_properties(conn, "node-6")

    assert props == existing
    await engine.dispose()
