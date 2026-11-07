"""Git sync — push the documentation and every diagram to a git repository.

Configured in `.env` only (`GIT_SYNC_*`); the UI reads what is configured and
triggers a sync, it never edits the connection. See `services/git_sync.py` for
what lands in the repository.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.routes.canvas import load_canvas
from app.api.routes.racks import load_racks
from app.core.config import settings
from app.db.database import get_db
from app.db.models import Design, Document
from app.services.doc_export import ExportDoc
from app.services.git_sync import (
    DiagramExport,
    GitSyncConfig,
    GitSyncError,
    build_tree,
    commit_message,
    media_refs,
    public_url,
    push,
    scrub,
    sync_subdir,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# One sync at a time: two would share the working copy.
_lock = asyncio.Lock()


class GitSyncLast(BaseModel):
    status: Literal["pushed", "unchanged", "failed"]
    at: datetime
    commit: str | None = None
    files_changed: int = 0
    error: str | None = None


class GitSyncStatus(BaseModel):
    configured: bool
    repo_url: str | None = None
    branch: str | None = None
    path: str | None = None
    auth: Literal["token", "ssh", "none"] | None = None
    running: bool = False
    last: GitSyncLast | None = None


class GitSyncResponse(BaseModel):
    status: Literal["pushed", "unchanged"]
    commit: str | None
    files_changed: int
    documents: int
    diagrams: int
    synced_at: datetime


def _config() -> GitSyncConfig | None:
    if not settings.git_sync_repo_url:
        return None
    return GitSyncConfig(
        repo_url=settings.git_sync_repo_url,
        branch=settings.git_sync_branch or "main",
        path=settings.git_sync_path,
        token=settings.git_sync_token,
        username=settings.git_sync_username,
        ssh_key=settings.git_sync_ssh_key,
        author_name=settings.git_sync_author_name or "Homelable",
        author_email=settings.git_sync_author_email or "homelable@localhost",
    )


def _data_dir() -> Path:
    return Path(settings.sqlite_path).parent


def _state_path() -> Path:
    # Beside the working copy, not inside it: the working copy is wiped whenever
    # it has to be rebuilt.
    return _data_dir() / "git-sync-state.json"


def _read_last() -> GitSyncLast | None:
    try:
        return GitSyncLast.model_validate_json(_state_path().read_text())
    except (OSError, ValueError):
        return None


def _write_last(last: GitSyncLast) -> None:
    try:
        _state_path().parent.mkdir(parents=True, exist_ok=True)
        _state_path().write_text(last.model_dump_json())
    except OSError:
        logger.warning("git sync: could not record the last sync", exc_info=True)


def _plain(model: BaseModel) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(model.model_dump_json())
    return data


def _read_media(names: set[str]) -> dict[str, bytes]:
    """The bytes of each upload in `names` still on disk.

    Names are only matched against the directory listing, never joined into a
    path — the same rule the media route serves by.
    """
    base = settings.media_dir()
    if not names or not base.is_dir():
        return {}
    return {entry.name: entry.read_bytes() for entry in base.iterdir() if entry.name in names and entry.is_file()}


async def _collect(db: AsyncSession) -> tuple[list[ExportDoc], list[DiagramExport]]:
    docs = [
        ExportDoc(
            id=doc.id,
            kind=doc.kind,
            title=doc.title,
            slug=doc.slug,
            parent_id=doc.parent_id,
            body=doc.body or "",
            device_id=doc.device_id,
            node_id=doc.node_id,
            design_id=doc.design_id,
        )
        for doc in (await db.execute(select(Document))).scalars().all()
    ]
    diagrams: list[DiagramExport] = []
    for design in (await db.execute(select(Design))).scalars().all():
        # The same loaders the canvas uses, so a pushed diagram is exactly what
        # the API serves — and what an import will be able to save back.
        if design.design_type == "rack":
            state = _plain(await load_racks(design_id=design.id, db=db, _=""))
        else:
            state = _plain(await load_canvas(design_id=design.id, db=db, _=""))
        diagrams.append(
            DiagramExport(
                id=design.id,
                name=design.name,
                design_type=design.design_type,
                icon=design.icon,
                state=state,
            )
        )
    return docs, diagrams


@router.get("", response_model=GitSyncStatus)
async def get_status(_: str = Depends(get_current_user)) -> GitSyncStatus:
    cfg = _config()
    if cfg is None:
        return GitSyncStatus(configured=False)
    return GitSyncStatus(
        configured=True,
        repo_url=public_url(cfg.repo_url),
        branch=cfg.branch,
        path=cfg.path,
        auth=cfg.auth,  # type: ignore[arg-type]
        running=_lock.locked(),
        last=_read_last(),
    )


@router.post("", response_model=GitSyncResponse)
async def sync(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> GitSyncResponse:
    cfg = _config()
    if cfg is None:
        raise HTTPException(400, "Git sync is not configured — set GIT_SYNC_REPO_URL in the server .env")
    try:
        sync_subdir(cfg.path)
    except GitSyncError as exc:
        raise HTTPException(400, str(exc)) from exc
    if _lock.locked():
        raise HTTPException(409, "A git sync is already running")

    async with _lock:
        docs, diagrams = await _collect(db)
        media = await asyncio.to_thread(_read_media, media_refs(docs, diagrams))
        files = build_tree(docs, diagrams, media)
        now = datetime.now(timezone.utc)
        try:
            # git is blocking I/O, network included — never on the event loop.
            result = await asyncio.to_thread(
                push,
                cfg,
                settings.git_sync_dir(),
                files,
                commit_message(len(docs), len(diagrams)),
                _data_dir() / "git-sync-known_hosts",
            )
        except GitSyncError as exc:
            message = scrub(str(exc), cfg)
            _write_last(GitSyncLast(status="failed", at=now, error=message))
            raise HTTPException(502, f"Git sync failed: {message}") from exc

    _write_last(
        GitSyncLast(
            status=result.status,  # type: ignore[arg-type]
            at=now,
            commit=result.commit,
            files_changed=result.files_changed,
        )
    )
    return GitSyncResponse(
        status=result.status,  # type: ignore[arg-type]
        commit=result.commit,
        files_changed=result.files_changed,
        documents=len(docs),
        diagrams=len(diagrams),
        synced_at=now,
    )
