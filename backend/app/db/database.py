from collections.abc import AsyncGenerator
from contextlib import suppress
from pathlib import Path

from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

# Ensure the data directory exists before SQLite tries to open the file
Path(settings.sqlite_path).parent.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(
    f"sqlite+aiosqlite:///{settings.sqlite_path}",
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    async with engine.begin() as conn:
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
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN width REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN height REAL")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN bottom_handles INTEGER NOT NULL DEFAULT 1")
        with suppress(OperationalError):
            await conn.exec_driver_sql("ALTER TABLE pending_devices ADD COLUMN discovery_source TEXT")
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
                import json as _json
                await conn.exec_driver_sql(
                    "UPDATE nodes SET properties = ? WHERE id = ?",
                    (_json.dumps(props), node_id),
                )
        # Migrate animated column from boolean (0/1) to string ('none'/'snake')
        with suppress(OperationalError):
            await conn.exec_driver_sql("UPDATE edges SET animated = 'snake' WHERE animated = '1' OR animated = 1")
        with suppress(OperationalError):
            sql = "UPDATE edges SET animated = 'none' WHERE animated = '0' OR animated = 0 OR animated IS NULL"
            await conn.exec_driver_sql(sql)
        # Ensure proxmox nodes that have children get container_mode=1 (safe: only nodes already used as containers)
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE nodes SET container_mode = 1 WHERE type = 'proxmox' AND container_mode = 0"
                " AND id IN (SELECT DISTINCT parent_id FROM nodes WHERE parent_id IS NOT NULL)"
            )
        # Rename legacy 'docker' type → 'docker_container'
        with suppress(OperationalError):
            await conn.exec_driver_sql(
                "UPDATE nodes SET type = 'docker_container' WHERE type = 'docker'"
            )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
