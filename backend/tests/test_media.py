import re

import pytest

from app.api.routes import media
from app.core.config import settings

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 32


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    """Point uploads at a temp folder for the duration of a test."""
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    return tmp_path


async def _upload(client, headers, name="plan.png", data=PNG_BYTES, content_type="image/png"):
    return await client.post(
        "/api/v1/media/upload",
        files={"file": (name, data, content_type)},
        headers=headers,
    )


@pytest.mark.asyncio
async def test_upload_requires_auth(client, media_dir):
    res = await _upload(client, headers={})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_upload_stores_file_and_returns_url(client, headers, media_dir):
    res = await _upload(client, headers)
    assert res.status_code == 200
    body = res.json()
    assert re.fullmatch(r"/api/v1/media/[0-9a-f]{32}\.png", body["url"])
    # File written to disk with the server-generated name (client name ignored).
    assert (media_dir / body["filename"]).read_bytes() == PNG_BYTES
    assert body["filename"] != "plan.png"


@pytest.mark.asyncio
async def test_upload_rejects_unsupported_type(client, headers, media_dir):
    res = await _upload(client, headers, name="a.txt", data=b"hello", content_type="text/plain")
    assert res.status_code == 415


@pytest.mark.asyncio
async def test_upload_rejects_content_type_magic_mismatch(client, headers, media_dir):
    # Claims PNG but bytes are not a PNG.
    res = await _upload(client, headers, data=b"not-a-real-png", content_type="image/png")
    assert res.status_code == 415


@pytest.mark.asyncio
async def test_upload_rejects_oversize(client, headers, media_dir, monkeypatch):
    monkeypatch.setattr(media, "MAX_BYTES", 8)
    res = await _upload(client, headers, data=PNG_BYTES)  # > 8 bytes
    assert res.status_code == 413


@pytest.mark.asyncio
async def test_get_serves_uploaded_file(client, headers, media_dir):
    up = await _upload(client, headers)
    res = await client.get(up.json()["url"])  # public, no auth
    assert res.status_code == 200
    assert res.content == PNG_BYTES


@pytest.mark.asyncio
async def test_get_rejects_bad_filename(client, media_dir):
    res = await client.get("/api/v1/media/..%2f..%2fetc%2fpasswd")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_rejects_bad_filename(client, headers, media_dir):
    res = await client.delete("/api/v1/media/..%2f..%2fetc%2fpasswd", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_requires_auth_and_removes_file(client, headers, media_dir):
    up = await _upload(client, headers)
    filename = up.json()["filename"]

    assert (await client.delete(f"/api/v1/media/{filename}")).status_code == 401
    assert (media_dir / filename).exists()

    res = await client.delete(f"/api/v1/media/{filename}", headers=headers)
    assert res.status_code == 204
    assert not (media_dir / filename).exists()
    assert (await client.get(up.json()["url"])).status_code == 404
