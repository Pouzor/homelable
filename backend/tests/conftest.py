import os

# Must be set before any app import so pydantic-settings can resolve the required field.
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
import yaml
from httpx import ASGITransport, AsyncClient
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.database import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


@pytest.fixture(autouse=True, scope="session")
def test_config_file(tmp_path_factory):
    """Write a minimal config.yml for the test session and point settings at it."""
    cfg = {
        "auth": {
            "username": "admin",
            "password_hash": _pwd_ctx.hash("admin"),
        },
        "scanner": {"ranges": []},
        "status_checker": {"interval_seconds": 3600},
    }
    cfg_path = tmp_path_factory.mktemp("cfg") / "config.yml"
    cfg_path.write_text(yaml.dump(cfg))
    from app.core.config import settings
    settings.config_path = str(cfg_path)


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
