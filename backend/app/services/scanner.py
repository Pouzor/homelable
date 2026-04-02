"""Network scanner: ARP sweep + nmap service detection + mDNS discovery."""
import asyncio
import logging
import socket
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Node, PendingDevice, ScanRun
from app.services.fingerprint import fingerprint_ports, suggest_node_type

logger = logging.getLogger(__name__)

# Run IDs that have been requested to cancel
_cancelled_runs: set[str] = set()

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
    _cancelled_runs.add(run_id)


def _is_cancelled(run_id: str) -> bool:
    return run_id in _cancelled_runs


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


def _nmap_arp_sweep(target: str) -> dict[str, dict[str, Any]]:
    """
    Phase 1: ARP ping sweep — finds ALL alive hosts regardless of open ports.
    Returns {ip: host_dict} for every host that responds.
    """
    nm = nmap.PortScanner()
    nm.scan(hosts=target, arguments="-sn -PR -PA80,443 --host-timeout 10s")
    alive: dict[str, dict[str, Any]] = {}
    for host in nm.all_hosts():
        if nm[host].state() == "up":
            alive[host] = {
                "ip": host,
                "hostname": _resolve_hostname(host),
                "mac": nm[host].get("addresses", {}).get("mac"),
                "os": None,
                "open_ports": [],
            }
    return alive


def _nmap_port_scan(alive: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Phase 2: Service detection on the alive host set from Phase 1.
    Mutates alive in-place with open_ports/os; returns all hosts including
    those with zero open ports (IoT devices often have none).
    """
    if not alive:
        return []
    nm = nmap.PortScanner()
    try:
        nm.scan(
            hosts=" ".join(alive.keys()),
            arguments=f"-sV --open -T4 --host-timeout 30s -p {_EXTRA_PORTS}",
        )
    except Exception as exc:
        logger.warning("Port scan failed, returning ARP-only results: %s", exc)
        return list(alive.values())

    for host in nm.all_hosts():
        if host not in alive:
            continue
        open_ports = []
        for proto in nm[host].all_protocols():
            for port, info in nm[host][proto].items():
                if info["state"] == "open":
                    open_ports.append({
                        "port": port,
                        "protocol": proto,
                        "banner": (
                            info.get("product", "") + " " + info.get("version", "")
                        ).strip(),
                    })
        alive[host]["open_ports"] = open_ports
        if not alive[host]["mac"]:
            alive[host]["mac"] = nm[host].get("addresses", {}).get("mac")
        alive[host]["os"] = _extract_os(nm, host)

    return list(alive.values())


def _nmap_scan(target: str) -> list[dict[str, Any]]:
    """
    Full two-phase scan for a CIDR range.
    Phase 1: ARP sweep to find alive hosts (catches IoT with no open ports).
    Phase 2: Service detection on alive hosts only.
    """
    if not _NMAP_AVAILABLE:
        return _mock_scan(target)
    try:
        alive = _nmap_arp_sweep(target)
    except Exception as exc:
        logger.error("nmap ARP sweep failed: %s", exc)
        raise RuntimeError(str(exc)) from exc
    return _nmap_port_scan(alive)


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
    try:
        # Clean up stale pending devices whose IPs are already in the canvas
        canvas_ips_result = await db.execute(select(Node.ip).where(Node.ip.isnot(None)))
        canvas_ips: set[str] = {row[0] for row in canvas_ips_result.fetchall()}
        if canvas_ips:
            stale_result = await db.execute(
                select(PendingDevice).where(
                    PendingDevice.status == "pending",
                    PendingDevice.ip.in_(canvas_ips),
                )
            )
            for stale in stale_result.scalars().all():
                await db.delete(stale)
            await db.commit()

        # Start mDNS discovery in the background while nmap scans run
        mdns_task: asyncio.Task[list[dict[str, Any]]] = asyncio.create_task(
            _mdns_discover()
        )

        # Track IPs found by nmap so mDNS doesn't duplicate them
        nmap_ips: set[str] = set()

        async def _process_host(host: dict[str, Any]) -> None:
            nonlocal devices_found
            ip = host["ip"]

            # Skip canvas nodes and user-hidden devices
            canvas_result = await db.execute(select(Node).where(Node.ip == ip))
            if canvas_result.scalar_one_or_none() is not None:
                logger.debug("Skipping %s — already in canvas", ip)
                return
            hidden_result = await db.execute(
                select(PendingDevice).where(
                    PendingDevice.ip == ip,
                    PendingDevice.status == "hidden",
                )
            )
            if hidden_result.scalar_one_or_none() is not None:
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
                ))
                devices_found += 1

            await db.commit()

            run = await db.get(ScanRun, run_id)
            if run:
                run.devices_found = devices_found
                await db.commit()

            await broadcast_scan_update(run_id=run_id, devices_found=devices_found)

        # nmap scan per CIDR — results stream in progressively
        for cidr in ranges:
            if _is_cancelled(run_id):
                break
            hosts = await asyncio.to_thread(_nmap_scan, cidr)
            for host in hosts:
                if _is_cancelled(run_id):
                    break
                nmap_ips.add(host["ip"])
                await _process_host(host)

        # Collect mDNS results; add devices not already found by nmap
        if not _is_cancelled(run_id):
            try:
                mdns_hosts = await asyncio.wait_for(mdns_task, timeout=1.0)
            except asyncio.TimeoutError:
                mdns_task.cancel()
                mdns_hosts = []

            for host in mdns_hosts:
                if _is_cancelled(run_id):
                    break
                if host["ip"] in nmap_ips:
                    continue  # already processed with richer nmap data
                await _process_host(host)
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
        run = await db.get(ScanRun, run_id)
        if run:
            run.status = "error"
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
    finally:
        _cancelled_runs.discard(run_id)
