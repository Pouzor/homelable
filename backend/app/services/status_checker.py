"""Per-node status checks: ping, http, https, tcp, ssh, prometheus, health, none."""
import asyncio
import logging
import socket
import sys
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)


async def check_node(check_method: str, target: str | None, ip: str | None) -> dict[str, Any]:
    """
    Run the appropriate check and return {status, response_time_ms}.
    status is one of: online, offline, unknown.
    """
    if check_method == "none":
        return {"status": "online", "response_time_ms": None}

    # Use only the first IP when the field contains comma-separated addresses
    raw_ip = ip.split(",")[0].strip() if ip else None
    host = target or raw_ip
    if not host:
        return {"status": "unknown", "response_time_ms": None}
    # Reject hostnames that look like CLI flags — defends ping/tcp invocations
    # against arg-injection if a malicious admin sets target like "-O".
    if host.startswith("-"):
        logger.warning("Rejecting check target that starts with '-': %r", host)
        return {"status": "unknown", "response_time_ms": None}

    start = time.monotonic()
    try:
        match check_method:
            case "ping":
                ok = await _ping(host)
            case "http":
                url = host if host.startswith("http") else f"http://{host}"
                ok = await _http_get(url)
            case "https":
                url = host if host.startswith("https") else f"https://{host}"
                ok = await _http_get(url, verify=True)
            case "tcp":
                host_part, _, port_str = host.rpartition(":")
                port = int(port_str) if port_str.isdigit() else 80
                ok = await _tcp_connect(host_part or host, port)
            case "ssh":
                ok = await _tcp_connect(host, 22)
            case "prometheus":
                url = host if host.startswith("http") else f"http://{host}/metrics"
                ok = await _http_get(url)
            case "health":
                url = host if host.startswith("http") else f"http://{host}/health"
                ok = await _http_get(url)
            case _:
                ok = await _ping(host)

        elapsed_ms = int((time.monotonic() - start) * 1000)
        return {"status": "online" if ok else "offline", "response_time_ms": elapsed_ms}

    except Exception as exc:
        logger.debug("Check failed for %s (%s): %s", host, check_method, exc)
        return {"status": "offline", "response_time_ms": None}


def _is_ipv6(host: str) -> bool:
    """True if host is a literal IPv6 address (bracketed or bare)."""
    try:
        socket.inet_pton(socket.AF_INET6, host.strip("[]"))
        return True
    except OSError:
        return False


async def _ping(host: str) -> bool:
    # Send 2 probes with a ~2s timeout so a single dropped packet or a slow
    # device (ESPHome, IoT) doesn't flap a node offline. Success = any reply.
    #
    # -W flag units differ by OS:
    #   Linux:   seconds        (-W 2   = 2s)
    #   macOS:   milliseconds   (-W 2000 = 2s)
    #   Windows: -w in ms       (-w 2000 = 2s)
    #
    # IPv6-only hosts (e.g. Alexa) never answer IPv4 ping, so target the right
    # stack: macOS ships a separate ping6; Linux/Windows take a -6 flag.
    ipv6 = _is_ipv6(host)
    if sys.platform == "win32":
        family = ["-6"] if ipv6 else ["-4"]
        args = ["ping", *family, "-n", "2", "-w", "2000", host]
    elif sys.platform == "darwin":
        args = ["ping6", "-c", "2", host] if ipv6 else ["ping", "-c", "2", "-W", "2000", host]
    else:
        family = ["-6"] if ipv6 else []
        args = ["ping", *family, "-c", "2", "-W", "2", host]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.wait()
    return proc.returncode == 0


async def _http_get(url: str, verify: bool = False) -> bool:
    async with httpx.AsyncClient(verify=verify, timeout=5) as client:
        resp = await client.get(url, follow_redirects=True)
        return resp.status_code < 500


async def _tcp_connect(host: str, port: int) -> bool:
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=3
        )
        writer.close()
        await writer.wait_closed()
        return True
    except (TimeoutError, OSError, socket.gaierror):
        return False


# --- Per-service status checks ---

# Ports that are not HTTP/web. These get NO status check — a service here stays
# grey (unknown) rather than going red. An open TCP socket doesn't prove the
# service is healthy, and a closed one flaps red misleadingly (e.g. SSH on a
# box that simply firewalls 22). Only HTTP(S)-reachable services are checked.
_NON_HTTP_PORTS = frozenset({
    22, 21, 23, 25, 465, 587, 53, 110, 143, 993, 995, 389, 636, 445, 514,
    1433, 3306, 5432, 5672, 6379, 9092, 11211, 27017, 27018,
})
_HTTPS_PORTS = frozenset({443, 8443})


def _service_host(svc: dict[str, Any], host: str) -> str:
    """Bracket bare IPv6 literals for use in a URL."""
    return f"[{host}]" if _is_ipv6(host) else host


async def check_service(svc: dict[str, Any], host: str | None) -> str:
    """Check a single service. Returns 'online' | 'offline' | 'unknown'.

    Only HTTP(S)-reachable services get a real check (an HTTP GET). Everything
    else — SSH, databases, mail, DNS, raw TCP, UDP, port-less — stays 'unknown'
    so it keeps its category colour instead of flashing red. An open TCP socket
    doesn't prove a non-web service is healthy, so we don't pretend it does.
    """
    if not host or host.startswith("-"):
        return "unknown"
    if str(svc.get("protocol", "")).lower() == "udp":
        return "unknown"

    port = svc.get("port")
    port = int(port) if isinstance(port, int) or (isinstance(port, str) and port.isdigit()) else None

    # Non-HTTP ports (SSH 22, DB, mail, …) are never checked — keep them grey.
    if port is not None and port in _NON_HTTP_PORTS:
        return "unknown"

    name = str(svc.get("service_name", "")).lower()
    is_web = port is not None or "http" in name
    if not is_web:
        return "unknown"

    try:
        scheme = "https" if (
            port in _HTTPS_PORTS or "https" in name or "ssl" in name or "tls" in name
        ) else "http"
        url_host = _service_host(svc, host)
        url = f"{scheme}://{url_host}" + (f":{port}" if port is not None else "")
        return "online" if await _http_get(url, verify=False) else "offline"
    except Exception as exc:
        logger.debug("Service check failed for %s:%s (%s)", host, port, exc)
        return "offline"


async def check_services(
    host: str | None, services: list[dict[str, Any]], concurrency: int = 10
) -> list[dict[str, Any]]:
    """Check every service against host concurrently (bounded).

    Returns a list of {port, protocol, status} dicts, one per input service.
    """
    sem = asyncio.Semaphore(concurrency)

    async def _one(svc: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            status = await check_service(svc, host)
        return {"port": svc.get("port"), "protocol": svc.get("protocol"), "status": status}

    return await asyncio.gather(*[_one(s) for s in services]) if services else []
