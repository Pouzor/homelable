import hmac
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

import bcrypt
import jwt
from authlib.integrations.starlette_client import OAuth, StarletteOAuth2App
from fastapi import Request, Response, status
from jwt import InvalidTokenError
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from app.core.config import settings

ACCESS_TOKEN_USE = "access"
OIDC_SESSION_TOKEN_USE = "oidc_session"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


@dataclass(frozen=True)
class OIDCSession:
    subject: str
    issuer: str
    display_name: str
    csrf_token: str


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire, "token_use": ACCESS_TOKEN_USE}
    return str(jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm))


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("token_use") not in (None, ACCESS_TOKEN_USE):
            return None
        sub = payload.get("sub")
        return str(sub) if sub is not None else None
    except InvalidTokenError:
        return None


def create_oidc_session_token(userinfo: Mapping[str, Any]) -> str:
    subject = userinfo.get("sub")
    issuer = userinfo.get("iss")
    if not isinstance(subject, str) or not subject or not isinstance(issuer, str) or not issuer:
        raise ValueError("OIDC userinfo must contain non-empty 'sub' and 'iss' claims")

    display_name = next(
        (
            value
            for value in (
                userinfo.get("preferred_username"),
                userinfo.get("name"),
                userinfo.get("email"),
                subject,
            )
            if isinstance(value, str) and value
        ),
        subject,
    )
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "oidc_issuer": issuer,
        "name": display_name,
        "csrf": secrets.token_urlsafe(32),
        "iat": now,
        "exp": now + timedelta(minutes=settings.oidc_session_expire_minutes),
        "token_use": OIDC_SESSION_TOKEN_USE,
    }
    return str(jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm))


def decode_oidc_session_token(token: str) -> OIDCSession | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("token_use") != OIDC_SESSION_TOKEN_USE:
            return None
        subject = payload.get("sub")
        issuer = payload.get("oidc_issuer")
        display_name = payload.get("name")
        csrf_token = payload.get("csrf")
        if not isinstance(subject, str) or not subject:
            return None
        if not isinstance(issuer, str) or not issuer:
            return None
        if not isinstance(display_name, str) or not display_name:
            return None
        if not isinstance(csrf_token, str) or not csrf_token:
            return None
        return OIDCSession(
            subject=subject,
            issuer=issuer,
            display_name=display_name,
            csrf_token=csrf_token,
        )
    except InvalidTokenError:
        return None


def oidc_session_cookie_name() -> str:
    return "__Host-homelable-session" if settings.oidc_cookie_secure else "homelable-session"


def set_oidc_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=oidc_session_cookie_name(),
        value=token,
        max_age=settings.oidc_session_expire_minutes * 60,
        secure=settings.oidc_cookie_secure,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_oidc_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=oidc_session_cookie_name(),
        secure=settings.oidc_cookie_secure,
        httponly=True,
        samesite="lax",
        path="/",
    )


def get_oidc_session(request: Request) -> OIDCSession | None:
    token = request.cookies.get(oidc_session_cookie_name())
    return decode_oidc_session_token(token) if token else None


def origin_is_allowed(origin: str | None) -> bool:
    if not origin:
        return False
    allowed_origins = {value.rstrip("/") for value in settings.cors_origins}
    return origin.rstrip("/") in allowed_origins


class OIDCCSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if settings.auth_mode != "oidc" or request.method in SAFE_METHODS:
            return await call_next(request)

        # Explicit non-cookie credentials take precedence in get_current_user,
        # so their requests keep the existing CSRF-free API behavior.
        if request.headers.get("Authorization") or request.headers.get("X-MCP-Service-Key"):
            return await call_next(request)

        oidc_session = get_oidc_session(request)
        if oidc_session is None:
            return await call_next(request)

        csrf_token = request.headers.get("X-Homelable-CSRF", "")
        csrf_valid = hmac.compare_digest(csrf_token.encode(), oidc_session.csrf_token.encode())
        if not csrf_valid or not origin_is_allowed(request.headers.get("Origin")):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "CSRF validation failed"},
            )
        return await call_next(request)


@lru_cache(maxsize=8)
def _build_oidc_client(
    discovery_url: str,
    client_id: str,
    client_secret: str,
    scopes: str,
) -> StarletteOAuth2App:
    oauth = OAuth()
    client = oauth.register(
        name="oidc",
        client_id=client_id,
        client_secret=client_secret,
        server_metadata_url=discovery_url,
        client_kwargs={
            "scope": scopes,
            "code_challenge_method": "S256",
        },
    )
    if client is None:
        raise RuntimeError("Failed to register OIDC client")
    return client


def get_oidc_client() -> StarletteOAuth2App:
    return _build_oidc_client(
        settings.oidc_discovery_url,
        settings.oidc_client_id,
        settings.oidc_client_secret,
        settings.oidc_scopes,
    )
