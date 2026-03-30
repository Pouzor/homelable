"""Tests for scan routes: trigger, pending devices, approve/hide/ignore."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Node, PendingDevice, ScanRun
from app.services.scanner import run_scan


@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def pending_device(db_session):
    import uuid
    device = PendingDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.100",
        mac="aa:bb:cc:dd:ee:ff",
        hostname="my-server",
        os="Linux",
        services=[{"port": 22, "name": "ssh"}],
        suggested_type="server",
        status="pending",
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


# --- Trigger scan ---

@pytest.mark.asyncio
async def test_trigger_scan_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/scan/trigger")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_trigger_scan_creates_run(client: AsyncClient, headers):
    with (
        patch("app.api.routes.scan._background_scan", new_callable=AsyncMock),
        patch("app.api.routes.scan.settings") as mock_settings,
    ):
        mock_settings.scanner_ranges = ["192.168.1.0/24"]
        res = await client.post("/api/v1/scan/trigger", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "running"
    assert data["ranges"] == ["192.168.1.0/24"]
    assert "id" in data


# --- Pending devices ---

@pytest.mark.asyncio
async def test_list_pending_empty(client: AsyncClient, headers):
    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_list_pending_returns_device(client: AsyncClient, headers, pending_device):
    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["ip"] == "192.168.1.100"
    assert data[0]["hostname"] == "my-server"


# --- Approve device ---

@pytest.mark.asyncio
async def test_approve_device(client: AsyncClient, headers, pending_device):
    node_payload = {
        "label": "My Server",
        "type": "server",
        "ip": "192.168.1.100",
        "hostname": "my-server",
        "status": "unknown",
        "services": [],
    }
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json=node_payload,
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] is True
    assert "node_id" in data

    # Device should no longer appear in pending list
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending_res.json() == []


@pytest.mark.asyncio
async def test_approve_nonexistent_device(client: AsyncClient, headers):
    node_payload = {
        "label": "Ghost",
        "type": "generic",
        "ip": "10.0.0.1",
        "status": "unknown",
        "services": [],
    }
    res = await client.post(
        "/api/v1/scan/pending/nonexistent-id/approve",
        json=node_payload,
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["approved"] is False


# --- Hide device ---

@pytest.mark.asyncio
async def test_hide_device(client: AsyncClient, headers, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/hide", headers=headers)
    assert res.status_code == 200
    assert res.json()["hidden"] is True

    # Should no longer appear in pending
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending_res.json() == []

    # Should appear in hidden
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert len(hidden_res.json()) == 1


# --- Ignore device ---

@pytest.mark.asyncio
async def test_ignore_device(client: AsyncClient, headers, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/ignore", headers=headers)
    assert res.status_code == 200
    assert res.json()["ignored"] is True

    # Device should be gone from both pending and hidden
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending_res.json() == []
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert hidden_res.json() == []


# --- Scan runs ---

@pytest.mark.asyncio
async def test_list_runs_empty(client: AsyncClient, headers):
    res = await client.get("/api/v1/scan/runs", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


# --- run_scan: re-scan updates existing pending devices ---

MOCK_HOST = {
    "ip": "192.168.1.50",
    "mac": "aa:bb:cc:dd:ee:ff",
    "hostname": "myhost.lan",
    "os": "Linux",
    "open_ports": [{"port": 8096, "protocol": "tcp", "banner": "Jellyfin"}],
}


@pytest.mark.asyncio
async def test_run_scan_creates_new_pending_device(db_session: AsyncSession):
    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[MOCK_HOST]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    result = await db_session.execute(
        select(PendingDevice).where(PendingDevice.ip == "192.168.1.50")
    )
    device = result.scalar_one_or_none()
    assert device is not None
    assert device.hostname == "myhost.lan"
    assert any(s["port"] == 8096 for s in device.services)
    assert device.suggested_type == "server"


@pytest.mark.asyncio
async def test_run_scan_purges_stale_pending_for_canvas_nodes(db_session: AsyncSession):
    """Pending devices that were already in canvas before scan starts must be removed."""
    node = Node(
        id=str(uuid.uuid4()),
        label="Existing Server",
        type="server",
        ip="192.168.1.50",
        status="online",
        services=[],
        pos_x=0.0,
        pos_y=0.0,
    )
    stale = PendingDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.50",
        mac=None,
        hostname=None,
        os=None,
        services=[],
        suggested_type="generic",
        status="pending",
    )
    db_session.add(node)
    db_session.add(stale)
    await db_session.commit()

    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    result = await db_session.execute(
        select(PendingDevice).where(PendingDevice.ip == "192.168.1.50")
    )
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_run_scan_skips_ip_already_in_canvas(db_session: AsyncSession):
    """Devices whose IP already exists as a canvas Node must not appear in pending."""
    node = Node(
        id=str(uuid.uuid4()),
        label="Existing Server",
        type="server",
        ip="192.168.1.50",
        status="online",
        services=[],
        pos_x=0.0,
        pos_y=0.0,
    )
    db_session.add(node)
    await db_session.commit()

    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[MOCK_HOST]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    result = await db_session.execute(
        select(PendingDevice).where(PendingDevice.ip == "192.168.1.50")
    )
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_run_scan_skips_hidden_device(db_session: AsyncSession):
    """Devices previously hidden by the user must not re-appear in pending on re-scan."""
    hidden = PendingDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.50",
        mac=None,
        hostname=None,
        os=None,
        services=[],
        suggested_type="generic",
        status="hidden",
    )
    db_session.add(hidden)
    await db_session.commit()

    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[MOCK_HOST]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    result = await db_session.execute(
        select(PendingDevice).where(
            PendingDevice.ip == "192.168.1.50",
            PendingDevice.status == "pending",
        )
    )
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_run_scan_updates_existing_pending_device(db_session: AsyncSession):
    """Re-scanning the same IP updates services instead of creating a duplicate."""
    # Pre-existing pending device with no services
    existing = PendingDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.50",
        mac=None,
        hostname=None,
        os=None,
        services=[],
        suggested_type="generic",
        status="pending",
    )
    db_session.add(existing)
    await db_session.commit()

    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[MOCK_HOST]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    # Should still be only one device
    result = await db_session.execute(
        select(PendingDevice).where(PendingDevice.ip == "192.168.1.50")
    )
    devices = list(result.scalars().all())
    assert len(devices) == 1
    device = devices[0]
    # Services and hostname should be updated
    assert device.hostname == "myhost.lan"
    assert any(s["port"] == 8096 for s in device.services)
