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
