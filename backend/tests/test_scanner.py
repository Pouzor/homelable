"""Tests for scanner: two-phase nmap, mDNS discovery, run_scan integration."""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.database import Base
from app.db.models import InventoryDevice, Node, ScanRun

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_run_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def mem_db():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


def _make_scan_run(run_id: str) -> ScanRun:
    return ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])


# ---------------------------------------------------------------------------
# _ping_sweep
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ping_sweep_returns_alive_hosts():
    from app.services.scanner import _ping_sweep

    async def fake_ping(ip: str) -> str | None:
        return ip if ip in {"192.168.1.1", "192.168.1.2"} else None

    with patch("app.services.scanner._ping_sweep", wraps=None):
        pass  # just ensure import is fine

    # Patch asyncio.create_subprocess_exec to simulate ping responses
    responding = {"192.168.1.1", "192.168.1.2"}

    async def mock_subprocess(*args, **kwargs):
        ip = args[-1]
        proc = MagicMock()
        proc.returncode = 0 if ip in responding else 1
        proc.wait = AsyncMock(return_value=proc.returncode)
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess), \
         patch("app.services.scanner._arp_table_hosts", return_value={}), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = await _ping_sweep("192.168.1.0/30")  # .1 .2 only in /30

    assert "192.168.1.1" in result
    assert "192.168.1.2" in result
    for host in result.values():
        assert host["open_ports"] == []


@pytest.mark.asyncio
async def test_ping_sweep_excludes_non_responding():
    from app.services.scanner import _ping_sweep

    async def mock_subprocess(*args, **kwargs):
        ip = args[-1]
        proc = MagicMock()
        proc.returncode = 0 if ip == "192.168.1.1" else 1
        proc.wait = AsyncMock(return_value=proc.returncode)
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess), \
         patch("app.services.scanner._arp_table_hosts", return_value={}), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = await _ping_sweep("192.168.1.0/30")

    assert "192.168.1.1" in result
    assert "192.168.1.2" not in result


@pytest.mark.asyncio
async def test_ping_sweep_supplements_with_arp_cache():
    """Devices that block ICMP but appear in ARP cache should still be discovered."""
    from app.services.scanner import _ping_sweep

    async def mock_subprocess(*args, **kwargs):
        proc = MagicMock()
        proc.returncode = 1  # all pings fail
        proc.wait = AsyncMock(return_value=1)
        return proc

    arp_extra = {
        "192.168.1.10": {"ip": "192.168.1.10", "mac": "aa:bb:cc:dd:ee:10", "hostname": None, "os": None, "open_ports": []},
    }

    with patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess), \
         patch("app.services.scanner._arp_table_hosts", return_value=arp_extra), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = await _ping_sweep("192.168.1.0/24")

    assert "192.168.1.10" in result
    assert result["192.168.1.10"]["mac"] == "aa:bb:cc:dd:ee:10"


@pytest.mark.asyncio
async def test_ping_sweep_enriches_mac_from_arp_cache():
    """Ping-alive hosts with no ARP entry get their MAC from the ARP cache."""
    from app.services.scanner import _ping_sweep

    async def mock_subprocess(*args, **kwargs):
        ip = args[-1]
        proc = MagicMock()
        proc.returncode = 0 if ip == "192.168.1.1" else 1
        proc.wait = AsyncMock(return_value=proc.returncode)
        return proc

    arp_extra = {
        "192.168.1.1": {"ip": "192.168.1.1", "mac": "de:ad:be:ef:00:01", "hostname": None, "os": None, "open_ports": []},
    }

    with patch("asyncio.create_subprocess_exec", side_effect=mock_subprocess), \
         patch("app.services.scanner._arp_table_hosts", return_value=arp_extra), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = await _ping_sweep("192.168.1.0/30")

    assert result["192.168.1.1"]["mac"] == "de:ad:be:ef:00:01"


# ---------------------------------------------------------------------------
# _arp_table_hosts
# ---------------------------------------------------------------------------

def test_arp_table_hosts_parses_proc_net_arp():
    import io  # noqa: PLC0415

    from app.services.scanner import _arp_table_hosts

    arp_content = (
        "IP address       HW type     Flags       HW address            Mask     Device\n"
        "192.168.1.1      0x1         0x2         aa:bb:cc:dd:ee:01     *        eth0\n"
        "192.168.1.50     0x1         0x2         aa:bb:cc:dd:ee:02     *        eth0\n"
        "10.0.0.1         0x1         0x2         aa:bb:cc:dd:ee:03     *        eth0\n"  # outside subnet
        "192.168.1.99     0x1         0x2         00:00:00:00:00:00     *        eth0\n"  # incomplete
    )

    mock_file = MagicMock()
    mock_file.__enter__ = MagicMock(return_value=io.StringIO(arp_content))
    mock_file.__exit__ = MagicMock(return_value=False)

    with patch("builtins.open", return_value=mock_file), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = _arp_table_hosts("192.168.1.0/24")

    assert "192.168.1.1" in result
    assert "192.168.1.50" in result
    assert "10.0.0.1" not in result   # outside target subnet
    assert "192.168.1.99" not in result  # zero MAC skipped


def test_arp_table_hosts_parses_macos_arp_output():
    from app.services.scanner import _arp_table_hosts

    arp_output = (
        "router.lan (192.168.1.1) at aa:bb:cc:dd:ee:01 on en0 ifscope [ethernet]\n"
        "device.lan (192.168.1.20) at aa:bb:cc:dd:ee:02 on en0 ifscope [ethernet]\n"
        "? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]\n"
        "? (10.0.0.1) at aa:bb:cc:dd:ee:04 on en0 ifscope [ethernet]\n"  # outside subnet
    )

    mock_result = MagicMock()
    mock_result.stdout = arp_output

    with patch("builtins.open", side_effect=FileNotFoundError), \
         patch("subprocess.run", return_value=mock_result), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = _arp_table_hosts("192.168.1.0/24")

    assert "192.168.1.1" in result
    assert "192.168.1.20" in result
    assert "192.168.1.99" not in result   # incomplete MAC
    assert "10.0.0.1" not in result       # outside subnet


# ---------------------------------------------------------------------------
# _nmap_scan_single (Phase 2 per-IP worker)
# ---------------------------------------------------------------------------

def test_nmap_scan_single_detects_open_ports():
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.10", "hostname": None, "mac": None, "os": None, "open_ports": []}

    # Build a realistic host entry: protocols → ports → port info
    port_info = {80: {"state": "open", "product": "nginx", "version": "1.24"}}
    mock_host = MagicMock()
    mock_host.all_protocols.return_value = ["tcp"]
    mock_host.__getitem__ = MagicMock(return_value=port_info)
    mock_host.get.return_value = {}

    mock_nm = MagicMock()
    mock_nm.all_hosts.return_value = ["192.168.1.10"]
    mock_nm.__getitem__ = MagicMock(return_value=mock_host)

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm), \
         patch("app.services.scanner._extract_os", return_value=None):
        result = _nmap_scan_single(host)

    assert len(result["open_ports"]) == 1
    assert result["open_ports"][0]["port"] == 80
    assert result["open_ports"][0]["banner"] == "nginx 1.24"


def test_nmap_scan_single_returns_host_unchanged_on_error():
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.20", "hostname": None, "mac": None, "os": None, "open_ports": []}
    mock_nm = MagicMock()
    mock_nm.scan.side_effect = Exception("nmap error")

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm):
        result = _nmap_scan_single(host)

    assert result["ip"] == "192.168.1.20"
    assert result["open_ports"] == []


def test_nmap_scan_single_returns_host_unchanged_when_no_results():
    """Host confirmed alive in Phase 1 but all ports filtered — keep it with empty ports."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.30", "hostname": "shelly1.lan", "mac": "34:94:54:aa:bb:cc", "os": None, "open_ports": []}
    mock_nm = MagicMock()
    mock_nm.all_hosts.return_value = []  # no results

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm):
        result = _nmap_scan_single(host)

    assert result["ip"] == "192.168.1.30"
    assert result["open_ports"] == []
    assert result["mac"] == "34:94:54:aa:bb:cc"  # preserved from Phase 1


# ---------------------------------------------------------------------------
# _nmap_scan_single — two-pass discovery/version split (issue #277)
# ---------------------------------------------------------------------------

def _fake_scanner(ip, port_info, mac=None):
    """Mock nmap.PortScanner whose results contain `ip` with tcp `port_info`."""
    host = MagicMock()
    host.all_protocols.return_value = ["tcp"]
    host.__getitem__ = MagicMock(return_value=port_info)
    host.get.return_value = {"mac": mac} if mac else {}
    nm = MagicMock()
    nm.all_hosts.return_value = [ip]
    nm.__getitem__ = MagicMock(return_value=host)
    return nm


def _empty_scanner():
    nm = MagicMock()
    nm.all_hosts.return_value = []
    return nm


def _failing_scanner(exc=Exception("host timeout")):
    nm = MagicMock()
    nm.scan.side_effect = exc
    return nm


def test_nmap_scan_single_two_pass_merges_banners():
    """Pass A discovers ports; Pass B enriches them with -sV banners."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.10", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.1.10", {22: {"state": "open"}, 8006: {"state": "open"}})
    ver = _fake_scanner("192.168.1.10", {
        22: {"state": "open", "product": "OpenSSH", "version": "9.0"},
        8006: {"state": "open", "product": "", "version": ""},
    })

    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc, ver]), \
         patch("app.services.scanner.os.geteuid", return_value=0), \
         patch("app.services.scanner._extract_os", return_value=None):
        result = _nmap_scan_single(host)

    banners = {p["port"]: p["banner"] for p in result["open_ports"]}
    assert banners == {22: "OpenSSH 9.0", 8006: ""}

    # Pass A: discovery only, no -sV / host-timeout. Pass B: -sV, bounded.
    disc_args = disc.scan.call_args.kwargs["arguments"]
    ver_args = ver.scan.call_args.kwargs["arguments"]
    assert "-sV" not in disc_args and "--host-timeout" not in disc_args
    assert "-sV" in ver_args and "--host-timeout 60s" in ver_args
    assert ver_args.endswith("-p 22,8006")  # version pass scoped to found ports


def test_nmap_scan_single_keeps_ports_when_version_pass_fails():
    """Regression #277: a stalling version pass must not drop discovered ports."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.100.3", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.100.3", {22: {"state": "open"}, 8006: {"state": "open"}})
    ver = _failing_scanner()  # -sV blows past --host-timeout on the TLS port

    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc, ver]), \
         patch("app.services.scanner.os.geteuid", return_value=0):
        result = _nmap_scan_single(host)

    ports = {p["port"] for p in result["open_ports"]}
    assert ports == {22, 8006}  # both survive despite the version failure
    assert all(p["banner"] == "" for p in result["open_ports"])


def test_nmap_scan_single_keeps_ports_when_version_pass_empty():
    """Version pass returns no results for the host — keep the discovered ports."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.11", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.1.11", {443: {"state": "open"}})
    ver = _empty_scanner()

    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc, ver]), \
         patch("app.services.scanner.os.geteuid", return_value=0):
        result = _nmap_scan_single(host)

    assert [p["port"] for p in result["open_ports"]] == [443]
    assert result["open_ports"][0]["banner"] == ""


def test_nmap_scan_single_no_open_ports_skips_version_pass():
    """Host reachable but nothing open — no version pass, empty ports."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.12", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.1.12", {80: {"state": "filtered"}})

    # Only one PortScanner instance may be created (Pass B must be skipped);
    # a second would raise StopIteration from side_effect.
    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc]), \
         patch("app.services.scanner.os.geteuid", return_value=0):
        result = _nmap_scan_single(host)

    assert result["open_ports"] == []


def test_nmap_scan_single_non_root_uses_connect_scan():
    """Without root, both passes use -sT (connect) instead of -sS (SYN)."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.13", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.1.13", {80: {"state": "open"}})
    ver = _fake_scanner("192.168.1.13", {80: {"state": "open", "product": "nginx", "version": "1.24"}})

    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc, ver]), \
         patch("app.services.scanner.os.geteuid", return_value=1000), \
         patch("app.services.scanner._extract_os", return_value=None):
        result = _nmap_scan_single(host)

    assert disc.scan.call_args.kwargs["arguments"].startswith("-sT")
    assert ver.scan.call_args.kwargs["arguments"].startswith("-sT")
    assert result["open_ports"][0]["banner"] == "nginx 1.24"


def test_nmap_scan_single_discovery_is_unbounded_by_default():
    """The range scan's discovery pass keeps its authoritative, untimed run."""
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.14", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.1.14", {})

    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc]), \
         patch("app.services.scanner.os.geteuid", return_value=1000):
        _nmap_scan_single(host)

    args = disc.scan.call_args.kwargs["arguments"]
    assert "--host-timeout" not in args
    assert "--min-rate" not in args


def test_nmap_scan_single_bounded_never_sets_a_host_timeout():
    """A deep slice drops retries — never --host-timeout.

    nmap answers a host timeout with "Skipping host <ip> due to host timeout"
    and throws away every port it had already found, so a ceiling here turns a
    slow scan into one that reports nothing. The time on a dropping host goes to
    the retry pass — measured 2x — so that is what the deep scan gives up.
    """
    from app.services.scanner import _nmap_scan_single

    host = {"ip": "192.168.1.15", "hostname": None, "mac": None, "os": None, "open_ports": []}
    disc = _fake_scanner("192.168.1.15", {})

    with patch("app.services.scanner.nmap.PortScanner", side_effect=[disc]), \
         patch("app.services.scanner.os.geteuid", return_value=1000):
        _nmap_scan_single(host, "1-8192", True)

    args = disc.scan.call_args.kwargs["arguments"]
    assert "-p 1-8192" in args
    assert "--host-timeout" not in args
    assert "--max-retries 0" in args


def test_deep_port_chunks_cover_every_port_once():
    from app.services.scanner import _deep_port_chunks

    chunks = _deep_port_chunks(8192)
    assert chunks[0] == "1-8192"
    assert chunks[-1].endswith("-65535")
    covered = []
    for c in chunks:
        lo, hi = (int(x) for x in c.split("-"))
        covered.extend(range(lo, hi + 1))
    assert covered == list(range(1, 65536))


def test_port_chunks_pack_ranges_and_honour_the_slice_size():
    from app.services.scanner import _port_chunks

    # Small ranges share one call instead of one call each.
    assert _port_chunks("80,443,8000-9000") == ["80,443,8000-9000"]
    # A range wider than the slice is cut at the slice boundary.
    assert _port_chunks("1-100", 40) == ["1-40", "41-80", "81-100"]
    # Overlapping input is merged before slicing, so no port is scanned twice.
    assert _port_chunks("1-100,50-200", 1000) == ["1-200"]
    assert _port_chunks("nonsense") == []


def test_parse_port_spec_rejects_what_nmap_could_not_use():
    from app.services.scanner import _parse_port_spec, _valid_port_spec

    for bad in ["", "  ", "0", "65536", "100-50", "80,", "http", "-80"]:
        assert _parse_port_spec(bad) == [], bad
        assert _valid_port_spec(bad) is False, bad
    assert _valid_port_spec("80,443,8000-9000") is True


# ---------------------------------------------------------------------------
# _nmap_scan
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_nmap_scan_uses_mock_when_nmap_unavailable():
    from app.services.scanner import _nmap_scan

    with patch("app.services.scanner._NMAP_AVAILABLE", False):
        result = await _nmap_scan("192.168.1.0/24")

    assert len(result) == 1
    assert result[0]["ip"] == "192.168.1.99"


@pytest.mark.asyncio
async def test_nmap_scan_raises_on_sweep_error():
    from app.services.scanner import _nmap_scan

    with patch("app.services.scanner._ping_sweep", side_effect=Exception("ping sweep failed")), \
         pytest.raises(RuntimeError, match="ping sweep failed"):
        await _nmap_scan("192.168.1.0/24")


# ---------------------------------------------------------------------------
# Cancellation responsiveness (issue #218)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_nmap_scan_cancelled_before_start_skips_phases():
    """A run already cancelled returns immediately without touching the network."""
    from app.services.scanner import _cancelled_runs, _nmap_scan, request_cancel

    run_id = "cancel-before-start"
    request_cancel(run_id)
    try:
        with patch("app.services.scanner._ping_sweep", new_callable=AsyncMock) as mock_sweep, \
             patch("app.services.scanner._nmap_port_scan", new_callable=AsyncMock) as mock_port:
            result = await _nmap_scan("192.168.1.0/24", run_id=run_id)
        assert result == []
        mock_sweep.assert_not_called()
        mock_port.assert_not_called()
    finally:
        _cancelled_runs.discard(run_id)


@pytest.mark.asyncio
async def test_ping_sweep_cancelled_mid_sweep_returns_empty():
    """Cancelling during Phase 1 bails before Phase 2 — no alive hosts returned."""
    from app.services.scanner import _cancelled_runs, _ping_sweep, request_cancel

    run_id = "cancel-during-sweep"

    async def _fake_subprocess(*args, **kwargs):
        proc = AsyncMock()
        proc.wait = AsyncMock(return_value=1)
        proc.returncode = 1
        return proc

    request_cancel(run_id)
    try:
        with patch("app.services.scanner.asyncio.create_subprocess_exec", new=_fake_subprocess), \
             patch("app.services.scanner._arp_table_hosts", return_value={}):
            result = await _ping_sweep("192.168.1.0/30", run_id=run_id)
        assert result == {}
    finally:
        _cancelled_runs.discard(run_id)


@pytest.mark.asyncio
async def test_nmap_port_scan_skips_queued_hosts_when_cancelled():
    """Once cancelled, queued hosts return unscanned instead of invoking nmap."""
    from app.services.scanner import _cancelled_runs, _nmap_port_scan, request_cancel

    run_id = "cancel-port-scan"
    alive = {
        "192.168.1.10": {
            "ip": "192.168.1.10", "mac": None, "hostname": None,
            "os": None, "open_ports": [],
        },
    }
    request_cancel(run_id)
    try:
        with patch("app.services.scanner._nmap_scan_single") as mock_single:
            result = await _nmap_port_scan(alive, run_id=run_id)
        mock_single.assert_not_called()
        assert result[0]["ip"] == "192.168.1.10"
        assert result[0]["open_ports"] == []
    finally:
        _cancelled_runs.discard(run_id)


# ---------------------------------------------------------------------------
# _mdns_discover
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mdns_discover_returns_empty_when_zeroconf_unavailable():
    from app.services.scanner import _mdns_discover

    with patch("app.services.scanner._ZEROCONF_AVAILABLE", False):
        result = await _mdns_discover()

    assert result == []


@pytest.mark.asyncio
async def test_mdns_discover_returns_devices():
    from app.services.scanner import _mdns_discover

    mock_info = MagicMock()
    mock_info.addresses = [b"\xc0\xa8\x01\x50"]  # 192.168.1.80
    mock_info.server = "shelly1.local."
    mock_info.port = 80
    mock_info.async_request = AsyncMock(return_value=True)

    mock_browser = AsyncMock()
    mock_browser.async_cancel = AsyncMock()

    # Simulate a service being found during the sleep
    captured_handler: list = []

    def fake_browser(zc, types, handlers):
        captured_handler.extend(handlers)
        return mock_browser

    from zeroconf import ServiceStateChange

    async def fake_sleep(t):
        # Fire the handler as if a device was discovered
        for h in captured_handler:
            h(None, "_shelly._tcp.local.", "Shelly1._shelly._tcp.local.", ServiceStateChange.Added)

    mock_azc = AsyncMock()
    mock_azc.__aenter__ = AsyncMock(return_value=mock_azc)
    mock_azc.__aexit__ = AsyncMock(return_value=None)
    mock_azc.zeroconf = MagicMock()

    with patch("app.services.scanner._ZEROCONF_AVAILABLE", True), \
         patch("app.services.scanner.AsyncZeroconf", return_value=mock_azc), \
         patch("app.services.scanner.AsyncServiceBrowser", side_effect=fake_browser), \
         patch("app.services.scanner.AsyncServiceInfo", return_value=mock_info), \
         patch("asyncio.sleep", side_effect=fake_sleep):
        result = await _mdns_discover(timeout=0.01)

    assert len(result) == 1
    assert result[0]["ip"] == "192.168.1.80"
    assert result[0]["hostname"] == "shelly1.local."


# ---------------------------------------------------------------------------
# _nmap_port_scan (Phase 2 concurrency)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_nmap_port_scan_returns_empty_when_no_alive_hosts():
    from app.services.scanner import _nmap_port_scan

    result = await _nmap_port_scan({})
    assert result == []


@pytest.mark.asyncio
async def test_nmap_port_scan_tolerates_single_host_exception():
    """A single per-host failure should not abort the entire Phase 2 gather."""
    from app.services.scanner import _nmap_port_scan

    hosts = {
        "192.168.1.1": {"ip": "192.168.1.1", "hostname": None, "mac": None, "os": None, "open_ports": []},
        "192.168.1.2": {"ip": "192.168.1.2", "hostname": None, "mac": None, "os": None, "open_ports": []},
    }

    call_count = 0

    def _flaky_scan(host_dict, port_spec=None):
        nonlocal call_count
        call_count += 1
        if host_dict["ip"] == "192.168.1.1":
            raise RuntimeError("simulated nmap crash")
        return host_dict

    with patch("app.services.scanner._nmap_scan_single", side_effect=_flaky_scan), \
         patch("app.services.scanner._NMAP_AVAILABLE", True):
        result = await _nmap_port_scan(hosts)

    assert call_count == 2
    # The crashing host is dropped; the healthy one survives
    assert len(result) == 1
    assert result[0]["ip"] == "192.168.1.2"


# ---------------------------------------------------------------------------
# run_scan integration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_scan_adds_nmap_devices_as_pending(mem_db):
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.5", "hostname": "device.lan", "mac": None, "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        result = await session.execute(sa_select(InventoryDevice))
        devices = result.scalars().all()

    assert any(d.ip == "192.168.1.5" for d in devices)


@pytest.mark.asyncio
async def test_run_scan_stamps_last_scan_on_matching_node_by_ip(mem_db):
    """A scan that sees a known device stamps last_scan on its inventory row.

    The stamp is a fact about the device, so it lands once on the row every
    canvas draws — not once per node.
    """
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        device = InventoryDevice(id="d1", ip="192.168.1.5", status="approved")
        session.add(device)
        await session.flush()
        session.add(Node(id="n1", type="server", label="NAS", device_id="d1"))
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.5", "hostname": "nas.lan", "mac": None, "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")

    assert device is not None
    assert device.last_scan is not None


@pytest.mark.asyncio
async def test_run_scan_stamps_last_scan_on_matching_node_by_mac(mem_db):
    """A device with no IP but a matching MAC still gets last_scan stamped."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        device = InventoryDevice(id="d2", mac="aa:bb:cc:dd:ee:ff", status="approved")
        session.add(device)
        await session.flush()
        session.add(Node(id="n2", type="iot", label="Sensor", device_id="d2"))
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.9", "hostname": None, "mac": "AA:BB:CC:DD:EE:FF", "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d2")

    assert device is not None
    assert device.last_scan is not None


@pytest.mark.asyncio
async def test_run_scan_leaves_last_scan_untouched_on_unmatched_node(mem_db):
    """A device whose IP/MAC the scan never saw keeps last_scan = None."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        device = InventoryDevice(id="d3", ip="10.0.0.99", status="approved")
        session.add(device)
        await session.flush()
        session.add(Node(id="n3", type="server", label="Other", device_id="d3"))
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.5", "hostname": None, "mac": None, "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d3")

    assert device is not None
    assert device.last_scan is None


@pytest.mark.asyncio
async def test_run_scan_mdns_only_device_added(mem_db):
    """Devices found only by mDNS (not nmap) should appear in device_inventory."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    mdns_hosts = [{"ip": "192.168.1.80", "hostname": "shelly1.local.", "mac": None, "os": None, "open_ports": [{"port": 80, "protocol": "tcp", "banner": ""}]}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=[]), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=mdns_hosts), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        result = await session.execute(sa_select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.80"))
        device = result.scalar_one_or_none()

    assert device is not None
    assert device.status == "pending"
    assert device.discovery_source == "mdns"


@pytest.mark.asyncio
async def test_run_scan_merges_proxmox_row_by_mac(mem_db):
    """A scan reconciles a prior Proxmox-imported row by MAC: fills the IP,
    unions the source, keeps the vm type, and does not duplicate."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        # Previously imported from Proxmox: no IP, known NIC MAC, vm type.
        session.add(InventoryDevice(
            id="pve-row", ieee_address="pve-pve1-101", ip=None,
            mac="bc:24:11:aa:bb:cc", suggested_type="vm", status="pending",
            discovery_source="proxmox", discovery_sources=["proxmox"],
        ))
        await session.commit()

    # Scan sees the same box (same MAC, different casing) with a live IP.
    nmap_hosts = [{"ip": "192.168.1.50", "hostname": "web.lan",
                   "mac": "BC:24:11:AA:BB:CC", "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        rows = (await session.execute(sa_select(InventoryDevice))).scalars().all()

    assert len(rows) == 1                                  # merged, not duplicated
    row = rows[0]
    assert row.ip == "192.168.1.50"                        # scan filled the IP
    assert row.mac == "bc:24:11:aa:bb:cc"                  # normalized
    assert row.suggested_type == "vm"                      # kept proxmox type
    assert set(row.discovery_sources) == {"proxmox", "arp"}  # both filters


@pytest.mark.asyncio
async def test_run_scan_keeps_services_the_fingerprint_cannot_see(mem_db):
    """A re-scan unions its fingerprint onto the row — it never replaces it.

    Since 3.3.0 the row is the only copy of a device's services and every canvas
    drawing it reads that list, so overwriting it with what nmap happened to
    match would delete hand-added services everywhere at once (#347).
    """
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        session.add(InventoryDevice(
            id="row-1", ip="192.168.1.60", status="approved",
            discovery_source="arp", discovery_sources=["arp"],
            services=[
                {"port": 9000, "protocol": "tcp", "service_name": "Portainer", "path": "/#!/home"},
                {"port": 22, "protocol": "tcp", "service_name": "ssh"},
            ],
        ))
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.60", "hostname": "docker.lan", "mac": None, "os": None,
                   "open_ports": [{"port": 22, "protocol": "tcp", "banner": "OpenSSH 9.2"}]}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        row = await session.get(InventoryDevice, "row-1")

    by_port = {s["port"]: s for s in row.services}
    assert by_port[9000]["service_name"] == "Portainer"  # hand-added, untouched
    assert by_port[9000]["path"] == "/#!/home"
    assert 22 in by_port                                 # what the scan saw is still there
    assert row.status == "approved"


@pytest.mark.asyncio
async def test_run_scan_mdns_skipped_if_already_in_nmap(mem_db):
    """If nmap and mDNS both find the same IP, it should not be double-counted."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    shared_host = {"ip": "192.168.1.10", "hostname": "device.lan", "mac": None, "os": None, "open_ports": []}

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=[shared_host]), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[shared_host]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        result = await session.execute(sa_select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.10"))
        devices = result.scalars().all()

    assert len(devices) == 1  # not duplicated


@pytest.mark.asyncio
async def test_run_scan_keeps_canvas_nodes(mem_db):
    """Hosts already on a canvas are NOT suppressed — they stay in the inventory
    (badged "In N canvas" via correlation), so a re-scan still records them."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        drawn = InventoryDevice(id="d-pve", ip="192.168.1.100", status="pending")
        session.add(drawn)
        await session.flush()
        session.add(Node(
            id=str(uuid.uuid4()), label="PVE", type="proxmox", device_id="d-pve",
        ))
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.100", "hostname": "pve.lan", "mac": None, "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        result = await session.execute(sa_select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.100"))
        device = result.scalar_one_or_none()
        assert device is not None
        assert device.status == "pending"


@pytest.mark.asyncio
async def test_run_scan_skips_hidden_devices(mem_db):
    """Hosts hidden by the user must not re-appear in pending."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        hidden = InventoryDevice(ip="192.168.1.55", status="hidden")
        session.add(hidden)
        await session.commit()

    nmap_hosts = [{"ip": "192.168.1.55", "hostname": None, "mac": None, "os": None, "open_ports": []}]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=nmap_hosts), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        result = await session.execute(
            sa_select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.55", InventoryDevice.status == "pending")
        )
        assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_run_scan_cancelled_marks_status_cancelled(mem_db):
    """Cancelling a running scan sets the ScanRun status to 'cancelled'."""
    from app.services.scanner import request_cancel, run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    request_cancel(run_id)

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", return_value=[]), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    async with mem_db() as session:
        run = await session.get(ScanRun, run_id)
        assert run is not None
        assert run.status == "cancelled"


# ---------------------------------------------------------------------------
# Deep scan: port-range plumbing + HTTP probe
# ---------------------------------------------------------------------------

def test_valid_port_range():
    from app.services.scanner import _valid_port_range

    assert _valid_port_range("8080")
    assert _valid_port_range("8000-8100")
    assert not _valid_port_range("8100-8000")   # reversed
    assert not _valid_port_range("0")           # below 1
    assert not _valid_port_range("70000")       # above 65535
    assert not _valid_port_range("abc")
    assert not _valid_port_range("80,443")      # not a single range


def test_build_port_spec_default_when_empty():
    from app.services.scanner import _EXTRA_PORTS, _build_port_spec

    assert _build_port_spec([]) == _EXTRA_PORTS
    assert _build_port_spec(None) == _EXTRA_PORTS


def test_build_port_spec_appends_valid_ranges():
    from app.services.scanner import _EXTRA_PORTS, _build_port_spec

    spec = _build_port_spec(["8000-8100", "9000"])
    assert spec == _EXTRA_PORTS + ",8000-8100,9000"


def test_build_port_spec_drops_invalid_ranges():
    from app.services.scanner import _EXTRA_PORTS, _build_port_spec

    # invalid entries silently dropped; only valid kept
    assert _build_port_spec(["bad", "70000"]) == _EXTRA_PORTS
    assert _build_port_spec(["bad", "9000"]) == _EXTRA_PORTS + ",9000"


@pytest.mark.asyncio
async def test_run_scan_deep_scan_passes_port_spec_to_nmap(mem_db):
    from app.services.scanner import DeepScanOptions, run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    captured = {}

    async def fake_nmap(target, port_spec, run_id=None):
        captured["port_spec"] = port_spec
        return []

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", new=fake_nmap), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(
                ["192.168.1.0/24"], session, run_id,
                deep_scan=DeepScanOptions(http_ranges=["8000-8100"]),
            )

    assert "8000-8100" in captured["port_spec"]


@pytest.mark.asyncio
async def test_run_scan_probe_enriches_services(mem_db):
    """With probe enabled, a custom-port service is identified via HTTP signals."""
    from app.services.scanner import DeepScanOptions, run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    nmap_hosts = [{
        "ip": "192.168.1.50", "hostname": None, "mac": None, "os": None,
        "open_ports": [{"port": 8096, "protocol": "tcp", "banner": ""}],
    }]
    jellyfin_sig = [{
        "port": 8096, "protocol": "tcp", "banner_regex": None, "http_regex": "Jellyfin",
        "service_name": "Jellyfin", "icon": "🎬", "category": "media", "suggested_node_type": "server",
    }]

    async def fake_probe(ip, ports, verify_tls=False, concurrency=50):
        return [{**p, "http_signals": {"title": "Jellyfin", "headers": {}}} for p in ports]

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", new=AsyncMock(return_value=nmap_hosts)), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.services.scanner.probe_open_ports", new=fake_probe), \
             patch("app.services.fingerprint._load", return_value=jellyfin_sig), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(
                ["192.168.1.0/24"], session, run_id,
                deep_scan=DeepScanOptions(http_probe_enabled=True),
            )

    async with mem_db() as session:
        result = await session.execute(sa_select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.50"))
        device = result.scalar_one_or_none()

    assert device is not None
    assert any(s["service_name"] == "Jellyfin" for s in device.services)


@pytest.mark.asyncio
async def test_run_scan_no_probe_when_disabled(mem_db):
    """Probe must not be called on a standard (non-deep) scan."""
    from app.services.scanner import run_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(_make_scan_run(run_id))
        await session.commit()

    nmap_hosts = [{
        "ip": "192.168.1.51", "hostname": None, "mac": None, "os": None,
        "open_ports": [{"port": 8096, "protocol": "tcp", "banner": ""}],
    }]
    probe = AsyncMock()

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan", new=AsyncMock(return_value=nmap_hosts)), \
             patch("app.services.scanner._mdns_discover", new_callable=AsyncMock, return_value=[]), \
             patch("app.services.scanner.probe_open_ports", new=probe), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_scan(["192.168.1.0/24"], session, run_id)

    probe.assert_not_called()


# ---------------------------------------------------------------------------
# run_device_scan — per-device deep rescan (issue #350)
# ---------------------------------------------------------------------------

def test_build_port_spec_full_covers_every_tcp_port():
    from app.services.scanner import _build_port_spec

    # full wins over the curated list *and* over user ranges — the deep rescan
    # is only worth its minutes if it really scans everything.
    assert _build_port_spec(None, full=True) == "1-65535"
    assert _build_port_spec(["8000-8100"], full=True) == "1-65535"


@pytest.mark.asyncio
async def test_run_device_scan_refreshes_services_and_marks_run_done(mem_db):
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="approved", services=[]))
        await session.commit()

    seen_specs = []

    def _scanned(host_dict, port_spec, bounded=False):
        seen_specs.append(port_spec)
        # A full-range rescan is always bounded, or it never ends.
        assert bounded is True
        # Only the slice holding 22 reports it — the union is the caller's job.
        if port_spec == "1-8192":
            host_dict["open_ports"] = [{"port": 22, "protocol": "tcp", "banner": "OpenSSH 9.2"}]
        return host_dict

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")
        run = await session.get(ScanRun, run_id)

    assert device is not None and run is not None
    assert run.status == "done"
    assert device.last_scan is not None
    assert any(s.get("port") == 22 for s in device.services)
    # A rescan refreshes an existing row; it never spawns a second one.
    assert device.status == "approved"


@pytest.mark.asyncio
async def test_run_device_scan_keeps_hand_added_services(mem_db):
    """Regression: the rescan unions, it does not replace.

    Services the user typed in by hand are the only copy that exists — every
    canvas drawing the device reads this list.
    """
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    hand_added = {"port": 9000, "protocol": "tcp", "service_name": "My App"}
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="pending", services=[hand_added]))
        await session.commit()

    def _scanned(host_dict, port_spec, bounded=False):
        host_dict["open_ports"] = [{"port": 22, "protocol": "tcp", "banner": "OpenSSH 9.2"}]
        return host_dict

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")

    assert device is not None
    ports = {s.get("port") for s in device.services}
    assert ports == {22, 9000}


@pytest.mark.asyncio
async def test_scan_keeps_the_icon_the_user_picked_for_a_service(mem_db):
    """Regression: every scan used to repaint hand-picked service icons.

    The fingerprint guesses an icon from the port; the user's choice is the
    only one that means anything, so a rescan leaves it where it is.
    """
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    curated = {
        "port": 22,
        "protocol": "tcp",
        "service_name": "ssh",
        "icon": "brand:openssh",
        "category": "remote",
    }
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="approved", services=[curated]))
        await session.commit()

    def _scanned(host_dict, port_spec, bounded=False):
        host_dict["open_ports"] = [{"port": 22, "protocol": "tcp", "banner": "OpenSSH 9.2"}]
        return host_dict

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")

    assert device is not None
    matches = [s for s in device.services if s.get("port") == 22]
    # Merged in place — the name key is case-insensitive, so "SSH" from the
    # signature does not append a second row next to the user's "ssh".
    assert len(matches) == 1
    ssh = matches[0]
    assert ssh["icon"] == "brand:openssh"
    assert ssh["category"] == "remote"


@pytest.mark.asyncio
async def test_run_device_scan_keeps_the_device_own_discovery_source(mem_db):
    """A rescan re-observes a device; it does not discover it on the network.

    Tagging every rescanned device "arp" told a Proxmox guest or a hand-added
    host that the network scanner found it, and it then answered that filter.
    """
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(
            id="d1",
            ip="192.168.1.9",
            status="approved",
            services=[],
            discovery_source="proxmox",
            discovery_sources=["proxmox"],
        ))
        await session.commit()

    def _scanned(host_dict, port_spec, bounded=False):
        host_dict["open_ports"] = [{"port": 8006, "protocol": "tcp", "banner": ""}]
        return host_dict

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id, ports="8006")

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")

    assert device is not None
    assert device.discovery_sources == ["proxmox"]
    assert device.discovery_source == "proxmox"


@pytest.mark.asyncio
async def test_run_device_scan_marks_run_error_when_device_has_no_ip(mem_db):
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["/32"]))
        session.add(InventoryDevice(id="d1", ip=None, status="pending", services=[]))
        await session.commit()

    async with mem_db() as session:
        with patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        run = await session.get(ScanRun, run_id)

    assert run is not None
    assert run.status == "error"
    assert run.error is not None


@pytest.mark.asyncio
async def test_run_device_scan_skips_nmap_when_cancelled(mem_db):
    from app.services.scanner import _cancelled_runs, request_cancel, run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="pending", services=[]))
        await session.commit()

    request_cancel(run_id)
    single = MagicMock()

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", new=single), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        run = await session.get(ScanRun, run_id)

    single.assert_not_called()
    assert run is not None
    assert run.status == "cancelled"
    # The run cleans up its cancellation flag on the way out.
    assert run_id not in _cancelled_runs


@pytest.mark.asyncio
async def test_run_device_scan_unions_ports_across_slices(mem_db):
    """Every slice contributes; a slow one costs only its own ports."""
    from app.services.scanner import _deep_port_chunks, run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="pending", services=[]))
        await session.commit()

    def _scanned(host_dict, port_spec, bounded=False):
        lo = int(port_spec.split("-")[0])
        if lo == 1:
            host_dict["open_ports"] = [{"port": 22, "protocol": "tcp", "banner": ""}]
        elif lo == 8193:
            host_dict["open_ports"] = [{"port": 8096, "protocol": "tcp", "banner": ""}]
        return host_dict

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")
        run = await session.get(ScanRun, run_id)

    assert device is not None and run is not None
    assert {s.get("port") for s in device.services} == {22, 8096}
    # A complete sweep carries no advisory.
    assert run.error is None
    assert len(_deep_port_chunks()) == 8


@pytest.mark.asyncio
async def test_run_device_scan_honours_a_requested_port_range(mem_db):
    """A user-chosen range replaces the full sweep — and skips retry-free timing.

    A handful of ports is cheap enough to scan properly; the bounded flags only
    pay off over thousands of them.
    """
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="pending", services=[]))
        await session.commit()

    calls = []

    def _scanned(host_dict, port_spec, bounded=False):
        calls.append((port_spec, bounded))
        host_dict["open_ports"] = [{"port": 8096, "protocol": "tcp", "banner": ""}]
        return host_dict

    async with mem_db() as session:
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            await run_device_scan("d1", session, run_id, ports="8000-9000")

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")
        run = await session.get(ScanRun, run_id)

    assert calls == [("8000-9000", False)]
    assert device is not None and run is not None
    assert {s.get("port") for s in device.services} == {8096}
    assert run.status == "done"
    assert run.error is None


@pytest.mark.asyncio
async def test_run_device_scan_keeps_what_it_found_when_the_budget_runs_out(mem_db):
    """A spent budget stops the sweep — it never discards the ports found.

    The earlier --host-timeout did exactly that (nmap skips the host wholesale),
    which is why a deep scan could come back empty on a slow host.
    """
    from app.services.scanner import run_device_scan

    run_id = _make_run_id()
    async with mem_db() as session:
        session.add(ScanRun(id=run_id, status="running", kind="device", ranges=["192.168.1.9/32"]))
        session.add(InventoryDevice(id="d1", ip="192.168.1.9", status="pending", services=[]))
        await session.commit()

    calls = []

    def _scanned(host_dict, port_spec, bounded=False):
        calls.append(port_spec)
        host_dict["open_ports"] = [{"port": 22, "protocol": "tcp", "banner": ""}]
        return host_dict

    async with mem_db() as session:
        # Budget already spent when the first slice returns.
        with patch("app.services.scanner._nmap_scan_single", side_effect=_scanned), \
             patch("app.services.scanner.settings") as mock_settings, \
             patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock):
            mock_settings.scanner_deep_host_timeout = -1
            await run_device_scan("d1", session, run_id)

    async with mem_db() as session:
        device = await session.get(InventoryDevice, "d1")
        run = await session.get(ScanRun, run_id)

    assert calls == ["1-8192"]
    assert device is not None and run is not None
    assert {s.get("port") for s in device.services} == {22}
    assert run.status == "done"
    # Partial coverage is reported, never passed off as a full sweep.
    assert run.error is not None
    assert "1/8" in run.error
