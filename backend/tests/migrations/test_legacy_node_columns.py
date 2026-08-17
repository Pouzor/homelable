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
import shutil

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


async def test_upgrade_keeps_each_canvas_drawing_its_own_services(db_320):
    """3.3.3: order and visibility become the node's, and the upgrade freezes them.

    Two canvases drew the same host with different service lists, and a scan had
    already fingerprinted a third the user put on neither. All three converge on
    one inventory row — so each node must come out of the upgrade still drawing
    what it drew, with the scanner's guess hidden on both.
    """
    db_path, engine = db_320
    await _build_320(engine)
    ssh = '[{"port": 22, "protocol": "tcp", "service_name": "ssh"}]'
    both = '[{"port": 22, "protocol": "tcp", "service_name": "ssh"}, ' \
           '{"port": 443, "protocol": "tcp", "service_name": "https"}]'
    async with engine.begin() as conn:
        await conn.exec_driver_sql(f"UPDATE nodes SET services = '{ssh}' WHERE id = 'n1'")
        await conn.exec_driver_sql(f"UPDATE nodes SET services = '{both}' WHERE id = 'n2'")

    await database.init_db()

    from app.db.models import InventoryDevice, Node

    session_factory = database.async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        drawn = {}
        for node_id in ("n1", "n2"):
            node = await session.get(Node, node_id)
            device = await session.get(InventoryDevice, node.device_id)
            payload = inventory_sync.hydrated_node(node, device)
            drawn[node_id] = [s["service_name"] for s in payload["services"] if s.get("visible", True)]
            # Seeded, not left to "show the whole row".
            assert node.display_view is not None
        assert drawn == {"n1": ["ssh"], "n2": ["ssh", "https"]}

        # What a scan finds next lands on the row, and on no canvas.
        node = await session.get(Node, "n1")
        device = await session.get(InventoryDevice, node.device_id)
        device.services = [
            *device.services,
            {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"},
        ]
        await session.commit()
        payload = inventory_sync.hydrated_node(node, device)
        assert [(s["service_name"], s.get("visible", True)) for s in payload["services"]] == [
            ("ssh", True), ("Uptime Kuma", False),
        ]
    await engine.dispose()


async def _wind_back_to_3_3_2(engine, extra_service: dict) -> None:
    """A database that already took the 3.3.0 upgrade, leak included.

    Both nodes point at one row holding the union of what each drew plus what a
    scan found, and neither has a view — which is every 3.3.0-3.3.2 install.
    """
    from app.db.models import InventoryDevice, Node

    async with engine.begin() as conn:
        await conn.exec_driver_sql("UPDATE nodes SET display_view = NULL")
    session_factory = database.async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        node = await session.get(Node, "n1")
        one = await session.get(InventoryDevice, node.device_id)
        other = await session.get(InventoryDevice, (await session.get(Node, "n2")).device_id)
        for device in (one, other):
            device.services = [
                {"port": 22, "protocol": "tcp", "service_name": "ssh"},
                {"port": 443, "protocol": "tcp", "service_name": "https"},
                extra_service,
            ]
        await session.commit()


async def test_a_database_already_on_3_3_recovers_its_layout_from_the_backup(db_320):
    """The second upgrade path: 3.3.0-3.3.2, where the legacy columns are gone.

    3.3.0 unioned every canvas' services onto one row, so the row can no longer
    say who drew what — but the backup taken before that migration still can.
    Recovering from it is the difference between the user getting their canvases
    back and getting each canvas showing every other canvas' services.
    """
    _, engine = db_320
    await _build_320(engine)
    ssh = '[{"port": 22, "protocol": "tcp", "service_name": "ssh"}]'
    both = '[{"port": 22, "protocol": "tcp", "service_name": "ssh"}, ' \
           '{"port": 443, "protocol": "tcp", "service_name": "https"}]'
    async with engine.begin() as conn:
        await conn.exec_driver_sql(f"UPDATE nodes SET services = '{ssh}' WHERE id = 'n1'")
        await conn.exec_driver_sql(f"UPDATE nodes SET services = '{both}' WHERE id = 'n2'")

    await database.init_db()  # 3.2.0 -> 3.3.x, and the backup that predates it.
    kuma = {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"}
    await _wind_back_to_3_3_2(engine, kuma)

    await database.init_db()

    from app.db.models import InventoryDevice, Node

    session_factory = database.async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        drawn = {}
        for node_id in ("n1", "n2"):
            node = await session.get(Node, node_id)
            device = await session.get(InventoryDevice, node.device_id)
            payload = inventory_sync.hydrated_node(node, device)
            drawn[node_id] = [s["service_name"] for s in payload["services"] if s.get("visible", True)]
        assert drawn == {"n1": ["ssh"], "n2": ["ssh", "https"]}
    await engine.dispose()


async def test_a_property_added_while_on_3_3_survives_the_recovery(db_320):
    """The backup is 3.2.0-era and cannot know what the user added afterwards.

    On 3.3.0-3.3.2 the row was the only place to add a property, and every
    canvas drew it. Recovering the view strictly from the backup would hide it
    on all of them at once — the "my properties disappeared" half of #347. The
    scanner's service find is still held back: only properties are appended.
    """
    _, engine = db_320
    await _build_320(engine)
    rack = '[{"key": "Rack", "value": "A", "icon": null, "visible": true}]'
    ssh = '[{"port": 22, "protocol": "tcp", "service_name": "ssh"}]'
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            f"UPDATE nodes SET properties = '{rack}', services = '{ssh}' WHERE id = 'n1'"
        )

    await database.init_db()  # 3.2.0 -> 3.3.x, and the backup that predates it.
    kuma = {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"}
    await _wind_back_to_3_3_2(engine, kuma)

    from app.db.models import InventoryDevice, Node

    session_factory = database.async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        node = await session.get(Node, "n1")
        device = await session.get(InventoryDevice, node.device_id)
        # What the user re-added by hand while running 3.3.x.
        device.properties = [
            *device.properties,
            {"key": "Ports", "value": "8", "icon": None, "visible": True},
        ]
        await session.commit()

    await database.init_db()

    async with session_factory() as session:
        node = await session.get(Node, "n1")
        device = await session.get(InventoryDevice, node.device_id)
        payload = inventory_sync.hydrated_node(node, device)
        assert [(p["key"], p.get("visible", True)) for p in payload["properties"]] == [
            ("Rack", True), ("Ports", True),
        ]
        # And the scan's find is still off this canvas.
        assert [s["service_name"] for s in payload["services"] if s.get("visible", True)] == ["ssh"]
    await engine.dispose()


async def test_without_a_usable_backup_the_row_is_the_seed(db_320):
    """No backup to recover from: keep showing what the canvas shows today.

    Nothing is taken away — the user simply keeps the merged list they have been
    looking at since 3.3.0, and only what the row gains *after* this boot is
    held back.
    """
    db_path, engine = db_320
    await _build_320(engine)
    await database.init_db()
    kuma = {"port": 3001, "protocol": "tcp", "service_name": "Uptime Kuma"}
    await _wind_back_to_3_3_2(engine, kuma)
    for backup in db_path.parent.glob(f"{db_path.name}.back-*"):
        backup.unlink()

    await database.init_db()

    from app.db.models import InventoryDevice, Node

    session_factory = database.async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        node = await session.get(Node, "n1")
        device = await session.get(InventoryDevice, node.device_id)
        payload = inventory_sync.hydrated_node(node, device)
        assert [s["service_name"] for s in payload["services"]] == ["ssh", "https", "Uptime Kuma"]
        assert all(s.get("visible", True) for s in payload["services"])

        # From here on the node is pinned: the next scan's find is held back.
        device.services = [*device.services, {"port": 5001, "protocol": "tcp", "service_name": "Synology DSM HTTPS"}]
        await session.commit()
        payload = inventory_sync.hydrated_node(node, device)
        assert [s["service_name"] for s in payload["services"] if not s.get("visible", True)] == [
            "Synology DSM HTTPS"
        ]
    await engine.dispose()


async def test_the_newest_backup_that_still_has_the_columns_is_the_one_read(db_320):
    """A 3.3.2 install has several backups; only some can answer.

    `homelab.db.back-3.3.1` and `-3.3.2` were taken *after* the split and hold
    nothing per node; `-3.3.0` was taken before it. Reading the wrong one would
    either say nothing or resurrect a much older canvas.
    """
    db_path, engine = db_320
    await _build_320(engine)
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "UPDATE nodes SET services = "
            "'[{\"port\": 22, \"protocol\": \"tcp\", \"service_name\": \"ssh\"}]' WHERE id = 'n1'"
        )
    # Ancient: same shape, but a canvas the user has long since moved on from.
    old = db_path.parent / f"{db_path.name}.back-3.1.0"
    shutil.copy2(db_path, old)
    os.utime(old, (1, 1))
    async with engine.begin() as conn:
        await conn.exec_driver_sql(
            "UPDATE nodes SET services = "
            "'[{\"port\": 443, \"protocol\": \"tcp\", \"service_name\": \"https\"}]' WHERE id = 'n1'"
        )
    pre_split = db_path.parent / f"{db_path.name}.back-3.3.0"
    shutil.copy2(db_path, pre_split)

    await database.init_db()  # drops the columns, and backs up under this version
    # Post-split backups: newer, and unable to say who drew what.
    for name in ("back-3.3.1", "back-3.3.2"):
        shutil.copy2(db_path, db_path.parent / f"{db_path.name}.{name}")

    assert database._pre_split_backup() == pre_split
    assert database._views_from_backup()["n1"]["services"] == [
        {"port": 443, "protocol": "tcp", "service_name": "https"}
    ]
    await engine.dispose()
