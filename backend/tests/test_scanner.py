"""Tests for scanner: two-phase nmap, mDNS discovery, run_scan integration."""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.database import Base
from app.db.models import PendingDevice, ScanRun

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_run_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def mem_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


def _make_scan_run(run_id: str) -> ScanRun:
    return ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])


# ---------------------------------------------------------------------------
# _nmap_arp_sweep
# ---------------------------------------------------------------------------

def test_nmap_arp_sweep_returns_alive_hosts():
    from app.services.scanner import _nmap_arp_sweep

    mock_nm = MagicMock()
    mock_nm.all_hosts.return_value = ["192.168.1.1", "192.168.1.2"]
    mock_nm.__getitem__ = lambda self, host: MagicMock(
        state=lambda: "up",
        get=lambda key, default=None: {"mac": "aa:bb:cc:dd:ee:ff"} if key == "addresses" else default,
    )

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = _nmap_arp_sweep("192.168.1.0/24")

    assert set(result.keys()) == {"192.168.1.1", "192.168.1.2"}
    for host in result.values():
        assert host["open_ports"] == []  # empty until phase 2


def test_nmap_arp_sweep_skips_down_hosts():
    from app.services.scanner import _nmap_arp_sweep

    states = {"192.168.1.1": "up", "192.168.1.2": "down"}

    mock_nm = MagicMock()
    mock_nm.all_hosts.return_value = list(states.keys())

    def getitem(host):
        m = MagicMock()
        m.state.return_value = states[host]
        m.get.return_value = {}
        return m

    mock_nm.__getitem__ = lambda self, host: getitem(host)

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm), \
         patch("app.services.scanner._resolve_hostname", return_value=None):
        result = _nmap_arp_sweep("192.168.1.0/24")

    assert "192.168.1.1" in result
    assert "192.168.1.2" not in result


# ---------------------------------------------------------------------------
# _nmap_port_scan
# ---------------------------------------------------------------------------

def test_nmap_port_scan_merges_ports():
    from app.services.scanner import _nmap_port_scan

    alive = {
        "192.168.1.10": {"ip": "192.168.1.10", "hostname": None, "mac": None, "os": None, "open_ports": []},
    }

    mock_nm = MagicMock()
    mock_nm.all_hosts.return_value = ["192.168.1.10"]
    mock_nm.__getitem__ = lambda self, host: MagicMock(
        all_protocols=lambda: ["tcp"],
        **{"__getitem__": lambda self2, proto: {
            80: {"state": "open", "product": "nginx", "version": "1.24"},
        }},
        get=lambda key, default=None: default,
    )

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm), \
         patch("app.services.scanner._extract_os", return_value=None):
        result = _nmap_port_scan(alive)

    assert len(result) == 1
    assert result[0]["open_ports"][0]["port"] == 80


def test_nmap_port_scan_returns_arp_only_on_failure():
    from app.services.scanner import _nmap_port_scan

    alive = {
        "192.168.1.20": {"ip": "192.168.1.20", "hostname": None, "mac": None, "os": None, "open_ports": []},
    }

    mock_nm = MagicMock()
    mock_nm.scan.side_effect = Exception("nmap error")

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm):
        result = _nmap_port_scan(alive)

    # Should return the ARP-found host even though port scan failed
    assert len(result) == 1
    assert result[0]["ip"] == "192.168.1.20"
    assert result[0]["open_ports"] == []


def test_nmap_port_scan_includes_hosts_with_no_open_ports():
    """IoT devices found by ARP but with no open TCP ports must still be returned."""
    from app.services.scanner import _nmap_port_scan

    alive = {
        "192.168.1.30": {"ip": "192.168.1.30", "hostname": "shelly1.lan", "mac": "34:94:54:aa:bb:cc", "os": None, "open_ports": []},
        "192.168.1.31": {"ip": "192.168.1.31", "hostname": None, "mac": None, "os": None, "open_ports": []},
    }

    # Port scan returns only 192.168.1.31 (e.g., .30 filtered all ports)
    mock_nm = MagicMock()
    mock_nm.all_hosts.return_value = ["192.168.1.31"]
    mock_nm.__getitem__ = lambda self, host: MagicMock(
        all_protocols=lambda: [],
        get=lambda key, default=None: default,
    )

    with patch("app.services.scanner.nmap.PortScanner", return_value=mock_nm), \
         patch("app.services.scanner._extract_os", return_value=None):
        result = _nmap_port_scan(alive)

    ips = {h["ip"] for h in result}
    assert "192.168.1.30" in ips, "ARP-found device with no open ports must still be returned"
    assert "192.168.1.31" in ips


# ---------------------------------------------------------------------------
# _nmap_scan (integration of both phases)
# ---------------------------------------------------------------------------

def test_nmap_scan_uses_mock_when_nmap_unavailable():
    from app.services.scanner import _nmap_scan

    with patch("app.services.scanner._NMAP_AVAILABLE", False):
        result = _nmap_scan("192.168.1.0/24")

    assert len(result) == 1
    assert result[0]["ip"] == "192.168.1.99"


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
        result = await session.execute(
            __import__("sqlalchemy", fromlist=["select"]).select(PendingDevice)
        )
        devices = result.scalars().all()

    assert any(d.ip == "192.168.1.5" for d in devices)


@pytest.mark.asyncio
async def test_run_scan_mdns_only_device_added(mem_db):
    """Devices found only by mDNS (not nmap) should appear in pending_devices."""
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
        from sqlalchemy import select as sa_select
        result = await session.execute(sa_select(PendingDevice).where(PendingDevice.ip == "192.168.1.80"))
        device = result.scalar_one_or_none()

    assert device is not None
    assert device.status == "pending"


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
        from sqlalchemy import select as sa_select
        result = await session.execute(sa_select(PendingDevice).where(PendingDevice.ip == "192.168.1.10"))
        devices = result.scalars().all()

    assert len(devices) == 1  # not duplicated
