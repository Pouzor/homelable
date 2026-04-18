"""
Tests for docker type rename and proxmox container_mode migrations.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


async def _setup_table(conn):
    await conn.exec_driver_sql("""
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'generic',
            label TEXT NOT NULL DEFAULT '',
            container_mode BOOLEAN NOT NULL DEFAULT 0
        )
    """)


async def _run_migrations(conn):
    await conn.exec_driver_sql(
        "UPDATE nodes SET container_mode = 1 WHERE type = 'proxmox' AND container_mode = 0"
    )
    await conn.exec_driver_sql(
        "UPDATE nodes SET type = 'docker_container' WHERE type = 'docker'"
    )


@pytest.mark.asyncio
async def test_proxmox_container_mode_set_to_true():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, container_mode) VALUES ('p1', 'proxmox', 'PVE', 0)"
        )
        await _run_migrations(conn)
        row = (await conn.exec_driver_sql("SELECT container_mode FROM nodes WHERE id = 'p1'")).fetchone()
        assert row[0] == 1


@pytest.mark.asyncio
async def test_proxmox_already_true_unchanged():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, container_mode) VALUES ('p2', 'proxmox', 'PVE', 1)"
        )
        await _run_migrations(conn)
        row = (await conn.exec_driver_sql("SELECT container_mode FROM nodes WHERE id = 'p2'")).fetchone()
        assert row[0] == 1


@pytest.mark.asyncio
async def test_non_proxmox_container_mode_untouched():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label, container_mode) VALUES ('s1', 'server', 'Srv', 0)"
        )
        await _run_migrations(conn)
        row = (await conn.exec_driver_sql("SELECT container_mode FROM nodes WHERE id = 's1'")).fetchone()
        assert row[0] == 0


@pytest.mark.asyncio
async def test_docker_type_renamed_to_docker_container():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label) VALUES ('d1', 'docker', 'My Docker')"
        )
        await _run_migrations(conn)
        row = (await conn.exec_driver_sql("SELECT type FROM nodes WHERE id = 'd1'")).fetchone()
        assert row[0] == 'docker_container'


@pytest.mark.asyncio
async def test_docker_host_type_untouched():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await _setup_table(conn)
        await conn.exec_driver_sql(
            "INSERT INTO nodes (id, type, label) VALUES ('d2', 'docker_host', 'Docker Host')"
        )
        await _run_migrations(conn)
        row = (await conn.exec_driver_sql("SELECT type FROM nodes WHERE id = 'd2'")).fetchone()
        assert row[0] == 'docker_host'
