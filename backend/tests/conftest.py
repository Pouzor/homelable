import os

# Must be set before any app import so pydantic-settings can resolve the required field.
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from httpx import ASGITransport, AsyncClient
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.database import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


@pytest.fixture(autouse=True, scope="session")
def test_credentials():
    """Configure test auth credentials directly on settings."""
    from app.core.config import settings
    settings.auth_username = "admin"
    settings.auth_password_hash = _pwd_ctx.hash("admin")


@pytest.fixture
async def db_session():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def client(db_session: AsyncSession):
    app.dependency_overrides[get_db] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers(client):
    """Returns a coroutine that logs in and returns auth headers."""
    async def _get():
        res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
        token = res.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    return _get
