"""Network scanner: ARP sweep + nmap service detection + mDNS discovery."""
import asyncio
import ipaddress
import logging
import os
import re
import socket
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import InventoryDevice, ScanRun
from app.services.discovery_sources import add_source
from app.services.fingerprint import fingerprint_ports, suggest_node_type
from app.services.http_probe import probe_open_ports
from app.services.inventory_sync import merge_services
from app.services.mac_utils import normalize_mac

logger = logging.getLogger(__name__)

# Run IDs that have been requested to cancel (thread-safe via lock)
_cancelled_runs: set[str] = set()
_cancelled_lock = threading.Lock()

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

# nmap -p accepts "N" or "N-M"; user ranges are validated against this.
_PORT_RANGE_RE = re.compile(r"^\d{1,5}(-\d{1,5})?$")


@dataclass
class DeepScanOptions:
    """Per-scan deep-scan settings (None/empty → standard scan, today's behaviour)."""

    http_ranges: list[str] = field(default_factory=list)
    http_probe_enabled: bool = False
    verify_tls: bool = False


def _valid_port_range(spec: str) -> bool:
    if not _PORT_RANGE_RE.match(spec):
        return False
    parts = [int(p) for p in spec.split("-")]
    if any(p < 1 or p > 65535 for p in parts):
        return False
    return len(parts) == 1 or parts[0] <= parts[1]


# Every TCP port. Used by the per-device deep rescan, which trades minutes of
# nmap time for a service list that no curated port list can promise.
_FULL_PORTS = "1-65535"

# The deep rescan runs the full range in slices, one nmap call each, unioning
# what they find. A slice that runs long costs only its own ports — where a
# single 65535-port call that overruns costs everything (see _nmap_scan_single).
# It also gives the run somewhere to notice a stop request, and somewhere to
# give up when the budget is spent, without abandoning the ports already found.
_DEEP_CHUNK_SIZE = 8192


def _parse_port_spec(spec: str) -> list[tuple[int, int]]:
    """Parse an nmap ``-p`` spec into sorted, merged ``(start, end)`` ranges.

    Accepts what the user can type in the deep-scan dialog: ``80``,
    ``8000-9000``, or a comma list of both. Returns ``[]`` for anything invalid
    — the caller turns that into a 422 rather than handing nmap a bad ``-p``.
    """
    ranges: list[tuple[int, int]] = []
    for token in (t.strip() for t in spec.split(",")):
        if not token or not _valid_port_range(token):
            return []
        parts = [int(p) for p in token.split("-")]
        ranges.append((parts[0], parts[-1]))
    if not ranges:
        return []
    ranges.sort()
    merged = [ranges[0]]
    for start, end in ranges[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 1:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _valid_port_spec(spec: str) -> bool:
    """True when ``spec`` is a usable comma list of ports/ranges."""
    return bool(_parse_port_spec(spec))


def _port_chunks(spec: str, size: int = _DEEP_CHUNK_SIZE) -> list[str]:
    """Slice a port spec into nmap ``-p`` specs of at most ``size`` ports each.

    Ranges are packed, not scanned one call per range: ``80,443`` is one chunk,
    not two, while ``1-65535`` becomes eight. Each chunk is a scan boundary —
    where a stop request lands and where the time budget is checked.
    """
    chunks: list[str] = []
    current: list[str] = []
    budget = size
    for start, end in _parse_port_spec(spec):
        cursor = start
        while cursor <= end:
            take = min(budget, end - cursor + 1)
            stop = cursor + take - 1
            current.append(f"{cursor}-{stop}" if stop > cursor else str(cursor))
            budget -= take
            cursor = stop + 1
            if budget == 0:
                chunks.append(",".join(current))
                current = []
                budget = size
    if current:
        chunks.append(",".join(current))
    return chunks


def _deep_port_chunks(size: int = _DEEP_CHUNK_SIZE) -> list[str]:
    """Slice the whole TCP range into nmap ``-p`` specs of ``size`` ports."""
    return _port_chunks(_FULL_PORTS, size)


def _build_port_spec(http_ranges: list[str] | None, full: bool = False) -> str:
    """Combine the default port list with validated user ranges for nmap -p.

    ``full`` overrides everything with the whole TCP range — the deep rescan of
    a single device, where completeness beats speed.
    """
    if full:
        return _FULL_PORTS
    if not http_ranges:
        return _EXTRA_PORTS
    extra = [r.strip() for r in http_ranges if _valid_port_range(r.strip())]
    if not extra:
        return _EXTRA_PORTS
    return _EXTRA_PORTS + "," + ",".join(extra)

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


async def _ping_sweep(target: str, run_id: str | None = None) -> dict[str, dict[str, Any]]:
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

    # Cancelled during the sweep — bail before the (potentially long) Phase 2
    # port scan. Returning empty makes _nmap_scan skip nmap entirely.
    if run_id is not None and _is_cancelled(run_id):
        logger.info("[Phase 1] %s — scan cancelled, skipping hostname/ARP enrichment", target)
        return {}

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


def _nmap_scan_single(
    host_dict: dict[str, Any], port_spec: str = _EXTRA_PORTS, bounded: bool = False
) -> dict[str, Any]:
    """
    Phase 2 — single-IP port scan with service detection.
    Runs in a thread (blocking). Returns the host dict enriched with open_ports.

    Two decoupled nmap passes (issue #277):
      Pass A — port discovery only (``--open``, no ``-sV``). Fast and reliable;
               its open ports are authoritative and are never discarded.
      Pass B — version detection (``-sV``) scoped to the ports Pass A found,
               bounded by ``--host-timeout``. Best-effort: if it times out or
               fails (e.g. a TLS port stalls plaintext probes), the Pass A ports
               are kept with empty banners instead of the whole host being lost.
    """
    ip = host_dict["ip"]
    logger.info("[Phase 2] Scanning %s ...", ip)

    if not _NMAP_AVAILABLE:
        logger.warning("[Phase 2] nmap not available, skipping %s", ip)
        return host_dict

    # -sS (SYN) needs root; -sT (connect) works without it. nmap auto-selects
    # -sT without root but being explicit avoids edge cases.
    scan_type = "-sS" if os.geteuid() == 0 else "-sT"

    # --- Pass A: port discovery (no -sV) ---
    # Default timing for the range scan: its ports are authoritative and a
    # curated port list is fast either way.
    #
    # ``bounded`` is the deep rescan's timing, and carries NO --host-timeout on
    # purpose: nmap answers a host timeout with "Skipping host <ip> due to host
    # timeout" and discards *every* port it had already found, so a ceiling here
    # turns a slow scan into one that reports nothing. The caller bounds total
    # runtime by slicing the range instead.
    #
    # What costs the time is a host that drops packets: 8188 of 8192 ports
    # filtered, each waiting out its probe. Measured against such a host, the
    # retry pass is the whole cost — 8192 ports took 329s at --max-retries 1
    # and 164s at 0, finding the same ports. Capping the RTT changed nothing
    # (329s), so it is not set. Dropping retries risks missing a port that
    # loses its one probe; that trade belongs to the deep scan alone, and the
    # curated-port range scan keeps nmap's default retries.
    discovery_args = f"{scan_type} --open -T4 -Pn -p {port_spec}"
    if bounded:
        discovery_args += " --max-retries 0 --min-rate 2000"
    logger.debug("[Phase 2] %s discovery args: %s", ip, discovery_args)
    nm_disc = nmap.PortScanner()
    try:
        nm_disc.scan(hosts=ip, arguments=discovery_args)
    except Exception as exc:
        logger.warning("[Phase 2] nmap discovery FAILED for %s (%s: %s) — skipping port scan",
                       ip, type(exc).__name__, exc)
        return host_dict

    if ip not in nm_disc.all_hosts():
        logger.info("[Phase 2] %s — no open ports found (all closed/filtered or nmap had no results)", ip)
        return host_dict

    open_ports = []
    for proto in nm_disc[ip].all_protocols():
        for port, info in nm_disc[ip][proto].items():
            if info["state"] == "open":
                open_ports.append({"port": port, "protocol": proto, "banner": ""})

    if not open_ports:
        logger.info("[Phase 2] %s — 0 open ports detected", ip)
        host_dict["open_ports"] = []
        if not host_dict["mac"]:
            host_dict["mac"] = nm_disc[ip].get("addresses", {}).get("mac")
        return host_dict

    # --- Pass B: version detection on the discovered ports (best-effort) ---
    port_list = ",".join(str(p["port"]) for p in open_ports)
    timeout = settings.scanner_version_host_timeout
    version_args = f"{scan_type} -sV -T4 -Pn --host-timeout {timeout}s -p {port_list}"
    logger.debug("[Phase 2] %s version args: %s", ip, version_args)
    nm_ver = nmap.PortScanner()
    banners: dict[tuple[str, int], str] = {}
    ver_os = None
    ver_mac = None
    try:
        nm_ver.scan(hosts=ip, arguments=version_args)
        if ip in nm_ver.all_hosts():
            for proto in nm_ver[ip].all_protocols():
                for port, info in nm_ver[ip][proto].items():
                    banner = (info.get("product", "") + " " + info.get("version", "")).strip()
                    if banner:
                        banners[(proto, port)] = banner
            ver_os = _extract_os(nm_ver, ip)
            ver_mac = nm_ver[ip].get("addresses", {}).get("mac")
        else:
            logger.info("[Phase 2] %s — version detection returned no results, keeping %d port(s) without banners",
                        ip, len(open_ports))
    except Exception as exc:
        logger.info("[Phase 2] %s — version detection failed (%s: %s), keeping %d port(s) without banners",
                    ip, type(exc).__name__, exc, len(open_ports))

    for p in open_ports:
        p["banner"] = banners.get((p["protocol"], p["port"]), "")

    port_summary = ", ".join(
        f"{p['port']}/{p['protocol']} ({p['banner'] or 'unknown'})" for p in open_ports
    )
    logger.info("[Phase 2] %s — %d open port(s): %s", ip, len(open_ports), port_summary)

    host_dict["open_ports"] = open_ports
    if not host_dict["mac"]:
        host_dict["mac"] = ver_mac or nm_disc[ip].get("addresses", {}).get("mac")
    host_dict["os"] = ver_os
    return host_dict


async def _nmap_port_scan(
    alive: dict[str, dict[str, Any]], port_spec: str = _EXTRA_PORTS,
    run_id: str | None = None,
) -> list[dict[str, Any]]:
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
            # Once cancelled, skip the expensive nmap call for every host still
            # queued behind the semaphore — return it unscanned so the gather
            # unwinds fast instead of blocking the stop for minutes.
            if run_id is not None and _is_cancelled(run_id):
                return host_dict
            return await asyncio.to_thread(_nmap_scan_single, host_dict, port_spec)

    raw = await asyncio.gather(*[_scan_with_sem(h) for h in alive.values()], return_exceptions=True)
    results = []
    for item in raw:
        if isinstance(item, BaseException):
            logger.warning("[Phase 2] Unexpected error in gather: %s", item)
        else:
            results.append(item)
    logger.info("[Phase 2] Completed — %d/%d host(s) scanned", len(results), len(alive))
    return results


async def _nmap_scan(
    target: str, port_spec: str = _EXTRA_PORTS, run_id: str | None = None
) -> list[dict[str, Any]]:
    """
    Two-phase scan for a CIDR range.
    Phase 1: Concurrent ping sweep to find alive hosts (fast, no false positives).
    Phase 2: Per-IP nmap port scan with service detection (bounded concurrency, 10 at a time).

    ``run_id`` lets each phase poll for cancellation so a stop request takes
    effect mid-range instead of only at CIDR/host boundaries in run_scan.
    """
    logger.info("[Scan] Starting scan for %s — nmap available: %s", target, _NMAP_AVAILABLE)
    if run_id is not None and _is_cancelled(run_id):
        logger.info("[Scan] %s — cancelled before start, skipping", target)
        return []
    if not _NMAP_AVAILABLE:
        logger.warning("[Scan] nmap not available — returning mock data")
        return _mock_scan(target)
    try:
        alive = await _ping_sweep(target, run_id=run_id)
        logger.info("[Phase 1] Found %d alive host(s) in %s: %s",
                    len(alive), target, ", ".join(sorted(alive.keys())))
    except Exception as exc:
        logger.error("Phase 1 ping sweep failed: %s", exc)
        raise RuntimeError(str(exc)) from exc
    return await _nmap_port_scan(alive, port_spec, run_id=run_id)


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


async def _dedupe_pending_by_ip(db: AsyncSession) -> int:
    """Collapse duplicate non-hidden inventory rows that share an IP into one.

    Keeps an ``approved`` row when present (it carries canvas-link semantics),
    otherwise the oldest row, and deletes the rest. Returns the number deleted.
    """
    rows = (await db.execute(
        select(InventoryDevice)
        .where(InventoryDevice.status != "hidden", InventoryDevice.ip.isnot(None))
        .order_by(InventoryDevice.discovered_at)
    )).scalars().all()

    by_ip: dict[str, list[InventoryDevice]] = {}
    for row in rows:
        if row.ip is None:  # guarded by the query, but keeps the type checker happy
            continue
        by_ip.setdefault(row.ip, []).append(row)

    deleted = 0
    for group in by_ip.values():
        if len(group) < 2:
            continue
        keep = next((r for r in group if r.status == "approved"), group[0])
        for dup in group:
            if dup is not keep:
                await db.delete(dup)
                deleted += 1
    if deleted:
        await db.commit()
    return deleted


async def process_host(
    db: AsyncSession,
    host: dict[str, Any],
    *,
    hidden_ips: set[str],
    deep_scan: DeepScanOptions,
    discovery_source: str = "arp",
) -> str:
    """Fold one scanned host into ``device_inventory`` and commit.

    Shared by the range scan and the single-device deep rescan, so both apply
    the same matching, merge and de-duplication rules.

    Returns ``"skipped"`` (hidden by the user), ``"created"`` (a new inventory
    row) or ``"updated"`` (an existing row refreshed).
    """
    ip = host["ip"]

    # Skip only user-hidden devices. On-canvas devices are kept so they
    # surface in the inventory with a canvas-presence badge.
    if ip in hidden_ips:
        logger.debug("Skipping %s — hidden by user", ip)
        return "skipped"

    open_ports = host["open_ports"]
    # Deep-scan HTTP probe: enrich open ports with title/header signals so
    # fingerprint can confirm services on custom ports. No-op when disabled
    # or when the host has no open ports (e.g. mDNS-only discovery).
    if deep_scan.http_probe_enabled and open_ports:
        open_ports = await probe_open_ports(
            ip, open_ports, verify_tls=deep_scan.verify_tls
        )

    norm_mac = normalize_mac(host.get("mac"))
    services = fingerprint_ports(open_ports)
    suggested_type = suggest_node_type(open_ports, norm_mac)

    # One inventory row per device. Match by IP OR MAC across pending AND
    # approved so a re-scan refreshes the existing row instead of spawning
    # a duplicate — and so a device previously imported from Proxmox (which
    # may have no IP but a known NIC MAC) reconciles with this scan instead
    # of doubling up. Hidden rows are already skipped above.
    match_cond = [InventoryDevice.ip == ip]
    if norm_mac:
        match_cond.append(InventoryDevice.mac == norm_mac)
    existing_rows = (await db.execute(
        select(InventoryDevice)
        .where(or_(*match_cond), InventoryDevice.status != "hidden")
        .order_by(InventoryDevice.discovered_at)
    )).scalars().all()

    if existing_rows:
        # Prefer an approved row (it owns the canvas link semantics),
        # otherwise the oldest. Collapse any leftover duplicates created
        # by earlier scans.
        keep = next((r for r in existing_rows if r.status == "approved"), existing_rows[0])
        for dup in existing_rows:
            if dup is not keep:
                await db.delete(dup)
        keep.ip = keep.ip or ip  # fill an IP a Proxmox import lacked
        keep.mac = norm_mac or keep.mac
        keep.hostname = host.get("hostname") or keep.hostname
        keep.os = host.get("os") or keep.os
        # Union, never replace. Since 3.3.0 the row is the only copy of
        # a device's services — every canvas drawing it reads this list
        # — so overwriting it with the fingerprint would delete services
        # the user added by hand, on every canvas at once. What a scan
        # finds is added; what it no longer sees stays. A service the
        # user does not want on a canvas is hidden by that node's view,
        # which is where "I deleted this" belongs.
        keep.services = merge_services(keep.services, services)
        # Don't downgrade a Proxmox-typed guest (vm/lxc) to the generic
        # scan guess; the importer knows the true type.
        if not (keep.ieee_address or "").startswith("pve-"):
            keep.suggested_type = suggested_type
        # Merged row carries both sources (e.g. ["proxmox", "arp"]).
        keep.discovery_sources = add_source(keep.discovery_sources, discovery_source)
        # status preserved — an approved device stays approved.
        # Stamp last_scan on the row so every canvas drawing the device
        # shows when the scanner last observed it. The row is the one
        # place that fact belongs; a node only draws it.
        keep.last_scan = datetime.now(timezone.utc)
        outcome = "updated"
    else:
        db.add(InventoryDevice(
            ip=ip,
            mac=norm_mac,
            hostname=host.get("hostname"),
            os=host.get("os"),
            services=services,
            suggested_type=suggested_type,
            status="pending",
            discovery_source=discovery_source,
            discovery_sources=[discovery_source],
            last_scan=datetime.now(timezone.utc),
        ))
        outcome = "created"

    await db.commit()
    return outcome


async def run_scan(
    ranges: list[str],
    db: AsyncSession,
    run_id: str,
    deep_scan: DeepScanOptions | None = None,
) -> None:
    """Execute scan for given CIDR ranges and populate device_inventory."""
    from app.api.routes.status import broadcast_scan_update

    deep_scan = deep_scan or DeepScanOptions()
    port_spec = _build_port_spec(deep_scan.http_ranges)

    devices_found = 0
    mdns_task: asyncio.Task[list[dict[str, Any]]] | None = None
    try:
        # Validate all ranges are valid CIDRs before passing anything to nmap
        for r in ranges:
            try:
                ipaddress.ip_network(r, strict=False)
            except ValueError:
                raise ValueError(f"Invalid CIDR range: {r!r}") from None

        # Pre-fetch hidden IPs once — avoids N+1 queries per host.
        # Devices already on a canvas are intentionally NOT suppressed: they stay
        # in the inventory and are badged "In N canvas" via per-request correlation.
        hidden_ips_result = await db.execute(
            select(InventoryDevice.ip).where(InventoryDevice.status == "hidden")
        )
        hidden_ips: set[str] = {row[0] for row in hidden_ips_result.fetchall()}

        # Collapse any pre-existing duplicate inventory rows (same IP, non-hidden)
        # left over from older scans, so the device shows up exactly once even if
        # it isn't re-discovered this run (e.g. now offline).
        await _dedupe_pending_by_ip(db)

        # Start mDNS discovery in the background while nmap scans run
        mdns_task = asyncio.create_task(_mdns_discover())

        # Track IPs found by nmap so mDNS doesn't duplicate them
        nmap_ips: set[str] = set()

        async def _process_host(host: dict[str, Any], discovery_source: str = "arp") -> None:
            nonlocal devices_found
            outcome = await process_host(
                db,
                host,
                hidden_ips=hidden_ips,
                deep_scan=deep_scan,
                discovery_source=discovery_source,
            )
            if outcome == "skipped":
                return
            if outcome == "created":
                devices_found += 1
            await broadcast_scan_update(run_id=run_id, devices_found=devices_found)

        # nmap scan per CIDR — results stream in progressively
        for cidr in ranges:
            if _is_cancelled(run_id):
                break
            hosts = await _nmap_scan(cidr, port_spec, run_id=run_id)
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


async def run_device_scan(
    device_id: str,
    db: AsyncSession,
    run_id: str,
    deep_scan: DeepScanOptions | None = None,
    full_ports: bool = True,
    ports: str | None = None,
) -> None:
    """Deep-rescan one known device and refresh its inventory row.

    No ping sweep and no mDNS: the device is already known, so the IP goes
    straight to the phase-2 port scan (``-Pn``). ``full_ports`` scans all 65535
    TCP ports, which is the point of the feature — a device added before the
    scanner knew a service, or listening on a port no curated list covers.
    Minutes, not seconds; the run is cancellable like any other.

    ``ports`` narrows that to a user-chosen spec (``80,443``, ``1-1024``) and
    wins over ``full_ports`` — the dialog prefills the full range, so a caller
    that passes something else means it.
    """
    from app.api.routes.status import broadcast_scan_update

    deep_scan = deep_scan or DeepScanOptions()
    port_spec = (
        ports if ports else _build_port_spec(deep_scan.http_ranges, full=full_ports)
    )

    try:
        device = await db.get(InventoryDevice, device_id)
        if device is None or not device.ip:
            raise ValueError("Device has no IP to scan")

        host: dict[str, Any] = {
            "ip": device.ip,
            "mac": device.mac,
            "hostname": device.hostname,
            "os": device.os,
            "open_ports": [],
        }

        # The full range goes out in slices so a stop request lands within one
        # slice instead of at the end, and so a spent budget keeps the ports
        # found so far. A curated port list is one call, as before.
        if ports:
            chunks = _port_chunks(ports)
        elif full_ports:
            chunks = _deep_port_chunks()
        else:
            chunks = [port_spec]
        # Retry-free timing pays for itself over thousands of ports on a host
        # that drops packets; over a handful it only costs accuracy.
        total_ports = sum(end - start + 1 for start, end in _parse_port_spec(port_spec))
        bounded = total_ports > _DEEP_CHUNK_SIZE
        deadline = time.monotonic() + settings.scanner_deep_host_timeout
        found: list[dict[str, Any]] = []
        seen: set[tuple[str, int]] = set()
        skipped = 0

        for i, chunk in enumerate(chunks):
            if _is_cancelled(run_id):
                skipped = len(chunks) - i
                break
            if i and time.monotonic() > deadline:
                skipped = len(chunks) - i
                logger.warning(
                    "[Deep scan] %s — budget of %ds spent, %d port range(s) not scanned",
                    host["ip"], settings.scanner_deep_host_timeout, skipped,
                )
                break
            # bounded: retry-free timing, for a host that drops packets.
            scanned = await asyncio.to_thread(
                _nmap_scan_single, dict(host), chunk, bounded
            )
            for port in scanned.get("open_ports") or []:
                key = (port["protocol"], port["port"])
                if key not in seen:
                    seen.add(key)
                    found.append(port)
            host["mac"] = host["mac"] or scanned.get("mac")
            host["os"] = scanned.get("os") or host["os"]

        host["open_ports"] = found
        # A partial sweep still says what it saw; the row unions it in.
        partial = (
            f"Scanned {len(chunks) - skipped}/{len(chunks)} port ranges "
            f"({len(found)} open) — the rest was not reached"
            if skipped
            else None
        )

        devices_found = 0
        if not _is_cancelled(run_id):
            # The row is being rescanned on the user's request, so it is never
            # "hidden" from itself — the route rejects hidden devices upfront.
            outcome = await process_host(
                db, host, hidden_ips=set(), deep_scan=deep_scan, discovery_source="arp"
            )
            if outcome == "created":
                devices_found = 1
            await broadcast_scan_update(run_id=run_id, devices_found=devices_found)

        run = await db.get(ScanRun, run_id)
        if run:
            run.status = "cancelled" if _is_cancelled(run_id) else "done"
            run.devices_found = devices_found
            # Not a failure: a done run carrying an advisory, the way a Proxmox
            # import reports what it could not see. Never let a partial sweep
            # read as a complete one.
            if partial and run.status == "done":
                run.error = partial
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()

    except Exception as exc:
        logger.error("Device scan failed: %s", exc)
        await db.rollback()
        run = await db.get(ScanRun, run_id)
        if run:
            run.status = "error"
            run.error = str(exc)
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
    finally:
        with _cancelled_lock:
            _cancelled_runs.discard(run_id)
