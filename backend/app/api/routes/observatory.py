"""Optional, server-configured Observatory snapshot bridge. No inventory writes."""
import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings

router = APIRouter(dependencies=[Depends(get_current_user)])
MAX_BYTES = 2 * 1024 * 1024


class Host(BaseModel):
    name: str = Field(max_length=200)
    cpu_percent: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    memory_used_gib: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    memory_total_gib: float | None = Field(default=None, gt=0, allow_inf_nan=False)


class Guest(BaseModel):
    name: str = Field(max_length=200)
    kind: str = Field(max_length=40)
    id: int | str
    state: str = Field(max_length=40)


class Finding(BaseModel):
    level: str = Field(max_length=20)
    title: str = Field(max_length=500)
    explanation: str = Field(max_length=2000)


class Snapshot(BaseModel):
    host: Host
    collected_at: datetime
    collection_state: str = Field(default="unknown", max_length=40)
    stale_after_seconds: int = Field(default=60, ge=1, le=3600)
    guests: list[Guest] = Field(default_factory=list, max_length=2000)


class Envelope(BaseModel):
    snapshot: Snapshot
    insights: list[Finding] = Field(default_factory=list, max_length=2000)


def valid_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return bool(parsed.scheme in ("http", "https") and parsed.hostname
                    and not parsed.username and not parsed.password and not parsed.fragment
                    and not parsed.query and parsed.port != 0)
    except ValueError:
        return False


@router.get("/snapshot")
async def snapshot(response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    url = settings.observatory_snapshot_url
    if not url:
        return {"enabled": False}
    dashboard = settings.observatory_dashboard_url
    if (not valid_url(url) or not valid_url(dashboard)
            or len(settings.observatory_token) < 32):
        raise HTTPException(503, "Observatory integration configuration is incomplete")
    try:
        # An absolute deadline also bounds servers that trickle response chunks.
        async with asyncio.timeout(8), httpx.AsyncClient(
            timeout=5, follow_redirects=False, trust_env=False,
        ) as client, client.stream(
            "GET", url, headers={"Authorization": f"Bearer {settings.observatory_token}"},
        ) as upstream:
            if upstream.status_code != 200:
                raise ValueError("upstream status")
            body = bytearray()
            async for chunk in upstream.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise ValueError("response too large")
            payload = Envelope.model_validate(json.loads(body))
        at = payload.snapshot.collected_at
        if at.tzinfo is None:
            raise ValueError("timestamp must include timezone")
        age = (datetime.now(UTC) - at).total_seconds()
        return {
            "enabled": True,
            "dashboard_url": dashboard.rstrip("/"),
            "stale": age < -60 or age > payload.snapshot.stale_after_seconds,
            **payload.model_dump(mode="json"),
        }
    except (httpx.HTTPError, TimeoutError, ValueError):
        # Never return remote bodies, target URLs or authentication material.
        raise HTTPException(502, "Observatory is unavailable or returned an invalid snapshot") from None
