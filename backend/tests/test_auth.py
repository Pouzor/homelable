import time
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from authlib.integrations.base_client.errors import OAuthError
from authlib.jose.errors import ExpiredTokenError, JoseError
from fastapi import WebSocketDisconnect
from httpx import AsyncClient
from starlette.responses import RedirectResponse
from starlette.testclient import TestClient


class FakeOIDCClient:
    def __init__(self, token=None, error: OAuthError | JoseError | None = None):
        self.token = token or {}
        self.error = error
        self.redirect_uri: str | None = None

    async def authorize_redirect(self, _request, redirect_uri: str):
        self.redirect_uri = redirect_uri
        return RedirectResponse("https://idp.example/application/o/authorize/?state=test", status_code=302)

    async def authorize_access_token(self, _request):
        if self.error is not None:
            raise self.error
        return self.token


@pytest.fixture
def oidc_settings():
    from app.core.config import settings
    from app.core.security import _build_oidc_client

    values = {
        "auth_mode": "oidc",
        "oidc_discovery_url": "https://idp.example/application/o/homelable/.well-known/openid-configuration",
        "oidc_client_id": "homelable",
        "oidc_client_secret": "test-client-secret",
        "oidc_redirect_uri": "http://test/api/v1/auth/oidc/callback",
        "oidc_scopes": "openid profile email",
        "oidc_cookie_secure": False,
        "oidc_session_expire_minutes": 60,
        "cors_origins": ["http://test"],
    }
    original = {name: getattr(settings, name) for name in values}
    for name, value in values.items():
        setattr(settings, name, value)
    _build_oidc_client.cache_clear()
    yield settings
    for name, value in original.items():
        setattr(settings, name, value)
    _build_oidc_client.cache_clear()


async def test_login_success(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_auth_config_defaults_to_local(client: AsyncClient):
    res = await client.get("/api/v1/auth/config")
    assert res.status_code == 200
    assert res.json() == {"mode": "local", "oidc_login_url": None}


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

    import jwt

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

    import jwt

    from app.core.config import settings
    payload = {
        "sub": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    forged = jwt.encode(payload, "different-secret-that-is-at-least-32-bytes", algorithm=settings.algorithm)
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


# --- OpenID Connect ---

async def test_oidc_config_exposes_login_url(client: AsyncClient, oidc_settings):
    res = await client.get("/api/v1/auth/config")
    assert res.status_code == 200
    assert res.json() == {
        "mode": "oidc",
        "oidc_login_url": "/api/v1/auth/oidc/login",
    }


async def test_local_login_is_disabled_in_oidc_mode(client: AsyncClient, oidc_settings):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    assert res.status_code == 404


async def test_oidc_login_is_hidden_in_local_mode(client: AsyncClient):
    res = await client.get("/api/v1/auth/oidc/login")
    assert res.status_code == 404


async def test_oidc_login_uses_configured_callback(client: AsyncClient, oidc_settings):
    fake_client = FakeOIDCClient()
    with patch("app.api.routes.auth.get_oidc_client", return_value=fake_client):
        res = await client.get("/api/v1/auth/oidc/login")
    assert res.status_code == 302
    assert res.headers["location"].startswith("https://idp.example/")
    assert fake_client.redirect_uri == "http://test/api/v1/auth/oidc/callback"


async def test_oidc_client_enables_pkce_s256_and_nonce(oidc_settings):
    from app.core.security import get_oidc_client

    oidc_client = get_oidc_client()
    metadata = {"authorization_endpoint": "https://idp.example/application/o/authorize/"}
    with patch.object(oidc_client, "load_server_metadata", AsyncMock(return_value=metadata)):
        authorization = await oidc_client.create_authorization_url(oidc_settings.oidc_redirect_uri)

    query = parse_qs(urlparse(authorization["url"]).query)
    assert query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"]
    assert "code_challenge" in query
    assert "code_verifier" not in query
    assert query["nonce"] == [authorization["nonce"]]
    assert authorization["code_verifier"]


async def test_oidc_callback_creates_session_for_api(client: AsyncClient, oidc_settings):
    fake_client = FakeOIDCClient(token={
        "userinfo": {
            "iss": "https://idp.example/application/o/homelable/",
            "sub": "user-123",
            "preferred_username": "alice",
        },
    })
    with patch("app.api.routes.auth.get_oidc_client", return_value=fake_client):
        callback = await client.get("/api/v1/auth/oidc/callback")

    assert callback.status_code == 303
    assert callback.headers["location"] == "/"
    cookie = callback.headers["set-cookie"]
    assert "homelable-session=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["subject"] == "user-123"
    assert me.json()["display_name"] == "alice"
    assert me.json()["auth_method"] == "oidc"
    assert me.json()["issuer"] == "https://idp.example/application/o/homelable/"
    assert me.json()["csrf_token"]

    protected = await client.get("/api/v1/nodes")
    assert protected.status_code == 200


@pytest.mark.parametrize("userinfo", [None, {}, {"sub": "user-123"}, {"iss": "https://idp.example/"}])
async def test_oidc_callback_rejects_missing_identity_claims(client: AsyncClient, oidc_settings, userinfo):
    token = {} if userinfo is None else {"userinfo": userinfo}
    fake_client = FakeOIDCClient(token=token)
    with patch("app.api.routes.auth.get_oidc_client", return_value=fake_client):
        res = await client.get("/api/v1/auth/oidc/callback")
    assert res.status_code == 401
    assert res.json() == {"detail": "OIDC authentication failed"}


async def test_oidc_callback_hides_protocol_error_details(client: AsyncClient, oidc_settings):
    fake_client = FakeOIDCClient(error=OAuthError(error="invalid_grant", description="sensitive detail"))
    with patch("app.api.routes.auth.get_oidc_client", return_value=fake_client):
        res = await client.get("/api/v1/auth/oidc/callback")
    assert res.status_code == 401
    assert res.json() == {"detail": "OIDC authentication failed"}
    assert "sensitive detail" not in res.text


async def test_oidc_callback_hides_claim_validation_error_details(client: AsyncClient, oidc_settings):
    fake_client = FakeOIDCClient(error=ExpiredTokenError())
    with patch("app.api.routes.auth.get_oidc_client", return_value=fake_client):
        res = await client.get("/api/v1/auth/oidc/callback")
    assert res.status_code == 401
    assert res.json() == {"detail": "OIDC authentication failed"}
    assert "expired" not in res.text.lower()


async def test_oidc_session_token_cannot_be_used_as_bearer(client: AsyncClient, oidc_settings):
    from app.core.security import create_oidc_session_token

    token = create_oidc_session_token({"iss": "https://idp.example/", "sub": "user-123"})
    res = await client.get("/api/v1/nodes", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


async def test_oidc_cookie_mutations_require_csrf_and_allowed_origin(client: AsyncClient, oidc_settings):
    fake_client = FakeOIDCClient(token={
        "userinfo": {
            "iss": "https://idp.example/application/o/homelable/",
            "sub": "user-123",
            "preferred_username": "alice",
        },
    })
    with patch("app.api.routes.auth.get_oidc_client", return_value=fake_client):
        await client.get("/api/v1/auth/oidc/callback")
    csrf_token = (await client.get("/api/v1/auth/me")).json()["csrf_token"]

    missing = await client.post("/api/v1/auth/logout")
    assert missing.status_code == 403
    wrong_origin = await client.post(
        "/api/v1/auth/logout",
        headers={"Origin": "https://evil.example", "X-Homelable-CSRF": csrf_token},
    )
    assert wrong_origin.status_code == 403
    valid = await client.post(
        "/api/v1/auth/logout",
        headers={"Origin": "http://test", "X-Homelable-CSRF": csrf_token},
    )
    assert valid.status_code == 204
    assert "Max-Age=0" in valid.headers["set-cookie"]
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def test_local_bearer_logout_does_not_require_csrf(client: AsyncClient, headers):
    res = await client.post("/api/v1/auth/logout", headers=headers)
    assert res.status_code == 204


# --- WebSocket authentication ---

def _wait_for_connection_count(expected: int) -> None:
    from app.api.routes import status as status_routes

    deadline = time.monotonic() + 1
    while len(status_routes._connections) != expected and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(status_routes._connections) == expected


def test_local_websocket_keeps_first_message_bearer_flow():
    from app.core.security import create_access_token
    from app.main import app

    test_client = TestClient(app)
    try:
        with test_client.websocket_connect(
            "/api/v1/status/ws/status",
            headers={"Origin": "http://localhost:3000"},
        ) as websocket:
            websocket.send_json({"token": create_access_token("admin")})
            _wait_for_connection_count(1)
        _wait_for_connection_count(0)
    finally:
        test_client.close()


def test_websocket_rejects_untrusted_origin_before_auth():
    from app.main import app

    test_client = TestClient(app)
    try:
        with (
            pytest.raises(WebSocketDisconnect) as caught,
            test_client.websocket_connect(
                "/api/v1/status/ws/status",
                headers={"Origin": "https://evil.example"},
            ) as websocket,
        ):
            websocket.receive_text()
        assert caught.value.code == 1008
    finally:
        test_client.close()


def test_oidc_websocket_uses_session_cookie_without_javascript_token(oidc_settings):
    from app.core.security import create_oidc_session_token, oidc_session_cookie_name
    from app.main import app

    session_token = create_oidc_session_token({"iss": "https://idp.example/", "sub": "user-123"})
    test_client = TestClient(app)
    test_client.cookies.set(oidc_session_cookie_name(), session_token)
    try:
        with test_client.websocket_connect(
            "/api/v1/status/ws/status",
            headers={"Origin": "http://test"},
        ):
            _wait_for_connection_count(1)
        _wait_for_connection_count(0)
    finally:
        test_client.close()


def test_oidc_websocket_rejects_missing_session_cookie(oidc_settings):
    from app.main import app

    test_client = TestClient(app)
    try:
        with (
            pytest.raises(WebSocketDisconnect) as caught,
            test_client.websocket_connect(
                "/api/v1/status/ws/status",
                headers={"Origin": "http://test"},
            ) as websocket,
        ):
            websocket.receive_text()
        assert caught.value.code == 1008
    finally:
        test_client.close()
