"""Network scanner: ARP sweep + nmap service detection + mDNS discovery."""
import asyncio
import ipaddress
import logging
import os
import re
import socket
import subprocess
import threading
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Node, PendingDevice, ScanRun
from app.services.fingerprint import fingerprint_ports, suggest_node_type

logger = logging.getLogger(__name__)

# Run IDs that have been requested to cancel (thread-safe via lock)
_cancelled_runs: set[str] = set()
_cancelled_lock = threading.Lock()
_active_runs: set[str] = set()

# Port list for service detection (Phase 2)
_EXTRA_PORTS = (
    "80,443,22,21,23,25,53,110,143,161,162,179,389,445,548,"
    "554,636,873,1883,1880,1935,2020,2375,2376,3000,3001,3306,"
    "3389,4711,4915,5000,5001,5432,5601,5683,5684,5900,5984,"
    "6052,6379,6432,6443,6767,6789,6800,7878,8000,8006,8080,"
    "8081,8086,8088,8090,8096,8112,8123,8200,8291,8428,8443,"
    "8554,8686,8789,8843,8880,8883,8971,8989,9000,9001,9090,"
    "9091,9092,9093,9100,9117,9200,9300,9411,9443,9696,10051,"
    "16686,34567,37777,51413,64738"
)

_MDNS_SERVICE_TYPES = [
    "_http._tcp.local.",
    "_shelly._tcp.local.",
    "_esphomelib._tcp.local.",
    "_hap._tcp.local.",        # HomeKit Accessory Protocol
    "_mqtt._tcp.local.",
    "_device-info._tcp.local.",
]

try:
    import nmap
    _NMAP_AVAILABLE = True
except ImportError:
    _NMAP_AVAILABLE = False
    logger.warning("python-nmap not available — scanner will run in mock mode")

try:
    from zeroconf import ServiceStateChange
    from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf
    _ZEROCONF_AVAILABLE = True
except ImportError:
    _ZEROCONF_AVAILABLE = False
    logger.warning("zeroconf not available — mDNS discovery disabled")


def request_cancel(run_id: str) -> None:
    """Signal a running scan to stop early."""
    with _cancelled_lock:
        _cancelled_runs.add(run_id)


def _is_cancelled(run_id: str) -> bool:
    with _cancelled_lock:
        return run_id in _cancelled_runs


def mark_run_active(run_id: str) -> None:
    _active_runs.add(run_id)


def mark_run_inactive(run_id: str) -> None:
    _active_runs.discard(run_id)


def is_run_active(run_id: str) -> bool:
    return run_id in _active_runs


def _resolve_hostname(ip: str) -> str | None:
    try:
        return socket.gethostbyaddr(ip)[0]
    except Exception:
        return None


def _extract_os(nm: object, host: str) -> str | None:
    try:
        osmatch = nm[host].get("osmatch", [])  # type: ignore[index]
        if osmatch:
            return str(osmatch[0]["name"])
    except Exception:
        pass
    return None


def _arp_table_hosts(network: str) -> dict[str, dict[str, Any]]:
    """
    Read the OS ARP cache for recently-seen hosts in the target network.
    Works without root on both Linux (/proc/net/arp) and macOS (arp -a).
    Supplements nmap discovery — catches IoT and devices with all ports filtered.
    """
    try:
        net = ipaddress.ip_network(network, strict=False)
        found: dict[str, dict[str, Any]] = {}

        # Linux: parse /proc/net/arp — present on any Linux kernel (including Docker)
        proc_arp = "/proc/net/arp"
        try:
            with open(proc_arp) as f:
                for line in f.readlines()[1:]:  # skip header row
                    parts = line.split()
                    if len(parts) >= 4:
                        ip, mac = parts[0], parts[3]
                        if mac == "00:00:00:00:00:00":
                            continue
                        try:
                            if ipaddress.ip_address(ip) in net:
                                found[ip] = {
                                    "ip": ip, "mac": mac,
                                    "hostname": _resolve_hostname(ip),
                                    "os": None, "open_ports": [],
                                }
                        except ValueError:
                            pass
            # /proc/net/arp opened successfully — return whatever we found (may be empty)
            # Don't fall through to `arp -a` since we're on Linux
            return found
        except FileNotFoundError:
            pass  # Not Linux — fall through to macOS `arp -a`

        # macOS: parse `arp -a` output
        result = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=5)
        for line in result.stdout.splitlines():
            m = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f:]+)", line)
            if not m:
                continue
            ip, mac = m.group(1), m.group(2)
            if mac in ("(incomplete)", "ff:ff:ff:ff:ff:ff"):
                continue
            try:
                if ipaddress.ip_address(ip) in net:
                    found[ip] = {"ip": ip, "mac": mac, "hostname": _resolve_hostname(ip), "os": None, "open_ports": []}
            except ValueError:
                pass
        return found
    except Exception as exc:
        logger.warning("[Phase 1] ARP cache lookup failed: %s", exc)
        return {}


async def _ping_sweep(target: str) -> dict[str, dict[str, Any]]:
    """
    Phase 1: Concurrent ICMP ping sweep + ARP cache.
    Pings all IPs in the CIDR in parallel (up to 50 at once, 1s timeout each).
    Supplements with the OS ARP cache to catch devices that block ICMP.
    Works in Docker with CAP_NET_RAW — no nmap, no false positives.
    """
    net = ipaddress.ip_network(target, strict=False)
    all_ips = [str(ip) for ip in net.hosts()]
    logger.info("[Phase 1] Pinging %d hosts in %s ...", len(all_ips), target)

    sem = asyncio.Semaphore(50)

    async def _ping(ip: str) -> str | None:
        async with sem:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "ping", "-c", "1", "-W", "1", ip,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.wait()
                return ip if proc.returncode == 0 else None
            except Exception:
                return None

    ping_results = await asyncio.gather(*[_ping(ip) for ip in all_ips])
    alive_ips: set[str] = {ip for ip in ping_results if ip is not None}
    logger.info("[Phase 1] %d/%d hosts responded to ping", len(alive_ips), len(all_ips))

    # ARP cache: catch devices that block ICMP but were recently active,
    # and enrich ping-alive hosts with their MAC addresses.
    arp_cache = await asyncio.to_thread(_arp_table_hosts, target)

    alive: dict[str, dict[str, Any]] = {}

    for ip in alive_ips:
        mac = arp_cache.get(ip, {}).get("mac")
        hostname = await asyncio.to_thread(_resolve_hostname, ip)
        logger.info("[Phase 1] %s  mac=%s  hostname=%s  (ping)", ip, mac or "n/a", hostname or "n/a")
        alive[ip] = {"ip": ip, "mac": mac, "hostname": hostname, "os": None, "open_ports": []}

    for ip, host in arp_cache.items():
        if ip not in alive:
            logger.info(
                "[Phase 1] %s  mac=%s  hostname=%s  (ARP cache only)",
                ip, host.get("mac") or "n/a", host.get("hostname") or "n/a",
            )
            alive[ip] = host

    return alive


def _nmap_scan_single(host_dict: dict[str, Any]) -> dict[str, Any]:
    """
    Phase 2 — single-IP port scan with service detection.
    Runs in a thread (blocking). Returns the host dict enriched with open_ports.
    """
    ip = host_dict["ip"]
    logger.info("[Phase 2] Scanning %s ...", ip)

    if not _NMAP_AVAILABLE:
        logger.warning("[Phase 2] nmap not available, skipping %s", ip)
        return host_dict

    is_root = os.geteuid() == 0
    if is_root:
        # SYN scan + version detection (fastest, most accurate)
        scan_args = f"-sS -sV --open -T4 -Pn --host-timeout 60s -p {_EXTRA_PORTS}"
    else:
        # TCP connect scan (-sT) — no raw sockets needed, works without root.
        # nmap auto-selects -sT without root but being explicit avoids edge cases.
        scan_args = f"-sT -sV --open -T4 -Pn --host-timeout 60s -p {_EXTRA_PORTS}"

    logger.debug("[Phase 2] %s args: %s", ip, scan_args)
    nm = nmap.PortScanner()
    try:
        nm.scan(hosts=ip, arguments=scan_args)
    except Exception as exc:
        logger.warning("[Phase 2] nmap FAILED for %s (%s: %s) — skipping port scan", ip, type(exc).__name__, exc)
        return host_dict

    all_scanned = nm.all_hosts()
    logger.debug("[Phase 2] %s — nmap returned %d host(s) in results", ip, len(all_scanned))
    if ip not in all_scanned:
        logger.info("[Phase 2] %s — no open ports found (all closed/filtered or nmap had no results)", ip)
        return host_dict

    open_ports = []
    for proto in nm[ip].all_protocols():
        for port, info in nm[ip][proto].items():
            if info["state"] == "open":
                banner = (info.get("product", "") + " " + info.get("version", "")).strip()
                open_ports.append({"port": port, "protocol": proto, "banner": banner})

    if open_ports:
        port_summary = ", ".join(
            f"{p['port']}/{p['protocol']} ({p['banner'] or 'unknown'})" for p in open_ports
        )
        logger.info("[Phase 2] %s — %d open port(s): %s", ip, len(open_ports), port_summary)
    else:
        logger.info("[Phase 2] %s — 0 open ports detected", ip)

    host_dict["open_ports"] = open_ports
    if not host_dict["mac"]:
        host_dict["mac"] = nm[ip].get("addresses", {}).get("mac")
    host_dict["os"] = _extract_os(nm, ip)
    return host_dict


async def _nmap_port_scan(alive: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Phase 2: Per-IP service detection with bounded concurrency.
    Each host is scanned independently in a thread — no inter-host timeout interference.
    Up to 10 hosts scanned concurrently.
    """
    if not alive:
        return []

    logger.info("[Phase 2] Starting per-IP port scan for %d host(s)", len(alive))
    semaphore = asyncio.Semaphore(10)

    async def _scan_with_sem(host_dict: dict[str, Any]) -> dict[str, Any]:
        async with semaphore:
            return await asyncio.to_thread(_nmap_scan_single, host_dict)

    raw = await asyncio.gather(*[_scan_with_sem(h) for h in alive.values()], return_exceptions=True)
    results = []
    for item in raw:
        if isinstance(item, BaseException):
            logger.warning("[Phase 2] Unexpected error in gather: %s", item)
        else:
            results.append(item)
    logger.info("[Phase 2] Completed — %d/%d host(s) scanned", len(results), len(alive))
    return results


async def _nmap_scan(target: str) -> list[dict[str, Any]]:
    """
    Two-phase scan for a CIDR range.
    Phase 1: Concurrent ping sweep to find alive hosts (fast, no false positives).
    Phase 2: Per-IP nmap port scan with service detection (bounded concurrency, 10 at a time).
    """
    logger.info("[Scan] Starting scan for %s — nmap available: %s", target, _NMAP_AVAILABLE)
    if not _NMAP_AVAILABLE:
        logger.warning("[Scan] nmap not available — returning mock data")
        return _mock_scan(target)
    try:
        alive = await _ping_sweep(target)
        logger.info("[Phase 1] Found %d alive host(s) in %s: %s",
                    len(alive), target, ", ".join(sorted(alive.keys())))
    except Exception as exc:
        logger.error("Phase 1 ping sweep failed: %s", exc)
        raise RuntimeError(str(exc)) from exc
    return await _nmap_port_scan(alive)


async def _mdns_discover(timeout: float = 4.0) -> list[dict[str, Any]]:
    """
    Passive mDNS/Bonjour sweep.
    Returns devices advertising on _shelly._tcp, _esphomelib._tcp, _hap._tcp, etc.
    Runs for `timeout` seconds then returns what it found.
    """
    if not _ZEROCONF_AVAILABLE:
        return []

    import ipaddress

    found_services: list[tuple[str, str]] = []

    def _on_change(
        zeroconf: Any,
        service_type: str,
        name: str,
        state_change: Any,
    ) -> None:
        if state_change == ServiceStateChange.Added:
            found_services.append((service_type, name))

    discovered: dict[str, dict[str, Any]] = {}

    try:
        async with AsyncZeroconf() as azc:
            browser = AsyncServiceBrowser(
                azc.zeroconf, _MDNS_SERVICE_TYPES, handlers=[_on_change]
            )
            await asyncio.sleep(timeout)
            await browser.async_cancel()

            for service_type, name in found_services:
                try:
                    info = AsyncServiceInfo(service_type, name)
                    await info.async_request(azc.zeroconf, 3000)
                    if not info.addresses:
                        continue
                    ip = str(ipaddress.IPv4Address(info.addresses[0]))
                    if ip in discovered:
                        continue
                    discovered[ip] = {
                        "ip": ip,
                        "hostname": info.server,
                        "mac": None,
                        "os": None,
                        "open_ports": (
                            [{"port": info.port, "protocol": "tcp", "banner": ""}]
                            if info.port else []
                        ),
                    }
                except Exception as exc:
                    logger.debug("mDNS resolution failed for %s: %s", name, exc)
    except Exception as exc:
        logger.warning("mDNS discovery error: %s", exc)

    logger.info("mDNS discovery found %d device(s)", len(discovered))
    return list(discovered.values())


def _mock_scan(target: str) -> list[dict[str, Any]]:
    """Return fake results for dev/test environments without nmap."""
    return [
        {
            "ip": "192.168.1.99",
            "hostname": "unknown-device.lan",
            "mac": "AA:BB:CC:DD:EE:FF",
            "os": None,
            "open_ports": [
                {"port": 80, "protocol": "tcp", "banner": "nginx"},
                {"port": 22, "protocol": "tcp", "banner": "OpenSSH 9.0"},
            ],
        }
    ]


async def run_scan(ranges: list[str], db: AsyncSession, run_id: str) -> None:
    """Execute scan for given CIDR ranges and populate pending_devices."""
    from app.api.routes.status import broadcast_scan_update

    devices_found = 0
    mdns_task: asyncio.Task[list[dict[str, Any]]] | None = None
    mark_run_active(run_id)
    try:
        # Validate all ranges are valid CIDRs before passing anything to nmap
        for r in ranges:
            try:
                ipaddress.ip_network(r, strict=False)
            except ValueError:
                raise ValueError(f"Invalid CIDR range: {r!r}") from None

        # Pre-fetch canvas IPs and hidden IPs once — avoids N+1 queries per host
        canvas_ips_result = await db.execute(select(Node.ip).where(Node.ip.isnot(None)))
        canvas_ips: set[str] = {row[0] for row in canvas_ips_result.fetchall()}

        hidden_ips_result = await db.execute(
            select(PendingDevice.ip).where(PendingDevice.status == "hidden")
        )
        hidden_ips: set[str] = {row[0] for row in hidden_ips_result.fetchall()}

        # Clean up stale pending devices whose IPs are already in the canvas
        if canvas_ips:
            from sqlalchemy import delete as sa_delete
            await db.execute(
                sa_delete(PendingDevice).where(
                    PendingDevice.status == "pending",
                    PendingDevice.ip.in_(canvas_ips),
                )
            )
            await db.commit()

        # Start mDNS discovery in the background while nmap scans run
        mdns_task = asyncio.create_task(_mdns_discover())

        # Track IPs found by nmap so mDNS doesn't duplicate them
        nmap_ips: set[str] = set()

        async def _process_host(host: dict[str, Any], discovery_source: str = "arp") -> None:
            nonlocal devices_found
            ip = host["ip"]

            # Skip canvas nodes and user-hidden devices (sets pre-fetched before loop)
            if ip in canvas_ips:
                logger.debug("Skipping %s — already in canvas", ip)
                return
            if ip in hidden_ips:
                logger.debug("Skipping %s — hidden by user", ip)
                return

            services = fingerprint_ports(host["open_ports"])
            suggested_type = suggest_node_type(host["open_ports"], host.get("mac"))

            existing_result = await db.execute(
                select(PendingDevice).where(
                    PendingDevice.ip == ip,
                    PendingDevice.status == "pending",
                )
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                existing.mac = host.get("mac") or existing.mac
                existing.hostname = host.get("hostname") or existing.hostname
                existing.os = host.get("os") or existing.os
                existing.services = services
                existing.suggested_type = suggested_type
            else:
                db.add(PendingDevice(
                    ip=ip,
                    mac=host.get("mac"),
                    hostname=host.get("hostname"),
                    os=host.get("os"),
                    services=services,
                    suggested_type=suggested_type,
                    status="pending",
                    discovery_source=discovery_source,
                ))
                devices_found += 1

            await db.commit()
            await broadcast_scan_update(run_id=run_id, devices_found=devices_found)

        # nmap scan per CIDR — results stream in progressively
        for cidr in ranges:
            if _is_cancelled(run_id):
                break
            hosts = await _nmap_scan(cidr)
            for host in hosts:
                if _is_cancelled(run_id):
                    break
                nmap_ips.add(host["ip"])
                await _process_host(host)

        # Update ScanRun count once after all CIDR ranges
        run = await db.get(ScanRun, run_id)
        if run:
            run.devices_found = devices_found
            await db.commit()

        # Collect mDNS results — task already has its own 4s internal timeout
        if not _is_cancelled(run_id):
            mdns_hosts = await mdns_task

            for host in mdns_hosts:
                if _is_cancelled(run_id):
                    break
                if host["ip"] in nmap_ips:
                    continue  # already processed with richer nmap data
                await _process_host(host, discovery_source="mdns")
        else:
            mdns_task.cancel()

        # Mark scan as done or cancelled
        run = await db.get(ScanRun, run_id)
        if run:
            run.status = "cancelled" if _is_cancelled(run_id) else "done"
            run.devices_found = devices_found
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()

    except Exception as exc:
        logger.error("Scan failed: %s", exc)
        if mdns_task is not None and not mdns_task.done():
            mdns_task.cancel()
        run = await db.get(ScanRun, run_id)
        if run:
            run.status = "error"
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
    finally:
        with _cancelled_lock:
            _cancelled_runs.discard(run_id)
        mark_run_inactive(run_id)
