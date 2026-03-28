from collections.abc import AsyncGenerator
from contextlib import suppress
from pathlib import Path

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
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN container_mode BOOLEAN NOT NULL DEFAULT 0")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN custom_colors JSON")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN custom_color TEXT")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN path_style TEXT")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN custom_icon TEXT")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN source_handle TEXT")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN target_handle TEXT")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE edges ADD COLUMN animated BOOLEAN NOT NULL DEFAULT 0")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN cpu_count INTEGER")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN cpu_model TEXT")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN ram_gb REAL")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN disk_gb REAL")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN show_hardware BOOLEAN NOT NULL DEFAULT 0")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN width REAL")
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN height REAL")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
