import hmac

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import create_access_token, verify_password

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest) -> TokenResponse:
    # Always run both checks to prevent timing-based username enumeration.
    # hmac.compare_digest is constant-time; verify_password (bcrypt) always runs.
    username_ok = hmac.compare_digest(body.username, settings.auth_username)
    password_ok = verify_password(body.password, settings.auth_password_hash)
    if not username_ok or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(body.username)
    return TokenResponse(access_token=token)
