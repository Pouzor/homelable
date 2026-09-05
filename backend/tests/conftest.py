import importlib
import os

# Must be set before any app import so pydantic-settings can resolve the required field.
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.db.database import DOCUMENT_DDL, Base, get_db
from app.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(autouse=True, scope="session")
def test_credentials():
    """Configure test auth credentials directly on settings."""
    from app.core.config import settings
    settings.auth_username = "admin"
    settings.auth_password_hash = hash_password("admin")


@pytest.fixture
async def db_session():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all cannot express the documents FTS5 table or its partial
        # uniques; apply the same DDL init_db does so the suite matches boot.
        for _label, sql in DOCUMENT_DDL:
            await conn.exec_driver_sql(sql)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    # Background tasks open their own session through `AsyncSessionLocal` — the
    # request-scoped `get_db` override does not reach them. Left alone they would
    # run against the *real* configured database, so point the factory at the
    # test engine everywhere it was imported by name.
    patched = [
        importlib.import_module(name)
        for name in (
            "app.db.database",
            "app.api.routes.zigbee",
            "app.api.routes.zwave",
            "app.api.routes.proxmox",
            "app.api.routes.scan",
        )
    ]
    originals = [
        (module, getattr(module, "AsyncSessionLocal", None)) for module in patched
    ]
    for module, original in originals:
        if original is not None:
            module.AsyncSessionLocal = session_factory
    async with session_factory() as session:
        yield session
    for module, original in originals:
        if original is not None:
            module.AsyncSessionLocal = original
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
async def headers(client: AsyncClient):
    """Authenticated Bearer headers for the default admin test user."""
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(autouse=True)
def _reset_doc_search_probe():
    """Forget whether FTS5 was available — each test gets a fresh database."""
    from app.services import doc_search

    doc_search.reset_availability_cache()
    yield
    doc_search.reset_availability_cache()
