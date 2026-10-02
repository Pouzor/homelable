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


# ── SVG and PDF ──────────────────────────────────────────────────────────────

SVG_BYTES = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
PDF_BYTES = b"%PDF-1.7\n" + b"0" * 32


@pytest.mark.asyncio
async def test_upload_accepts_svg(client, headers, media_dir):
    res = await _upload(client, headers, name="rack.svg", data=SVG_BYTES, content_type="image/svg+xml")
    assert res.status_code == 200
    assert re.fullmatch(r"/api/v1/media/[0-9a-f]{32}\.svg", res.json()["url"])


@pytest.mark.asyncio
async def test_upload_accepts_svg_behind_a_bom_and_a_comment(client, headers, media_dir):
    data = b"\xef\xbb\xbf  <!-- exported -->\n<SVG xmlns='http://www.w3.org/2000/svg'/>"
    res = await _upload(client, headers, name="a.svg", data=data, content_type="image/svg+xml")
    assert res.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [b"<html><body>hi</body></html>", b"just text with <svg in it", PNG_BYTES])
async def test_upload_rejects_svg_that_is_not_one(client, headers, media_dir, data):
    res = await _upload(client, headers, name="a.svg", data=data, content_type="image/svg+xml")
    assert res.status_code == 415


@pytest.mark.asyncio
async def test_svg_is_served_where_its_scripts_cannot_run(client, headers, media_dir):
    up = await _upload(client, headers, name="rack.svg", data=SVG_BYTES, content_type="image/svg+xml")
    res = await client.get(up.json()["url"])
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/svg+xml")
    csp = res.headers["content-security-policy"]
    assert "sandbox" in csp
    assert "default-src 'none'" in csp
    assert "script-src" not in csp
    assert res.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_other_types_are_served_nosniff_without_the_svg_policy(client, headers, media_dir):
    up = await _upload(client, headers)
    res = await client.get(up.json()["url"])
    assert res.headers["content-type"] == "image/png"
    assert res.headers["x-content-type-options"] == "nosniff"
    # A sandboxed PDF does not open in the browser's viewer, so the policy
    # stays on the one format that needs it.
    assert "content-security-policy" not in res.headers


@pytest.mark.asyncio
async def test_upload_accepts_pdf_and_serves_it_as_one(client, headers, media_dir):
    up = await _upload(client, headers, name="manual.pdf", data=PDF_BYTES, content_type="application/pdf")
    assert up.status_code == 200
    assert re.fullmatch(r"/api/v1/media/[0-9a-f]{32}\.pdf", up.json()["url"])

    res = await client.get(up.json()["url"])
    assert res.content == PDF_BYTES
    assert res.headers["content-type"] == "application/pdf"
    assert "content-security-policy" not in res.headers


@pytest.mark.asyncio
async def test_upload_rejects_pdf_that_is_not_one(client, headers, media_dir):
    res = await _upload(client, headers, name="a.pdf", data=SVG_BYTES, content_type="application/pdf")
    assert res.status_code == 415


@pytest.mark.asyncio
async def test_delete_removes_an_svg(client, headers, media_dir):
    up = await _upload(client, headers, name="rack.svg", data=SVG_BYTES, content_type="image/svg+xml")
    filename = up.json()["filename"]
    res = await client.delete(f"/api/v1/media/{filename}", headers=headers)
    assert res.status_code == 204
    assert not (media_dir / filename).exists()
