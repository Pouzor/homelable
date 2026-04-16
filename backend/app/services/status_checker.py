"""Per-node status checks: ping, http, https, tcp, ssh, prometheus, health, proxmox, none."""
import asyncio
import logging
import socket
import sys
import time
from typing import Any

import httpx
from proxmoxer import ProxmoxAPI

logger = logging.getLogger(__name__)

async def check_node(node_data: dict) -> dict[str, Any]:
    check_method = node_data.get("check_method")
    host = node_data.get("check_target") or node_data.get("ip")
    properties = node_data.get("properties", [])

    if check_method == "none":
        return {"status": "online", "response_time_ms": None}
    if not host:
        return {"status": "unknown", "response_time_ms": None}

    start = time.monotonic()
    try:
        match check_method:
            case "ping":
                ok = await _ping(host)
            case "proxmox":
                props = {p['name']: p['value'] for p in properties if 'name' in p}
                ok = await _check_proxmox(
                    host, props.get("proxmox_node"), props.get("proxmox_vmid"),
                    props.get("proxmox_token"), props.get("proxmox_secret")
                )
            case "http" | "https":
                url = host if host.startswith("http") else f"{check_method}://{host}"
                ok = await _http_get(url, verify=(check_method == "https"))
            case "tcp" | "ssh":
                port = 22 if check_method == "ssh" else int(host.rpartition(":")[2] or 80)
                ok = await _tcp_connect(host.rpartition(":")[0] or host, port)
            case "prometheus" | "health":
                path = "/metrics" if check_method == "prometheus" else "/health"
                url = host if host.startswith("http") else f"http://{host}{path}"
                ok = await _http_get(url)
            case _:
                ok = await _ping(host)

        elapsed_ms = int((time.monotonic() - start) * 1000)
        return {"status": "online" if ok else "offline", "response_time_ms": elapsed_ms}
    except Exception as exc:
        logger.debug("Check failed for %s: %s", host, exc)
        return {"status": "offline", "response_time_ms": None}

async def _ping(host: str) -> bool:
    args = ["ping", "-c", "1", "-W", "2", host] if sys.platform != "win32" else ["ping", "-n", "1", "-w", "2000", host]
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, _ = await proc.communicate()
    out = stdout.decode("utf-8", errors="ignore").lower()
    return proc.returncode == 0 and "unreachable" not in out and "100% packet loss" not in out

async def _http_get(url: str, verify: bool = False) -> bool:
    async with httpx.AsyncClient(verify=verify, timeout=5) as client:
        resp = await client.get(url, follow_redirects=True)
        return resp.status_code < 500

async def _tcp_connect(host: str, port: int) -> bool:
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=3)
        writer.close()
        await writer.wait_closed()
        return True
    except (TimeoutError, OSError, socket.gaierror):
        return False

async def _check_proxmox(host, node, vmid, token, secret) -> bool:
    if not all([node, vmid, token, secret]): return False
    def sync_check():
        p = ProxmoxAPI(host, user=token, token_name="", token_value=secret, verify_ssl=False)
        try: return p.nodes(node).qemu(vmid).status.current.get()["status"] == "running"
        except: 
            try: return p.nodes(node).lxc(vmid).status.current.get()["status"] == "running"
            except: return False
    return await asyncio.to_thread(sync_check)