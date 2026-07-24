import hmac
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.security import decode_token, get_oidc_session

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthContext:
    subject: str
    display_name: str
    auth_method: str
    issuer: str | None = None
    csrf_token: str | None = None


def get_auth_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    x_mcp_service_key: str | None = Header(default=None),
) -> AuthContext:
    # 1. MCP service key (Docker-internal only — backend port is not externally exposed)
    if x_mcp_service_key is not None:
        if not settings.mcp_service_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MCP service key not configured")
        if not hmac.compare_digest(x_mcp_service_key.encode(), settings.mcp_service_key.encode()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MCP service key")
        return AuthContext(
            subject="__mcp_service__",
            display_name="MCP service",
            auth_method="mcp",
        )

    # 2. Standard JWT bearer token
    if credentials is not None:
        username = decode_token(credentials.credentials)
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return AuthContext(
            subject=username,
            display_name=username,
            auth_method="local",
        )

    # 3. OIDC session cookie (only active in exclusive OIDC mode)
    if settings.auth_mode == "oidc":
        oidc_session = get_oidc_session(request)
        if oidc_session is not None:
            return AuthContext(
                subject=oidc_session.subject,
                display_name=oidc_session.display_name,
                auth_method="oidc",
                issuer=oidc_session.issuer,
                csrf_token=oidc_session.csrf_token,
            )

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


def get_current_user(context: AuthContext = Depends(get_auth_context)) -> str:
    return context.subject
