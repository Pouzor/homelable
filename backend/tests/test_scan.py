"""Tests for scan routes: trigger, pending devices, approve/hide/ignore, stop."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Node, PendingDevice, ScanRun
from app.services.scanner import _cancelled_runs, request_cancel, run_scan


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
    assert res.status_code == 404


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


# --- Restore hidden device ---

@pytest.mark.asyncio
async def test_restore_device(client: AsyncClient, headers, pending_device):
    # Hide first
    await client.post(f"/api/v1/scan/pending/{pending_device.id}/hide", headers=headers)

    # Restore
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/restore", headers=headers)
    assert res.status_code == 200
    assert res.json()["restored"] is True

    # Now back in pending, gone from hidden
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert len(pending_res.json()) == 1
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert hidden_res.json() == []


@pytest.mark.asyncio
async def test_restore_device_rejects_non_hidden(client: AsyncClient, headers, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/restore", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_bulk_restore_devices(client: AsyncClient, headers, pending_device):
    # Hide
    await client.post(f"/api/v1/scan/pending/{pending_device.id}/hide", headers=headers)

    res = await client.post(
        "/api/v1/scan/pending/bulk-restore",
        headers=headers,
        json={"device_ids": [pending_device.id]},
    )
    assert res.status_code == 200
    assert res.json()["restored"] == 1
    assert res.json()["skipped"] == 0

    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert len(pending_res.json()) == 1


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


# --- Stop scan ---

@pytest.mark.asyncio
async def test_stop_scan_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/scan/fake-id/stop")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_stop_scan_not_found(client: AsyncClient, headers):
    import uuid as _uuid
    res = await client.post(f"/api/v1/scan/{_uuid.uuid4()}/stop", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_stop_scan_not_running(client: AsyncClient, headers, db_session: AsyncSession):
    run = ScanRun(id=str(uuid.uuid4()), status="done", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    res = await client.post(f"/api/v1/scan/{run.id}/stop", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_stop_scan_success(client: AsyncClient, headers, db_session: AsyncSession):
    run = ScanRun(id=str(uuid.uuid4()), status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    res = await client.post(f"/api/v1/scan/{run.id}/stop", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"stopping": True}
    # run_id added to cancel set
    assert run.id in _cancelled_runs
    # cleanup for other tests
    _cancelled_runs.discard(run.id)


# --- run_scan cancellation ---

@pytest.mark.asyncio
async def test_run_scan_cancelled_marks_status(db_session: AsyncSession):
    """When cancel is requested before the scan starts, status becomes 'cancelled'."""
    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    request_cancel(run_id)

    with (
        patch("app.services.scanner._nmap_scan", return_value=[MOCK_HOST]) as mock_nmap,
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)
        # nmap should not have been called — cancelled before first range
        mock_nmap.assert_not_called()

    await db_session.refresh(run)
    assert run.status == "cancelled"
    assert run.finished_at is not None


@pytest.mark.asyncio
async def test_run_scan_cancelled_mid_scan_skips_remaining_cidrs(db_session: AsyncSession):
    """Cancel flag set after first CIDR is started prevents processing of the second CIDR."""
    run_id = str(uuid.uuid4())
    run = ScanRun(id=run_id, status="running", ranges=["10.0.0.0/24", "10.0.1.0/24"])
    db_session.add(run)
    await db_session.commit()

    call_count = 0

    def nmap_side_effect(target: str):
        nonlocal call_count
        call_count += 1
        # Signal cancellation after the first CIDR scan completes
        if call_count == 1:
            request_cancel(run_id)
        return []

    with (
        patch("app.services.scanner._nmap_scan", side_effect=nmap_side_effect),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["10.0.0.0/24", "10.0.1.0/24"], db_session, run_id)

    assert call_count == 1  # second CIDR was skipped
    await db_session.refresh(run)
    assert run.status == "cancelled"


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


# --- Bulk approve ---

@pytest.fixture
async def two_pending_devices(db_session):
    devices = []
    for i in range(2):
        d = PendingDevice(
            id=str(uuid.uuid4()),
            ip=f"192.168.1.{10 + i}",
            mac=None,
            hostname=f"host-{i}",
            os=None,
            services=[],
            suggested_type="generic",
            status="pending",
        )
        db_session.add(d)
        devices.append(d)
    await db_session.commit()
    for d in devices:
        await db_session.refresh(d)
    return devices


@pytest.mark.asyncio
async def test_bulk_approve_approves_devices(client: AsyncClient, headers, two_pending_devices):
    ids = [d.id for d in two_pending_devices]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] == 2
    assert len(data["node_ids"]) == 2
    assert all(nid is not None for nid in data["node_ids"]), "node_ids must be non-null UUIDs"
    assert len(data["device_ids"]) == 2
    assert data["skipped"] == 0
    # Pending list should now be empty
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending_res.json() == []


@pytest.mark.asyncio
async def test_bulk_approve_sets_default_check_method(client: AsyncClient, headers, two_pending_devices, db_session):
    """Approved devices with an IP must default to ping; otherwise scheduler skips them."""
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    ids = [d.id for d in two_pending_devices]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    nodes = (await db_session.execute(select(NodeModel))).scalars().all()
    for n in nodes:
        if n.ip:
            assert n.check_method == "ping", f"node {n.id} created without check_method"


@pytest.mark.asyncio
async def test_approve_device_sets_default_check_method(client: AsyncClient, headers, pending_device, db_session):
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "h", "type": "generic", "ip": "192.168.1.10", "status": "unknown", "services": []},
        headers=headers,
    )
    assert res.status_code == 200
    node = (await db_session.execute(select(NodeModel))).scalars().first()
    assert node is not None
    assert node.check_method == "ping"


@pytest.mark.asyncio
async def test_bulk_approve_skips_already_approved(client: AsyncClient, headers, two_pending_devices):
    ids = [d.id for d in two_pending_devices]
    # Approve first device individually first
    await client.post(
        f"/api/v1/scan/pending/{ids[0]}/approve",
        json={"label": "h", "type": "generic", "ip": "192.168.1.10", "status": "unknown", "services": []},
        headers=headers,
    )
    # Bulk approve both — first one is already approved (not pending), should be skipped
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] == 1
    assert data["skipped"] == 1


@pytest.mark.asyncio
async def test_bulk_approve_requires_auth(client: AsyncClient, two_pending_devices):
    ids = [d.id for d in two_pending_devices]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids})
    assert res.status_code == 401


# --- Bulk hide ---

@pytest.mark.asyncio
async def test_bulk_hide_hides_devices(client: AsyncClient, headers, two_pending_devices):
    ids = [d.id for d in two_pending_devices]
    res = await client.post("/api/v1/scan/pending/bulk-hide", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["hidden"] == 2
    assert data["skipped"] == 0
    # Should appear in hidden list
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert len(hidden_res.json()) == 2


@pytest.mark.asyncio
async def test_bulk_hide_skips_non_pending(client: AsyncClient, headers, two_pending_devices):
    ids = [d.id for d in two_pending_devices]
    # Hide first device individually first
    await client.post(f"/api/v1/scan/pending/{ids[0]}/hide", headers=headers)
    # Bulk hide both — first is already hidden (not pending anymore)
    res = await client.post("/api/v1/scan/pending/bulk-hide", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["hidden"] == 1
    assert data["skipped"] == 1


@pytest.mark.asyncio
async def test_bulk_hide_requires_auth(client: AsyncClient, two_pending_devices):
    ids = [d.id for d in two_pending_devices]
    res = await client.post("/api/v1/scan/pending/bulk-hide", json={"device_ids": ids})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# Approve auto-creates Edges from pending_device_links (Zigbee flow)
# ---------------------------------------------------------------------------


async def _seed_zigbee_pending_pair(db_session):
    """Create a coordinator Node + a pending device + a link between them."""
    from app.db.models import Node, PendingDevice, PendingDeviceLink

    coord = Node(
        label="Coordinator",
        type="zigbee_coordinator",
        status="unknown",
        ieee_address="0xCOORD",
    )
    db_session.add(coord)

    pending = PendingDevice(
        ieee_address="0xR1",
        friendly_name="router_1",
        suggested_type="zigbee_router",
        device_subtype="Router",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add(pending)

    db_session.add(
        PendingDeviceLink(
            source_ieee="0xCOORD",
            target_ieee="0xR1",
            discovery_source="zigbee",
        )
    )
    await db_session.commit()
    return coord, pending


@pytest.mark.asyncio
async def test_approve_zigbee_creates_edge_when_other_endpoint_is_node(
    client: AsyncClient, headers, db_session
):
    from sqlalchemy import select

    from app.db.models import Edge

    coord, pending = await _seed_zigbee_pending_pair(db_session)

    res = await client.post(
        f"/api/v1/scan/pending/{pending.id}/approve",
        json={
            "label": "router_1",
            "type": "zigbee_router",
            "ip": None,
            "status": "unknown",
            "services": [],
        },
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] is True
    assert data["edges_created"] == 1

    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 1
    assert edges[0].source == coord.id
    assert edges[0].target == data["node_id"]
    assert edges[0].source_handle == "bottom"
    assert edges[0].target_handle == "top-t"
    assert edges[0].type == "iot"


@pytest.mark.asyncio
async def test_approve_zigbee_skips_duplicate_edge(
    client: AsyncClient, headers, db_session
):
    """Re-running the resolution does not create a second edge for the same pair."""
    from sqlalchemy import select

    from app.db.models import Edge, PendingDevice, PendingDeviceLink

    coord, pending = await _seed_zigbee_pending_pair(db_session)
    body = {"label": "router_1", "type": "zigbee_router", "ip": None, "status": "unknown", "services": []}
    await client.post(f"/api/v1/scan/pending/{pending.id}/approve", json=body, headers=headers)

    # Simulate a second pending row + link between same coord and a new device,
    # but keep an existing edge in place to verify dedupe also handles
    # the swapped-direction case.
    new_pending = PendingDevice(
        ieee_address="0xR1B",
        friendly_name="r1b",
        suggested_type="zigbee_router",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add(new_pending)
    db_session.add(
        PendingDeviceLink(source_ieee="0xCOORD", target_ieee="0xR1B", discovery_source="zigbee")
    )
    await db_session.commit()
    res = await client.post(
        f"/api/v1/scan/pending/{new_pending.id}/approve", json=body, headers=headers
    )
    assert res.json()["edges_created"] == 1  # only the new pair
    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 2  # original + new, no duplicate


@pytest.mark.asyncio
async def test_approve_zigbee_skips_when_other_endpoint_still_pending(
    client: AsyncClient, headers, db_session
):
    """Both endpoints pending → no edge yet, link row preserved for later."""
    from sqlalchemy import select

    from app.db.models import Edge, PendingDevice, PendingDeviceLink

    a = PendingDevice(
        ieee_address="0xA",
        friendly_name="a",
        suggested_type="zigbee_router",
        status="pending",
        discovery_source="zigbee",
    )
    b = PendingDevice(
        ieee_address="0xB",
        friendly_name="b",
        suggested_type="zigbee_enddevice",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add_all([a, b])
    db_session.add(
        PendingDeviceLink(source_ieee="0xA", target_ieee="0xB", discovery_source="zigbee")
    )
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{a.id}/approve",
        json={
            "label": "a",
            "type": "zigbee_router",
            "ip": None,
            "status": "unknown",
            "services": [],
        },
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["edges_created"] == 0

    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert edges == []
    links = (await db_session.execute(select(PendingDeviceLink))).scalars().all()
    assert len(links) == 1  # preserved for later resolution


@pytest.mark.asyncio
async def test_approve_zigbee_resolves_link_after_second_approval(
    client: AsyncClient, headers, db_session
):
    """First approval keeps link; second approval creates the edge."""
    from sqlalchemy import select

    from app.db.models import Edge, PendingDevice, PendingDeviceLink

    a = PendingDevice(
        ieee_address="0xA",
        friendly_name="a",
        suggested_type="zigbee_router",
        status="pending",
        discovery_source="zigbee",
    )
    b = PendingDevice(
        ieee_address="0xB",
        friendly_name="b",
        suggested_type="zigbee_enddevice",
        status="pending",
        discovery_source="zigbee",
    )
    db_session.add_all([a, b])
    db_session.add(
        PendingDeviceLink(source_ieee="0xA", target_ieee="0xB", discovery_source="zigbee")
    )
    await db_session.commit()

    body = {"label": "x", "type": "zigbee_router", "ip": None, "status": "unknown", "services": []}
    await client.post(f"/api/v1/scan/pending/{a.id}/approve", json=body, headers=headers)
    res = await client.post(f"/api/v1/scan/pending/{b.id}/approve", json=body, headers=headers)
    assert res.json()["edges_created"] == 1

    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 1
    links = (await db_session.execute(select(PendingDeviceLink))).scalars().all()
    assert links == []  # consumed
