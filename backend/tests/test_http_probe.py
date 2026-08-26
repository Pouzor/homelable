"""Tests for the HTTP probe used by deep-scan service identification."""
from unittest.mock import patch

import httpx
import pytest

from app.services.http_probe import (
    _MAX_BODY_BYTES,
    _extract_title,
    probe_open_ports,
    probe_port,
)


def _response(text: str = "", headers: dict | None = None, status: int = 200) -> httpx.Response:
    return httpx.Response(status_code=status, text=text, headers=headers or {})


class _TransportClient:
    """
    Patch target for httpx.AsyncClient that routes through a MockTransport.

    Real client, fake network: the probe exercises the genuine httpx request
    path (including .stream() and aiter_bytes()) instead of a mock that would
    happily accept any call shape. `requests` records what was actually sent.
    """

    def __init__(self, handler):
        self._handler = handler
        # Bound before patching, so building the real client here does not
        # recurse back into this stand-in.
        self._real = httpx.AsyncClient
        self.kwargs: list[dict] = []
        self.requests: list[httpx.Request] = []

    def _record(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._handler(request)

    def __call__(self, **kwargs):
        self.kwargs.append(dict(kwargs))
        kwargs.pop("verify", None)
        return self._real(transport=httpx.MockTransport(self._record), **kwargs)


def _patch_client(handler) -> tuple:
    """Return (context manager, factory) patching http_probe's AsyncClient."""
    factory = _TransportClient(handler)
    return patch("app.services.http_probe.httpx.AsyncClient", factory), factory


# ── _extract_title ──────────────────────────────────────────────────────────

def test_extract_title_basic():
    assert _extract_title("<html><title>Jellyfin</title></html>") == "Jellyfin"


def test_extract_title_collapses_whitespace():
    assert _extract_title("<title>\n  My  App\n</title>") == "My App"


def test_extract_title_missing():
    assert _extract_title("<html><body>no title</body></html>") is None


def test_extract_title_case_insensitive():
    assert _extract_title("<TITLE>Portainer</TITLE>") == "Portainer"


# ── probe_port ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_probe_port_reads_title():
    ctx, _ = _patch_client(lambda req: _response("<title>Jellyfin</title>"))
    with ctx:
        result = await probe_port("10.0.0.5", 8096)
    assert result == {"title": "Jellyfin", "headers": {}}


@pytest.mark.asyncio
async def test_probe_port_reads_headers():
    ctx, _ = _patch_client(
        lambda req: _response("", headers={"Server": "nginx", "X-Powered-By": "Express"})
    )
    with ctx:
        result = await probe_port("10.0.0.5", 3000)
    assert result["headers"] == {"Server": "nginx", "X-Powered-By": "Express"}


@pytest.mark.asyncio
async def test_probe_port_falls_back_to_http():
    # https raises, http succeeds
    def handler(request):
        if str(request.url).startswith("https"):
            raise httpx.ConnectError("tls fail")
        return _response("<title>HTTP App</title>")

    ctx, factory = _patch_client(handler)
    with ctx:
        result = await probe_port("10.0.0.5", 8080)
    assert result["title"] == "HTTP App"
    assert len(factory.requests) == 2  # tried https then http


@pytest.mark.asyncio
async def test_probe_port_no_signal_returns_none():
    ctx, _ = _patch_client(lambda req: _response(""))
    with ctx:
        result = await probe_port("10.0.0.5", 8080)
    assert result is None


@pytest.mark.asyncio
async def test_probe_port_timeout_returns_none():
    def handler(request):
        raise httpx.TimeoutException("slow")

    ctx, _ = _patch_client(handler)
    with ctx:
        result = await probe_port("10.0.0.5", 8080)
    assert result is None


@pytest.mark.asyncio
async def test_probe_port_skips_non_http_ports():
    # SSH should never trigger an HTTP request
    ctx, factory = _patch_client(lambda req: _response("<title>nope</title>"))
    with ctx:
        result = await probe_port("10.0.0.5", 22)
    assert result is None
    assert factory.requests == []


@pytest.mark.asyncio
async def test_probe_port_verify_tls_flag_passed():
    ctx, factory = _patch_client(lambda req: _response("<title>X</title>"))
    with ctx:
        await probe_port("10.0.0.5", 8443, verify_tls=True)
    assert factory.kwargs[0]["verify"] is True


# ── endless bodies (issue #375) ─────────────────────────────────────────────

_CHUNK_SIZE = 16 * 1024


def _endless_body(counter: dict, head: bytes = b""):
    """
    A body that never ends and declares no Content-Length. Bounded at 512
    chunks so a regression fails the test instead of hanging the suite.
    """

    async def gen():
        if head:
            counter["bytes"] += len(head)
            yield head
        for _ in range(512):
            counter["bytes"] += _CHUNK_SIZE
            yield b"\0" * _CHUNK_SIZE

    return gen()


@pytest.mark.asyncio
async def test_probe_caps_the_download_of_an_endless_body():
    # _MAX_BODY_BYTES caps the download, not just the <title> scan: the body is
    # streamed and the connection dropped once we hold enough. Allow one chunk
    # of overshoot — the read stops on a chunk boundary.
    counter = {"bytes": 0}

    def handler(request):
        # Plain HTTP only, like the reproducer, so the counter covers one probe.
        if str(request.url).startswith("https"):
            raise httpx.ConnectError("no tls")
        return httpx.Response(
            200,
            headers={"Content-Type": "application/octet-stream"},
            content=_endless_body(counter),
        )

    ctx, _ = _patch_client(handler)
    with ctx:
        result = await probe_port("10.0.0.5", 8095)
    assert result is None  # null bytes carry no title and no signal header
    assert counter["bytes"] <= _MAX_BODY_BYTES + _CHUNK_SIZE


@pytest.mark.asyncio
async def test_probe_still_reads_a_title_from_an_endless_body():
    # Stopping early must not cost us the signal: a <title> in the first chunk
    # is still found even though the rest of the stream is abandoned.
    counter = {"bytes": 0}

    def handler(request):
        if str(request.url).startswith("https"):
            raise httpx.ConnectError("no tls")
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html"},
            content=_endless_body(counter, head=b"<html><title>Jellyfin</title>"),
        )

    ctx, _ = _patch_client(handler)
    with ctx:
        result = await probe_port("10.0.0.5", 8096)
    assert result["title"] == "Jellyfin"
    assert counter["bytes"] <= _MAX_BODY_BYTES + _CHUNK_SIZE


# ── probe_open_ports ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_probe_open_ports_enriches_each_port():
    def handler(request):
        if ":8096" in str(request.url):
            return _response("<title>Jellyfin</title>")
        return _response("")

    ports = [{"port": 8096, "protocol": "tcp"}, {"port": 9999, "protocol": "tcp"}]
    ctx, _ = _patch_client(handler)
    with ctx:
        result = await probe_open_ports("10.0.0.5", ports)

    by_port = {p["port"]: p for p in result}
    assert by_port[8096]["http_signals"]["title"] == "Jellyfin"
    assert by_port[9999]["http_signals"] is None
