"""HTTP probe: GET a discovered port and extract identifying signals.

Used by the optional deep-scan mode to confirm what service sits behind an
open port, regardless of port number. Returns the page <title> plus a small
set of identifying response headers, which fingerprint.match_service() then
matches against signature http_regex fields.
"""
import asyncio
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Headers that commonly carry the application name.
_SIGNAL_HEADERS = ("Server", "X-Powered-By")
# Cap how much body we read when hunting for <title> — avoids large downloads.
_MAX_BODY_BYTES = 64 * 1024
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_PROBE_TIMEOUT = 3.0
# Ports we never bother probing over HTTP (not web services).
_NON_HTTP_PORTS = frozenset({22, 21, 23, 25, 53, 110, 143, 161, 162, 179, 445, 3306, 5432, 6379})


def _extract_title(body: str) -> str | None:
    m = _TITLE_RE.search(body)
    if not m:
        return None
    title = re.sub(r"\s+", " ", m.group(1)).strip()
    return title or None


async def _probe_scheme(client: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
    try:
        resp = await client.get(url, follow_redirects=True)
    except (httpx.HTTPError, OSError):
        return None
    headers = {h: resp.headers[h] for h in _SIGNAL_HEADERS if h in resp.headers}
    body = resp.text[:_MAX_BODY_BYTES] if resp.text else ""
    title = _extract_title(body)
    if not title and not headers:
        return None
    return {"title": title, "headers": headers}


async def probe_port(
    ip: str, port: int, verify_tls: bool = False
) -> dict[str, Any] | None:
    """
    GET https:// then http:// for a port and return {title, headers} or None.

    None means the port did not answer HTTP or yielded no usable signal.
    """
    if port in _NON_HTTP_PORTS:
        return None
    async with httpx.AsyncClient(verify=verify_tls, timeout=_PROBE_TIMEOUT) as client:
        for scheme in ("https", "http"):
            result = await _probe_scheme(client, f"{scheme}://{ip}:{port}/")
            if result is not None:
                return result
    return None


async def probe_open_ports(
    ip: str,
    open_ports: list[dict[str, Any]],
    verify_tls: bool = False,
    concurrency: int = 50,
) -> list[dict[str, Any]]:
    """
    Probe every open port for HTTP signals (option 2: probe all, match after).

    Returns the same port dicts, each enriched with an http_signals key
    (None when the port gave no HTTP signal).
    """
    sem = asyncio.Semaphore(concurrency)

    async def _one(p: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            signals = await probe_port(ip, p["port"], verify_tls)
        return {**p, "http_signals": signals}

    return await asyncio.gather(*(_one(p) for p in open_ports))
