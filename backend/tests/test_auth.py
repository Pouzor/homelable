import pytest
from httpx import AsyncClient


async def test_login_success(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_login_wrong_password(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401


async def test_login_wrong_username(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "notadmin", "password": "admin"})
    assert res.status_code == 401


async def test_protected_route_requires_auth(client: AsyncClient):
    res = await client.get("/api/v1/nodes")
    assert res.status_code == 401


async def test_health_is_public(client: AsyncClient):
    res = await client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


# --- MCP service key auth ---

@pytest.fixture
def with_service_key():
    from app.core.config import settings
    settings.mcp_service_key = "test-service-key"
    yield "test-service-key"
    settings.mcp_service_key = ""


async def test_service_key_grants_access(client: AsyncClient, with_service_key):
    res = await client.get("/api/v1/nodes", headers={"X-MCP-Service-Key": with_service_key})
    assert res.status_code == 200


async def test_service_key_wrong_value(client: AsyncClient, with_service_key):
    res = await client.get("/api/v1/nodes", headers={"X-MCP-Service-Key": "wrong-key"})
    assert res.status_code == 401


async def test_service_key_disabled_when_not_configured(client: AsyncClient):
    from app.core.config import settings
    settings.mcp_service_key = ""
    res = await client.get("/api/v1/nodes", headers={"X-MCP-Service-Key": "any-key"})
    assert res.status_code == 401


async def test_login_with_malformed_hash_returns_401_not_500(client: AsyncClient):
    """Malformed hash (e.g. $ stripped by shell) must not crash with 500."""
    from app.core.config import settings
    original = settings.auth_password_hash
    settings.auth_password_hash = "2b12RtMbyw17l4N5UGzeXMNAWu"  # $ signs stripped
    try:
        res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
        assert res.status_code == 401
    finally:
        settings.auth_password_hash = original
