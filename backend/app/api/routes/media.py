"""Generic media upload/serve endpoint.

Files are stored on disk (see `Settings.media_dir`) with server-generated
UUID filenames — never in the DB, and the client filename is never trusted.
Upload/delete require auth; GET is public so plain <img> tags and the read-only
live view can load images (filenames are unguessable).

Used by the floor-plan feature and by documents, which embed images and link
PDFs. Because GET is public and same-origin, a format that can carry script
(SVG) is only served under a policy that keeps it from running — see
`get_media`.
"""

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import get_current_user
from app.core.config import settings

router = APIRouter()

# content-type → extension. Also the allowlist of accepted uploads.
ALLOWED_TYPES: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
}
# The way back, so a file is served as what it was accepted as rather than as
# whatever the host's mime table guesses from the extension.
_MEDIA_TYPES: dict[str, str] = {ext: content_type for content_type, ext in ALLOWED_TYPES.items()}

# Magic-byte signatures for defense-in-depth (don't trust content-type alone).
_MAGIC: dict[str, tuple[bytes, ...]] = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".webp": (b"RIFF",),  # RIFF....WEBP; RIFF prefix is enough to reject non-images
    ".pdf": (b"%PDF-",),
}
# SVG is text and has no signature: the root element has to turn up early.
_SVG_SNIFF_BYTES = 64 * 1024

MAX_BYTES = 10 * 1024 * 1024  # 10 MB

# An SVG opened at its own URL is a document, and its scripts would run on the
# app's origin. `sandbox` gives it an opaque origin with scripting off, and the
# rest stops it loading anything but its own inline styles and embedded data.
# Inside an <img> none of this matters: script never runs there.
_SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox"

# Only ever serve/delete files we created: 32 hex chars + known extension.
_NAME_RE = re.compile(r"[0-9a-f]{32}\.(png|jpg|webp|svg|pdf)")


def _resolve_media_path(filename: str) -> Path:
    """Return the existing media file named `filename`, or raise 404.

    `filename` is validated against `_NAME_RE` (no separators, no `..`), then
    matched by name against the actual directory listing. The user string is
    only ever compared with `==` against trusted `iterdir()` entries — it never
    builds a path — so a crafted value cannot escape the media dir.
    """
    if not _NAME_RE.fullmatch(filename):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    base = settings.media_dir()
    if base.is_dir():
        for entry in base.iterdir():
            if entry.name == filename and entry.is_file():
                return entry
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _content_matches(ext: str, data: bytes) -> bool:
    """Whether `data` really is the type its content-type claimed."""
    if ext == ".svg":
        head = data[:_SVG_SNIFF_BYTES].removeprefix(b"\xef\xbb\xbf").lstrip().lower()
        return head.startswith(b"<") and b"<svg" in head
    return any(data.startswith(sig) for sig in _MAGIC[ext])


@router.post("/upload")
async def upload_media(file: UploadFile, _user: str = Depends(get_current_user)) -> dict[str, str]:
    ext = ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported media type — PNG, JPEG, WebP, SVG or PDF only",
        )
    # Read one byte past the cap so we can detect oversize without loading more.
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File too large (max 10 MB)",
        )
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if not _content_matches(ext, data):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File content does not match its type",
        )

    media_dir = settings.media_dir()
    media_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (media_dir / name).write_bytes(data)
    return {"filename": name, "url": f"/api/v1/media/{name}"}


@router.get("/{filename}")
async def get_media(filename: str) -> FileResponse:
    # _resolve_media_path returns only an existing file, else raises 404.
    path = _resolve_media_path(filename)
    # nosniff: the declared type is the one that was validated on the way in.
    headers = {"X-Content-Type-Options": "nosniff"}
    if path.suffix == ".svg":
        headers["Content-Security-Policy"] = _SVG_CSP
    return FileResponse(path, media_type=_MEDIA_TYPES[path.suffix], headers=headers)


@router.delete("/{filename}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(filename: str, _user: str = Depends(get_current_user)) -> None:
    _resolve_media_path(filename).unlink()
