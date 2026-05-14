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


# --- JWT-level cases ---

async def test_expired_token_rejected(client: AsyncClient):
    """A JWT whose `exp` is in the past must be refused."""
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    from app.core.config import settings
    payload = {
        "sub": "admin",
        "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    res = await client.get("/api/v1/nodes", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


async def test_malformed_token_rejected(client: AsyncClient):
    res = await client.get("/api/v1/nodes", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401


async def test_token_signed_with_wrong_secret_rejected(client: AsyncClient):
    """A token signed with a different key must not be accepted."""
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    from app.core.config import settings
    payload = {
        "sub": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    forged = jwt.encode(payload, "different-secret", algorithm=settings.algorithm)
    res = await client.get("/api/v1/nodes", headers={"Authorization": f"Bearer {forged}"})
    assert res.status_code == 401


async def test_missing_authorization_header_rejected(client: AsyncClient):
    res = await client.get("/api/v1/nodes")
    assert res.status_code == 401


async def test_empty_password_does_not_pass_when_hash_empty(client: AsyncClient):
    """No credentials configured server-side must not authenticate an empty password."""
    from app.core.config import settings
    original_hash = settings.auth_password_hash
    settings.auth_password_hash = ""
    try:
        res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": ""})
        assert res.status_code == 401
    finally:
        settings.auth_password_hash = original_hash


# --- Password helper ---

def test_verify_password_handles_empty_inputs():
    """verify_password must be safe against empty plain / empty hash without raising."""
    from app.core.security import hash_password, verify_password
    h = hash_password("hunter2")
    assert verify_password("hunter2", h) is True
    assert verify_password("", h) is False
    assert verify_password("hunter2", "") is False
    assert verify_password("", "") is False
