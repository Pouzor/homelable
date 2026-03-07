from contextlib import suppress

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

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
        # Add container_mode column if not present (existing databases)
        with suppress(Exception):
            await conn.exec_driver_sql("ALTER TABLE nodes ADD COLUMN container_mode BOOLEAN NOT NULL DEFAULT 0")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
