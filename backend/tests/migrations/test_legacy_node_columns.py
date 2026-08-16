"""The 3.2.0 → 3.3.0 upgrade of the `nodes` table.

3.3.0 moved the device facts off `nodes` onto `device_inventory` and dropped the
columns. A real 3.2.0 database declares several of them NOT NULL with no
server-side default (`status`, `services`, `properties`, `show_hardware`) — the
schema here is `create_all`'s output at tag v3.2.0, not a hand-simplified copy,
because that constraint is exactly what breaks: the 3.3.0 model no longer writes
those columns, so if they survive the upgrade every INSERT fails with
``NOT NULL constraint failed: nodes.status`` and approving a device is dead.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

import app.db.database as database
import app.services.inventory_sync as inventory_sync

# `create_all` under v3.2.0. NOT NULL is reproduced exactly where it was.
_NODES_320 = (
    "CREATE TABLE nodes ("
    "id VARCHAR NOT NULL PRIMARY KEY, type VARCHAR NOT NULL, label VARCHAR NOT NULL, "
    "design_id VARCHAR, hostname VARCHAR, ip VARCHAR, mac VARCHAR, os VARCHAR, "
    "status VARCHAR NOT NULL, check_method VARCHAR, check_target VARCHAR, "
    "services JSON NOT NULL, notes TEXT, pos_x FLOAT NOT NULL, pos_y FLOAT NOT NULL, "
    "parent_id VARCHAR, container_mode BOOLEAN NOT NULL, custom_colors JSON, "
    "custom_icon VARCHAR, cpu_count INTEGER, cpu_model VARCHAR, ram_gb FLOAT, "
    "disk_gb FLOAT, show_hardware BOOLEAN NOT NULL, show_port_numbers BOOLEAN NOT NULL, "
    "properties JSON NOT NULL, width FLOAT, height FLOAT, "
    "bottom_handles INTEGER NOT NULL, top_handles INTEGER NOT NULL, "
    "left_handles INTEGER NOT NULL, right_handles INTEGER NOT NULL, "
    "ieee_address VARCHAR, last_seen DATETIME, last_scan DATETIME, "
    "response_time_ms INTEGER, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"
)

_DESIGNS_320 = (
    "CREATE TABLE designs (id VARCHAR NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, "
    "design_type VARCHAR NOT NULL, icon VARCHAR, created_at DATETIME NOT NULL, "
    "updated_at DATETIME NOT NULL)"
)


def _node_sql(node_id: str, label: str, node_type: str, ip: str | None) -> str:
    ip_sql = f"'{ip}'" if ip else "NULL"
    return (
        "INSERT INTO nodes (id, type, label, design_id, ip, status, services, pos_x, pos_y, "
        "container_mode, show_hardware, show_port_numbers, properties, bottom_handles, "
        "top_handles, left_handles, right_handles, created_at, updated_at) VALUES "
        f"('{node_id}', '{node_type}', '{label}', 'd1', {ip_sql}, 'online', '[]', 0, 0, "
        "0, 0, 0, '[]', 1, 1, 0, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
    )


@pytest.fixture
def db_320(tmp_path, monkeypatch):
    """A v3.2.0 database, with the module-global engine pointed at it."""
    db_path = tmp_path / "v320.db"
    monkeypatch.setattr(database.settings, "sqlite_path", str(db_path))
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(
        database, "AsyncSessionLocal", database.async_sessionmaker(engine, expire_on_commit=False)
    )
    return db_path, engine


async def _build_320(engine) -> None:
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_DESIGNS_320)
        await conn.exec_driver_sql(_NODES_320)
        await conn.exec_driver_sql(
            "INSERT INTO designs (id, name, design_type, icon, created_at, updated_at) "
            "VALUES ('d1', 'Network Topology', 'network', 'dashboard', "
            "'2026-01-01 00:00:00', '2026-01-01 00:00:00')"
        )
        await conn.exec_driver_sql(_node_sql("n1", "OpnSense", "firewall", "192.168.1.1"))
        await conn.exec_driver_sql(_node_sql("n2", "NAS", "nas", "192.168.1.2"))
        await conn.exec_driver_sql(_node_sql("n3", "a note", "text", None))


async def _insert_node(engine) -> None:
    """What approve does: insert a node the way the 3.3.0 model writes one."""
    from app.db.models import Node

    session_factory = database.async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        session.add(Node(id="new", type="firewall", label="Approved", design_id="d1"))
        await session.commit()


async def test_upgrade_drops_the_device_columns_and_leaves_nodes_insertable(db_320):
    db_path, engine = db_320
    await _build_320(engine)

    await database.init_db()

    check = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    try:
        async with check.begin() as conn:
            cols = {c[1] for c in (await conn.exec_driver_sql("PRAGMA table_info(nodes)")).fetchall()}
            assert "status" not in cols
            assert "ip" not in cols
            assert "device_id" in cols
            # Every device node linked; the facts moved to the inventory row.
            linked = (await conn.exec_driver_sql(
                "SELECT label, device_id FROM nodes ORDER BY id"
            )).fetchall()
            assert [row[0] for row in linked] == ["OpnSense", "NAS", "a note"]
            assert linked[0][1] and linked[1][1]
            assert linked[2][1] is None  # canvas furniture keeps no row
            ips = (await conn.exec_driver_sql(
                "SELECT ip FROM device_inventory ORDER BY ip"
            )).fetchall()
            assert [row[0] for row in ips] == ["192.168.1.1", "192.168.1.2"]

        await _insert_node(engine)
    finally:
        await check.dispose()
        await engine.dispose()


async def test_a_node_the_backfill_cannot_link_still_leaves_nodes_insertable(db_320, monkeypatch):
    """The regression: a failed backfill must not brick every later INSERT.

    Before the fix, one unlinkable node kept `nodes.status` NOT NULL while the
    3.3.0 model stopped writing it, so approving *any* device raised
    ``NOT NULL constraint failed: nodes.status`` (issue #351).
    """
    db_path, engine = db_320
    await _build_320(engine)

    real_link_facts = inventory_sync.link_facts

    async def link_facts(db, node, facts, **kwargs):
        if node.id == "n2":
            raise IntegrityError("boom", None, Exception("UNIQUE constraint failed"))
        return await real_link_facts(db, node, facts, **kwargs)

    monkeypatch.setattr(inventory_sync, "link_facts", link_facts)

    await database.init_db()

    check = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    try:
        async with check.begin() as conn:
            info = (await conn.exec_driver_sql("PRAGMA table_info(nodes)")).fetchall()
            cols = {c[1]: c for c in info}
            # The columns stay — they are the only remaining copy of n2's facts.
            assert "status" in cols
            # But nothing is NOT NULL any more, so the model can insert again.
            assert not any(c[3] for name, c in cols.items() if name in database._LEGACY_NODE_COLUMNS)
            # Values preserved by the rebuild.
            kept = (await conn.exec_driver_sql(
                "SELECT status, ip FROM nodes WHERE id='n2'"
            )).fetchone()
            assert kept == ("online", "192.168.1.2")
            # The node that did link is linked; the failed one is not.
            linked = dict((await conn.exec_driver_sql(
                "SELECT id, device_id FROM nodes"
            )).fetchall())
            assert linked["n1"] is not None
            assert linked["n2"] is None

        await _insert_node(engine)

        # A boot where the failure persists changes nothing further: the relax is
        # a one-off, not a rebuild on every start.
        await database.init_db()
        async with check.begin() as conn:
            kept = (await conn.exec_driver_sql(
                "SELECT status, ip FROM nodes WHERE id='n2'"
            )).fetchone()
            assert kept == ("online", "192.168.1.2")
            assert (await conn.exec_driver_sql(
                "SELECT COUNT(*) FROM nodes"
            )).scalar() == 4  # the three seeded, plus the one just approved

        # A later boot retries the backfill: with the failure gone, n2 links and
        # the columns finally drop.
        monkeypatch.setattr(inventory_sync, "link_facts", real_link_facts)
        await database.init_db()
        async with check.begin() as conn:
            cols = {c[1] for c in (await conn.exec_driver_sql("PRAGMA table_info(nodes)")).fetchall()}
            assert "status" not in cols
    finally:
        await check.dispose()
        await engine.dispose()
