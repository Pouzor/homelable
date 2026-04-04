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
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN waypoints JSON")
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
            await conn.exec_driver_sql(
                "CREATE TABLE node_status_logs ("
                "id TEXT PRIMARY KEY, "
                "node_id TEXT NOT NULL, "
                "status TEXT NOT NULL, "
                "response_time_ms INTEGER, "
                "checked_at DATETIME, "
                "FOREIGN KEY(node_id) REFERENCES nodes (id) ON DELETE CASCADE)"
            )
        with suppress(OperationalError):
            await conn.exec_driver_sql("CREATE INDEX ix_node_status_logs_node_id ON node_status_logs (node_id)")
        with suppress(OperationalError):
            await conn.exec_driver_sql("CREATE INDEX ix_node_status_logs_checked_at ON node_status_logs (checked_at)")
        # Migrate animated column from boolean (0/1) to string ('none'/'snake')
        with suppress(OperationalError):
            await conn.exec_driver_sql("UPDATE edges SET animated = 'snake' WHERE animated = '1' OR animated = 1")
        with suppress(OperationalError):
            sql = "UPDATE edges SET animated = 'none' WHERE animated = '0' OR animated = 0 OR animated IS NULL"
            await conn.exec_driver_sql(sql)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
