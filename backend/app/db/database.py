import json as _json
import logging
import shutil
import sqlite3
import uuid as _uuid_mod
from collections.abc import AsyncGenerator
from contextlib import closing, suppress
from pathlib import Path
from typing import Any

from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import APP_VERSION, settings

logger = logging.getLogger(__name__)


async def _try_migrate(conn: AsyncConnection, sql: str, *, label: str) -> None:
    """Run an idempotent migration statement, logging any error.

    Distinguishes 'already applied' errors (debug) from genuine failures
    (warning) so silent corruption is avoided. Used for new in-commit
    migrations; existing legacy ALTERs above remain wrapped in suppress.
    """
    try:
        await conn.exec_driver_sql(sql)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "duplicate column" in msg or "already exists" in msg:
            logger.debug("Migration %s skipped (already applied): %s", label, exc)
        else:
            logger.warning("Migration %s failed: %s", label, exc)

# Ensure the data directory exists before SQLite tries to open the file
Path(settings.sqlite_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.sqlite_path}",
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _backup_db() -> None:
    db_path = Path(settings.sqlite_path)
    if not db_path.exists():
        return
    backup_path = db_path.with_suffix(f".db.back-{APP_VERSION}")
    if backup_path.exists():
        return
    try:
        shutil.copy2(db_path, backup_path)
        logger.info("DB backup created: %s", backup_path.name)
    except OSError:
        logger.warning("Could not create DB backup at %s", backup_path)


# Tables renamed in 3.2.0. "Pending devices" was the scanner's word for a queue
# of finds awaiting approval; the same rows outlive approval, are edited by hand
# and are what a rack mounts, so the product calls them the Device Inventory.
# Only the names moved — every column, every row and every route is unchanged.
_RENAMED_TABLES: list[tuple[str, str]] = [
    ("pending_devices", "device_inventory"),
    ("pending_device_links", "device_inventory_links"),
]


async def _rename_legacy_tables(conn: AsyncConnection) -> None:
    """Rename the pre-3.2.0 inventory tables. Must run before `create_all`.

    Order matters: `create_all` would otherwise create an empty
    `device_inventory` beside the populated `pending_devices`, and every device
    the user ever scanned would look lost.

    Foreign keys are switched on for the rename so SQLite rewrites the
    ``REFERENCES pending_devices`` clause in `rack_devices` too; enforcement is
    off at runtime, so a missed rewrite costs nothing today, but it would leave
    the schema naming a table that no longer exists.
    """
    for old, new in _RENAMED_TABLES:
        rows = (
            await conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?)",
                (old, new),
            )
        ).fetchall()
        names = {r[0] for r in rows}
        if old not in names:
            continue  # Fresh install, or already migrated.
        if new in names:
            # A start that ran `create_all` before this migration existed left an
            # empty new table beside the populated old one, and the app read the
            # empty one. Clear it out of the way rather than stranding the data;
            # a new table with rows in it means the rename already happened and
            # something re-created the old one, which is not ours to resolve.
            count = (await conn.exec_driver_sql(f"SELECT COUNT(*) FROM {new}")).scalar()
            if count:
                logger.warning(
                    "Both %s and %s hold rows; leaving them alone. Merge them by hand.", old, new
                )
                continue
            logger.info("Dropping the empty %s left by an earlier start", new)
            await _try_migrate(conn, f"DROP TABLE {new}", label=f"{new}.drop_empty")
        logger.info("Migrating table %s -> %s", old, new)
        with suppress(OperationalError):
            await conn.exec_driver_sql("PRAGMA foreign_keys = ON")
        await _try_migrate(conn, f"ALTER TABLE {old} RENAME TO {new}", label=f"{new}.rename")
    # The index rides the rename under its old name; the model asks for the new
    # one, so drop the stale duplicate rather than carrying both.
    await _try_migrate(
        conn, "DROP INDEX IF EXISTS ix_pending_devices_ieee_address", label="device_inventory.index",
    )


async def init_db() -> None:
    _backup_db()
    async with engine.begin() as conn:
        await _rename_legacy_tables(conn)
        await conn.run_sync(Base.metadata.create_all)
        # Add columns introduced after initial schema (idempotent)
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN container_mode BOOLEAN NOT NULL DEFAULT 0")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN custom_colors JSON")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN custom_color TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN path_style TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN custom_icon TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN source_handle TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN target_handle TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN animated BOOLEAN NOT NULL DEFAULT 0")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN marker_start TEXT NOT NULL DEFAULT 'none'")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN marker_end TEXT NOT NULL DEFAULT 'none'")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN line_style TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN width_mult REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN cpu_count INTEGER")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN cpu_model TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN ram_gb REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN disk_gb REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN show_hardware BOOLEAN NOT NULL DEFAULT 0")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN show_port_numbers BOOLEAN NOT NULL DEFAULT 0")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN width REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN height REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN bottom_handles INTEGER NOT NULL DEFAULT 1")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN top_handles INTEGER NOT NULL DEFAULT 1")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN left_handles INTEGER NOT NULL DEFAULT 0")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN right_handles INTEGER NOT NULL DEFAULT 0")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE device_inventory ADD COLUMN discovery_source TEXT")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE device_inventory ADD COLUMN properties JSON")
        with suppress(OperationalError):
            await conn.exec_driver_sql("UPDATE device_inventory SET properties = '[]' WHERE properties IS NULL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE scan_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'ip'")
        # --- Zigbee schema migrations (logged variant per CLAUDE.md feedback) ---
        zigbee_migrations: list[tuple[str, str]] = [
            ("nodes.ieee_address", "ALTER TABLE nodes ADD COLUMN ieee_address TEXT"),
            (
                "nodes.ieee_address.index",
                "CREATE INDEX IF NOT EXISTS ix_nodes_ieee_address ON nodes(ieee_address)",
            ),
            ("device_inventory.ieee_address", "ALTER TABLE device_inventory ADD COLUMN ieee_address TEXT"),
            (
                "device_inventory.ieee_address.index",
                "CREATE INDEX IF NOT EXISTS ix_device_inventory_ieee_address "
                "ON device_inventory(ieee_address)",
            ),
            ("device_inventory.friendly_name", "ALTER TABLE device_inventory ADD COLUMN friendly_name TEXT"),
            ("device_inventory.device_subtype", "ALTER TABLE device_inventory ADD COLUMN device_subtype TEXT"),
            ("device_inventory.model", "ALTER TABLE device_inventory ADD COLUMN model TEXT"),
            ("device_inventory.vendor", "ALTER TABLE device_inventory ADD COLUMN vendor TEXT"),
            ("device_inventory.lqi", "ALTER TABLE device_inventory ADD COLUMN lqi INTEGER"),
        ]
        for label, sql in zigbee_migrations:
            await _try_migrate(conn, sql, label=label)
        # Drop NOT NULL on device_inventory.ip (Zigbee devices have no IP).
        # SQLite can't ALTER column nullability — rebuild the table if needed.
        try:
            info = await conn.exec_driver_sql("PRAGMA table_info(device_inventory)")
            cols = info.fetchall()
            ip_col = next((c for c in cols if c[1] == "ip"), None)
            # PRAGMA table_info row layout: (cid, name, type, notnull, dflt, pk)
            if ip_col and ip_col[3] == 1:
                logger.info("Migrating device_inventory: dropping NOT NULL on ip column")
                await conn.exec_driver_sql("PRAGMA foreign_keys = OFF")
                await conn.exec_driver_sql(
                    "CREATE TABLE device_inventory_new ("
                    "id VARCHAR PRIMARY KEY,"
                    "ip VARCHAR,"
                    "mac VARCHAR, hostname VARCHAR, os VARCHAR, services JSON,"
                    "suggested_type VARCHAR,"
                    "status VARCHAR,"
                    "discovery_source VARCHAR,"
                    "ieee_address VARCHAR,"
                    "friendly_name VARCHAR,"
                    "device_subtype VARCHAR,"
                    "model VARCHAR,"
                    "vendor VARCHAR,"
                    "lqi INTEGER,"
                    "properties JSON,"
                    "discovered_at DATETIME"
                    ")"
                )
                await conn.exec_driver_sql(
                    "INSERT INTO device_inventory_new "
                    "(id, ip, mac, hostname, os, services, suggested_type, status, "
                    "discovery_source, ieee_address, friendly_name, device_subtype, "
                    "model, vendor, lqi, discovered_at) "
                    "SELECT id, ip, mac, hostname, os, services, suggested_type, status, "
                    "discovery_source, ieee_address, friendly_name, device_subtype, "
                    "model, vendor, lqi, discovered_at FROM device_inventory"
                )
                await conn.exec_driver_sql("DROP TABLE device_inventory")
                await conn.exec_driver_sql(
                    "ALTER TABLE device_inventory_new RENAME TO device_inventory"
                )
                await conn.exec_driver_sql(
                    "CREATE INDEX IF NOT EXISTS ix_device_inventory_ieee_address "
                    "ON device_inventory(ieee_address)"
                )
                await conn.exec_driver_sql("PRAGMA foreign_keys = ON")
        except OperationalError as exc:
            logger.warning("device_inventory ip-nullable rebuild failed: %s", exc)
        # --- end Zigbee schema migrations -------------------------------------
        # --- Electrical designs schema migrations -----------------------------
        # Create designs table (idempotent)
        await _try_migrate(
            conn,
            "CREATE TABLE IF NOT EXISTS designs ("
            "id VARCHAR PRIMARY KEY,"
            "name VARCHAR NOT NULL,"
            "design_type VARCHAR NOT NULL DEFAULT 'network',"
            "created_at DATETIME,"
            "updated_at DATETIME"
            ")",
            label="designs.table",
        )
        # Add user-chosen icon to designs (idempotent), then backfill existing rows
        # so legacy designs keep a sensible icon based on their original type.
        await _try_migrate(
            conn, "ALTER TABLE designs ADD COLUMN icon VARCHAR", label="designs.icon",
        )
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE designs SET icon = 'zap' WHERE icon IS NULL AND design_type = 'electrical'"
            )
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE designs SET icon = 'dashboard' WHERE icon IS NULL"
            )
        # Seed default Network Topology design if designs table is empty
        _default_design_id = str(_uuid_mod.uuid4())
        row = await conn.exec_driver_sql("SELECT COUNT(*) FROM designs")
        count_row = row.fetchone()
        count = count_row[0] if count_row else 0
        if count == 0:
            await conn.exec_driver_sql(
                "INSERT INTO designs (id, name, design_type, icon, created_at, updated_at) "
                "VALUES (?, 'Network Topology', 'network', 'dashboard', datetime('now'), datetime('now'))",
                (_default_design_id,),
            )
        else:
            row2 = await conn.exec_driver_sql("SELECT id FROM designs WHERE design_type = 'network' LIMIT 1")
            default = row2.fetchone()
            _default_design_id = default[0] if default else _default_design_id

        # Add design_id to nodes
        await _try_migrate(
            conn, "ALTER TABLE nodes ADD COLUMN design_id VARCHAR REFERENCES designs(id)",
            label="nodes.design_id",
        )
        # Assign existing nodes to default design
        await conn.exec_driver_sql(
            "UPDATE nodes SET design_id = ? WHERE design_id IS NULL", (_default_design_id,),
        )

        # Add design_id to edges
        await _try_migrate(
            conn, "ALTER TABLE edges ADD COLUMN design_id VARCHAR REFERENCES designs(id)",
            label="edges.design_id",
        )
        # Assign existing edges to default design
        await conn.exec_driver_sql(
            "UPDATE edges SET design_id = ? WHERE design_id IS NULL", (_default_design_id,),
        )

        # Migrate canvas_state from id=1 to design_id PK (SQLite rebuild)
        try:
            info = await conn.exec_driver_sql("PRAGMA table_info(canvas_state)")
            cols = info.fetchall()
            has_design_id = any(c[1] == "design_id" for c in cols)
            if not has_design_id:
                logger.info("Migrating canvas_state: switching to design_id primary key")
                await conn.exec_driver_sql("PRAGMA foreign_keys = OFF")
                await conn.exec_driver_sql(
                    "CREATE TABLE canvas_state_new ("
                    "design_id VARCHAR PRIMARY KEY REFERENCES designs(id) ON DELETE CASCADE,"
                    "viewport JSON,"
                    "custom_style JSON,"
                    "saved_at DATETIME"
                    ")"
                )
                # Copy existing row(s), mapping id=1 to default design_id
                old_rows = await conn.exec_driver_sql("SELECT id, viewport, custom_style, saved_at FROM canvas_state")
                for old in old_rows.fetchall():
                    cs_id, viewport, custom_style, saved_at = old
                    target_design = _default_design_id
                    await conn.exec_driver_sql(
                        "INSERT INTO canvas_state_new (design_id, viewport, custom_style, saved_at) "
                        "VALUES (?, ?, ?, ?)",
                        (target_design, viewport, custom_style, saved_at),
                    )
                await conn.exec_driver_sql("DROP TABLE canvas_state")
                await conn.exec_driver_sql("ALTER TABLE canvas_state_new RENAME TO canvas_state")
                await conn.exec_driver_sql("PRAGMA foreign_keys = ON")
        except OperationalError as exc:
            logger.warning("canvas_state migration failed: %s", exc)
        # --- end Electrical designs schema migrations --------------------------

        # Rack cables gained editable annotations: a label the user can print on
        # the canvas, plus the same free-form property records nodes carry.
        rack_cable_migrations: list[tuple[str, str]] = [
            (
                "rack_cables.label_visible",
                "ALTER TABLE rack_cables ADD COLUMN label_visible BOOLEAN NOT NULL DEFAULT 0",
            ),
            ("rack_cables.properties", "ALTER TABLE rack_cables ADD COLUMN properties JSON"),
        ]
        for label, sql in rack_cable_migrations:
            await _try_migrate(conn, sql, label=label)
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE rack_cables SET properties = '[]' WHERE properties IS NULL"
            )

        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN waypoints JSON")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN properties JSON")
        # Migrate hardware columns → properties JSON (idempotent: only runs on nodes where properties IS NULL)
        with suppress(OperationalError):
            rows = await conn.exec_driver_sql(
                "SELECT id, cpu_model, cpu_count, ram_gb, disk_gb, show_hardware "
                "FROM nodes WHERE properties IS NULL"
            )
            for r in rows.fetchall():
                node_id, cpu_model, cpu_count, ram_gb, disk_gb, show_hardware = r
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
                    (_json.dumps(props), node_id),
                )
        # Inventory timestamp: last time a scan observed this node (idempotent)
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN last_scan DATETIME")
        # Migrate animated column from boolean (0/1) to string ('none'/'snake')
        with suppress(OperationalError):
            await conn.exec_driver_sql("UPDATE edges SET animated = 'snake' WHERE animated = '1' OR animated = 1")
        with suppress(OperationalError):
            sql = "UPDATE edges SET animated = 'none' WHERE animated = '0' OR animated = 0 OR animated IS NULL"
            await conn.exec_driver_sql(sql)
        # Multi-source discovery tags: a device found by both an IP scan and a
        # Proxmox import carries every source. Backfill from the legacy single
        # discovery_source so existing rows show under their filter.
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE device_inventory ADD COLUMN discovery_sources JSON")
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE device_inventory SET discovery_sources = json_array(discovery_source) "
                "WHERE discovery_sources IS NULL AND discovery_source IS NOT NULL"
            )
        # Legacy IP-scanned rows predating discovery_source have a NULL scalar
        # but a real IP — treat them as an ARP scan so they keep the IP tag.
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE device_inventory SET discovery_sources = json_array('arp') "
                "WHERE discovery_sources IS NULL AND discovery_source IS NULL AND ip IS NOT NULL"
            )
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE device_inventory SET discovery_sources = '[]' WHERE discovery_sources IS NULL"
            )
        # Canonicalize stored MACs (lowercase, ':' separators) so cross-source
        # dedup can match a Proxmox NIC MAC against an ARP-scanned one by equality.
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE device_inventory SET mac = lower(replace(mac, '-', ':')) WHERE mac IS NOT NULL"
            )
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE nodes SET mac = lower(replace(mac, '-', ':')) WHERE mac IS NOT NULL"
            )
        # 3.3.0 — the inventory row owns the device facts, the canvas node only
        # owns how it is drawn. These columns receive what used to live solely on
        # `nodes`. Additive here; `nodes` keeps its copies until the backfill has
        # run and been verified.
        inventory_device_migrations: list[tuple[str, str]] = [
            ("device_inventory.label", "ALTER TABLE device_inventory ADD COLUMN label TEXT"),
            ("device_inventory.type", "ALTER TABLE device_inventory ADD COLUMN type TEXT"),
            ("device_inventory.notes", "ALTER TABLE device_inventory ADD COLUMN notes TEXT"),
            ("device_inventory.cpu_count", "ALTER TABLE device_inventory ADD COLUMN cpu_count INTEGER"),
            ("device_inventory.cpu_model", "ALTER TABLE device_inventory ADD COLUMN cpu_model TEXT"),
            ("device_inventory.ram_gb", "ALTER TABLE device_inventory ADD COLUMN ram_gb FLOAT"),
            ("device_inventory.disk_gb", "ALTER TABLE device_inventory ADD COLUMN disk_gb FLOAT"),
            (
                "device_inventory.show_hardware",
                "ALTER TABLE device_inventory ADD COLUMN show_hardware BOOLEAN DEFAULT 0",
            ),
            ("device_inventory.check_method", "ALTER TABLE device_inventory ADD COLUMN check_method TEXT"),
            ("device_inventory.check_target", "ALTER TABLE device_inventory ADD COLUMN check_target TEXT"),
            (
                "device_inventory.status_live",
                "ALTER TABLE device_inventory ADD COLUMN status_live TEXT DEFAULT 'unknown'",
            ),
            ("device_inventory.last_seen", "ALTER TABLE device_inventory ADD COLUMN last_seen DATETIME"),
            ("device_inventory.last_scan", "ALTER TABLE device_inventory ADD COLUMN last_scan DATETIME"),
            (
                "device_inventory.response_time_ms",
                "ALTER TABLE device_inventory ADD COLUMN response_time_ms INTEGER",
            ),
            ("device_inventory.updated_at", "ALTER TABLE device_inventory ADD COLUMN updated_at DATETIME"),
        ]
        for label, sql in inventory_device_migrations:
            await _try_migrate(conn, sql, label=label)
        # Backfill the columns that carry a non-NULL default in the model, so a
        # legacy row round-trips through Pydantic without tripping the validators.
        # The link itself: a node points at the inventory row it draws.
        for label, sql in (
            ("nodes.device_id", "ALTER TABLE nodes ADD COLUMN device_id TEXT"),
            (
                "nodes.device_id.index",
                "CREATE INDEX IF NOT EXISTS ix_nodes_device_id ON nodes(device_id)",
            ),
            # Which of the row's services and properties this canvas shows, and
            # in what order. Seeded from the row further down, once the backfill
            # has had its say — see `_seed_node_views`.
            ("nodes.display_view", "ALTER TABLE nodes ADD COLUMN display_view JSON"),
        ):
            await _try_migrate(conn, sql, label=label)
        for label, sql in (
            (
                "device_inventory.status_live.backfill",
                "UPDATE device_inventory SET status_live = 'unknown' WHERE status_live IS NULL",
            ),
            (
                "device_inventory.show_hardware.backfill",
                "UPDATE device_inventory SET show_hardware = 0 WHERE show_hardware IS NULL",
            ),
            (
                "device_inventory.updated_at.backfill",
                "UPDATE device_inventory SET updated_at = discovered_at WHERE updated_at IS NULL",
            ),
        ):
            await _try_migrate(conn, sql, label=label)

    await _backfill_node_devices()
    await _drop_legacy_node_columns()
    await _seed_node_views()
    await _backfill_zone_size()



# Columns `nodes` carried before 3.3.0, when a node owned the device facts. They
# belong to `device_inventory` now; the backfill above copies them across, and
# this rebuild removes them.
_LEGACY_NODE_COLUMNS = (
    "hostname", "ip", "mac", "os", "status", "check_method", "check_target",
    "services", "notes", "cpu_count", "cpu_model", "ram_gb", "disk_gb",
    "show_hardware", "properties", "ieee_address", "last_seen", "last_scan",
    "response_time_ms",
)

# What a node keeps: how the device is drawn on one canvas.
_NODE_COLUMNS_SQL = (
    "id VARCHAR PRIMARY KEY,"
    "type VARCHAR NOT NULL,"
    "label VARCHAR NOT NULL,"
    "design_id VARCHAR REFERENCES designs(id) ON DELETE SET NULL,"
    "device_id VARCHAR REFERENCES device_inventory(id) ON DELETE SET NULL,"
    "display_view JSON,"
    "pos_x FLOAT,"
    "pos_y FLOAT,"
    "parent_id VARCHAR REFERENCES nodes(id) ON DELETE CASCADE,"
    "container_mode BOOLEAN,"
    "custom_colors JSON,"
    "custom_icon VARCHAR,"
    "show_port_numbers BOOLEAN,"
    "width FLOAT,"
    "height FLOAT,"
    "bottom_handles INTEGER,"
    "top_handles INTEGER,"
    "left_handles INTEGER,"
    "right_handles INTEGER,"
    "created_at DATETIME,"
    "updated_at DATETIME"
)

_NODE_KEPT = (
    "id, type, label, design_id, device_id, display_view, pos_x, pos_y, parent_id, container_mode, "
    "custom_colors, custom_icon, show_port_numbers, width, height, bottom_handles, "
    "top_handles, left_handles, right_handles, created_at, updated_at"
)


async def _relax_legacy_node_columns(conn: AsyncConnection, info: list[Any]) -> None:
    """Make the retained legacy `nodes` columns nullable — SQLite table rebuild.

    The 3.2.0 schema declares `status`, `services`, `properties` and
    `show_hardware` NOT NULL with no server-side default. The 3.3.0 model no
    longer maps them, so every INSERT omits them and SQLite rejects the row —
    approving a device, creating a node, importing a canvas all fail with
    ``NOT NULL constraint failed: nodes.status``. Dropping the columns is the
    real fix, but it waits on a complete backfill; until then they have to stop
    blocking writes. Values are preserved: only the constraint goes.
    """
    kept = [row for row in info if row[1] in _LEGACY_NODE_COLUMNS]
    if not any(row[3] for row in kept):  # PRAGMA `notnull`
        return  # Already relaxed, or never constrained.

    logger.info("Relaxing NOT NULL on the retained legacy node columns")
    legacy_defs = ",".join(f"{row[1]} {row[2] or 'VARCHAR'}" for row in kept)
    legacy_names = ", ".join(row[1] for row in kept)
    await _rebuild_nodes(
        conn,
        columns_sql=f"{_NODE_COLUMNS_SQL},{legacy_defs}",
        copied=f"{_NODE_KEPT}, {legacy_names}",
        what="nodes legacy-column relax",
    )


async def _rebuild_nodes(conn: AsyncConnection, *, columns_sql: str, copied: str, what: str) -> None:
    """Recreate `nodes` with a new column list — SQLite cannot alter constraints.

    Never fatal: a rebuild that fails leaves the table it could not replace, and
    the boot carries on. Foreign keys go off for the swap, because `edges` and
    `rack_devices` point at `nodes`, and back on in every case — the pragma is
    per connection and this one returns to the pool.
    """
    try:
        await conn.exec_driver_sql("PRAGMA foreign_keys = OFF")
        # A previous attempt that failed after the create would block this one.
        await conn.exec_driver_sql("DROP TABLE IF EXISTS nodes_new")
        await conn.exec_driver_sql(f"CREATE TABLE nodes_new ({columns_sql})")
        await conn.exec_driver_sql(f"INSERT INTO nodes_new ({copied}) SELECT {copied} FROM nodes")
        await conn.exec_driver_sql("DROP TABLE nodes")
        await conn.exec_driver_sql("ALTER TABLE nodes_new RENAME TO nodes")
        await conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_nodes_device_id ON nodes(device_id)")
    except (OperationalError, IntegrityError) as exc:
        logger.warning("%s failed: %s", what, exc)
    finally:
        await conn.exec_driver_sql("PRAGMA foreign_keys = ON")


async def _drop_legacy_node_columns() -> None:
    """Remove the device columns from `nodes` (3.3.0) — SQLite table rebuild.

    Runs only after the backfill has linked every device node to its inventory
    row. If any non-furniture node is still unlinked the drop is skipped and
    logged: the columns are the only remaining copy of that node's facts, and
    losing them is not recoverable. The skip then relaxes their NOT NULL instead,
    because the 3.3.0 model no longer writes them and the database must stay
    insertable while the backfill is retried on later boots.
    """
    async with engine.begin() as conn:
        info = (await conn.exec_driver_sql("PRAGMA table_info(nodes)")).fetchall()
        present = {row[1] for row in info}
        if not (present & set(_LEGACY_NODE_COLUMNS)):
            return  # Already migrated.

        unlinked = (
            await conn.exec_driver_sql(
                "SELECT COUNT(*) FROM nodes WHERE device_id IS NULL "
                "AND type NOT IN ('group', 'groupRect', 'text')"
            )
        ).scalar()
        if unlinked:
            logger.warning(
                "Keeping the legacy node columns: %d node(s) have no inventory row. "
                "The backfill must link every device node before they can be dropped.",
                unlinked,
            )
            await _relax_legacy_node_columns(conn, list(info))
            return

        logger.info("Migrating nodes: the device columns move to device_inventory")
        await _rebuild_nodes(
            conn,
            columns_sql=_NODE_COLUMNS_SQL,
            copied=_NODE_KEPT,
            what="nodes device-column drop",
        )


async def _backfill_node_devices() -> None:
    """Link existing canvas nodes to their Device Inventory rows (3.3.0).

    Runs outside the DDL connection because the merge is Python-side, not SQL.
    Self-limiting: it only looks at nodes with no ``device_id``, so a second boot
    finds nothing to do. Never fatal — a failure here leaves the canvas working
    off its own columns, which still carry the data at this point.
    """
    # Imported here: app.services imports app.db.models, which imports this module.
    from app.services.inventory_sync import backfill_node_devices

    try:
        async with AsyncSessionLocal() as session:
            stats = await backfill_node_devices(session)
            if stats["linked"]:
                await session.commit()
                logger.info(
                    "Inventory backfill: linked %d node(s) — %d device(s) created, %d merged",
                    stats["linked"], stats["created"], stats["merged"],
                )
            if stats.get("skipped"):
                logger.warning(
                    "Inventory backfill: %d node(s) could not be linked; they keep their "
                    "legacy columns and are retried on the next start.",
                    stats["skipped"],
                )
    except Exception as exc:  # pragma: no cover - defensive, boot must not die
        logger.warning("Inventory backfill failed: %s", exc)


def _pre_split_backup() -> Path | None:
    """The newest backup still holding the per-node device columns, if any.

    `_backup_db` copies the database *before* the migrations of each new
    version, so a user who upgraded to 3.3.0 has a `homelab.db.back-3.3.0`
    carrying the last state in which `nodes` still owned its own services and
    properties. That copy is the only record of which canvas showed what, since
    3.3.0's backfill unioned them all onto one inventory row. Newest first: it is
    the state closest to the upgrade, so it is what the user last saw.
    """
    db_path = Path(settings.sqlite_path)
    candidates = sorted(
        db_path.parent.glob(f"{db_path.name}.back-*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for path in candidates:
        try:
            with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as conn:
                cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)")}
        except sqlite3.Error:
            continue
        if {"services", "properties"} <= cols:
            return path
    return None


def _views_from_backup() -> dict[str, dict[str, Any]]:
    """What each node drew, read out of the pre-3.3.0 backup. Empty when there is none.

    Keyed by node id, which is a uuid and stable across every version. A backup
    that cannot be opened, or holds nodes this database no longer has, simply
    contributes nothing — the caller falls back to the inventory row.
    """
    path = _pre_split_backup()
    if path is None:
        return {}
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as conn:
            rows = conn.execute("SELECT id, services, properties FROM nodes").fetchall()
    except sqlite3.Error as exc:
        logger.warning("Could not read the pre-3.3.0 node lists from %s: %s", path.name, exc)
        return {}

    out: dict[str, dict[str, Any]] = {}
    for node_id, services, properties in rows:
        drawn: dict[str, Any] = {}
        for kind, raw in (("services", services), ("properties", properties)):
            if isinstance(raw, str | bytes):
                with suppress(ValueError):
                    decoded = _json.loads(raw)
                    if isinstance(decoded, list):
                        drawn[kind] = decoded
        if drawn:
            out[node_id] = drawn
    if out:
        logger.info("Recovering the per-canvas service/property layout from %s", path.name)
    return out


async def _seed_node_views() -> None:
    """Give pre-existing nodes an explicit view of their inventory row (3.3.3).

    Order and visibility for services and properties moved to the node, so one
    device drawn on two canvases can be rendered two ways. A node from before
    that has no view, and where it comes from decides whether the user gets
    their arrangement back:

    * upgrading from 3.2.0, the backfill has already seeded it from the node's
      own columns — nothing here to do;
    * upgrading from 3.3.0-3.3.2, those columns are gone and the row holds the
      union of every canvas, so the view is recovered from the backup taken
      before the 3.3.0 migration. That is the difference between a canvas coming
      back as the user left it and coming back showing every other canvas'
      properties;
    * with no usable backup, the row itself is the seed: what shows today keeps
      showing, and only what the row gains *later* is held back.

    Never fatal: without a view the node simply shows the whole row, which is
    the behaviour it has now.
    """
    # Imported here: app.services imports app.db.models, which imports this module.
    from app.services.inventory_sync import seed_node_views

    try:
        async with AsyncSessionLocal() as session:
            seeded = await seed_node_views(session, drawn=_views_from_backup)
            if seeded:
                await session.commit()
                logger.info("Seeded the service/property view of %d node(s)", seeded)
    except Exception as exc:  # pragma: no cover - defensive, boot must not die
        logger.warning("Seeding the node service/property views failed: %s", exc)


async def _backfill_zone_size() -> None:
    """Move a zone's size out of the custom_colors blob into the real columns.

    Every node type stored its size in `nodes.width` / `nodes.height` except
    `groupRect`, which stashed it inside the `custom_colors` JSON alongside its
    colours. The serializer writes the columns for zones too now, so a canvas
    saved before this upgrade would come back at the default 360x240 without
    this backfill.

    Only fills a column that is still NULL, so it cannot overwrite a size the
    user has set since, and re-running it is a no-op. Parsed in Python rather
    than with `json_extract`, so it does not depend on the SQLite build being
    compiled with JSON1.

    Never fatal: the reader falls back to the blob, so the worst case of a
    failure here is that the geometry keeps coming from where it always did.
    """
    try:
        async with engine.begin() as conn:
            rows = (
                await conn.exec_driver_sql(
                    "SELECT id, custom_colors FROM nodes "
                    "WHERE type = 'groupRect' AND custom_colors IS NOT NULL "
                    "AND (width IS NULL OR height IS NULL)"
                )
            ).fetchall()

            moved = 0
            for node_id, blob in rows:
                if isinstance(blob, str):
                    try:
                        blob = _json.loads(blob)
                    except ValueError:
                        continue
                if not isinstance(blob, dict):
                    continue

                width, height = blob.get("width"), blob.get("height")
                # A bool is an int in Python; a size that is not a real number
                # is left alone rather than written as garbage.
                if not isinstance(width, int | float) or isinstance(width, bool):
                    width = None
                if not isinstance(height, int | float) or isinstance(height, bool):
                    height = None
                if width is None and height is None:
                    continue

                await conn.exec_driver_sql(
                    "UPDATE nodes SET width = COALESCE(width, ?), height = COALESCE(height, ?) "
                    "WHERE id = ?",
                    (width, height, node_id),
                )
                moved += 1

            if moved:
                logger.info("Moved the size of %d zone(s) to the width/height columns", moved)
    except Exception as exc:  # pragma: no cover - defensive, boot must not die
        logger.warning("Backfilling zone width/height failed: %s", exc)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
