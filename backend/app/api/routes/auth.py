import hmac
import logging
from collections.abc import Mapping
from typing import cast

from authlib.integrations.base_client.errors import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from starlette.responses import RedirectResponse

from app.api.deps import AuthContext, get_auth_context
from app.core.config import settings
from app.core.security import (
    clear_oidc_session_cookie,
    create_access_token,
    create_oidc_session_token,
    get_oidc_client,
    set_oidc_session_cookie,
    verify_password,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthConfigResponse(BaseModel):
    mode: str
    oidc_login_url: str | None = None


class CurrentUserResponse(BaseModel):
    subject: str
    display_name: str
    auth_method: str
    issuer: str | None = None
    csrf_token: str | None = None


def _require_oidc_mode() -> None:
    if settings.auth_mode != "oidc":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OIDC login is disabled")


@router.get("/config", response_model=AuthConfigResponse)
async def auth_config() -> AuthConfigResponse:
    return AuthConfigResponse(
        mode=settings.auth_mode,
        oidc_login_url="/api/v1/auth/oidc/login" if settings.auth_mode == "oidc" else None,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest) -> TokenResponse:
    if settings.auth_mode != "local":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Local login is disabled")
    # Always run both checks to prevent timing-based username enumeration.
    # hmac.compare_digest is constant-time; verify_password (bcrypt) always runs.
    username_ok = hmac.compare_digest(body.username, settings.auth_username)
    password_ok = verify_password(body.password, settings.auth_password_hash)
    if not username_ok or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(body.username)
    return TokenResponse(access_token=token)


@router.get("/oidc/login")
async def oidc_login(request: Request) -> Response:
    _require_oidc_mode()
    client = get_oidc_client()
    return cast(Response, await client.authorize_redirect(request, settings.oidc_redirect_uri))


@router.get("/oidc/callback")
async def oidc_callback(request: Request) -> Response:
    _require_oidc_mode()
    client = get_oidc_client()
    try:
        token = await client.authorize_access_token(request)
    except OAuthError as exc:
        logger.warning("OIDC callback rejected: %s", exc.error)
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC authentication failed") from None

    userinfo = token.get("userinfo")
    if not isinstance(userinfo, Mapping):
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC authentication failed")
    try:
        session_token = create_oidc_session_token(userinfo)
    except ValueError:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC authentication failed") from None

    request.session.clear()
    response = RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    set_oidc_session_cookie(response, session_token)
    return response


@router.get("/me", response_model=CurrentUserResponse)
async def current_user(context: AuthContext = Depends(get_auth_context)) -> CurrentUserResponse:
    return CurrentUserResponse(
        subject=context.subject,
        display_name=context.display_name,
        auth_method=context.auth_method,
        issuer=context.issuer,
        csrf_token=context.csrf_token,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(_: AuthContext = Depends(get_auth_context)) -> Response:
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_oidc_session_cookie(response)
    return response
