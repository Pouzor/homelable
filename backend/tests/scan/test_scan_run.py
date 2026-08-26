"""run_scan service persistence, _background_scan lifecycle, stop/cancel."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InventoryDevice, Node, ScanRun
from app.services.scanner import (
    _cancelled_runs,
    reconcile_orphan_runs,
    request_cancel,
    run_scan,
)


@pytest.mark.asyncio
async def test_background_scan_marks_run_errored_on_exception(mem_db):
    """If run_scan() raises, the ScanRun must transition running → error and the
    session rollback path must execute without a follow-on exception.

    "error" and not "failed": one condition, one name — it is what run_scan
    writes when it catches the failure itself, and the only one Scan History
    filters and colours.
    """
    from app.api.routes.scan import _background_scan

    async with mem_db() as session:
        run = ScanRun(status="running", ranges=["10.0.0.0/24"])
        session.add(run)
        await session.commit()
        run_id = run.id

    with (
        patch("app.api.routes.scan.AsyncSessionLocal", mem_db),
        patch(
            "app.api.routes.scan.run_scan",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ),
    ):
        await _background_scan(run_id, ["10.0.0.0/24"])

    async with mem_db() as session:
        refreshed = await session.get(ScanRun, run_id)
        assert refreshed is not None
        assert refreshed.status == "error"


@pytest.mark.asyncio
async def test_background_scan_leaves_non_running_status_alone(mem_db):
    """If the run was already stopped/cancelled before run_scan failed, _background_scan
    must NOT overwrite that terminal status with 'error'."""
    from app.api.routes.scan import _background_scan

    async with mem_db() as session:
        run = ScanRun(status="cancelled", ranges=["10.0.0.0/24"])
        session.add(run)
        await session.commit()
        run_id = run.id

    with (
        patch("app.api.routes.scan.AsyncSessionLocal", mem_db),
        patch(
            "app.api.routes.scan.run_scan",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ),
    ):
        await _background_scan(run_id, ["10.0.0.0/24"])

    async with mem_db() as session:
        refreshed = await session.get(ScanRun, run_id)
        assert refreshed is not None
        assert refreshed.status == "cancelled"


@pytest.mark.asyncio
async def test_background_scan_success_path_invokes_run_scan(mem_db):
    from app.api.routes.scan import _background_scan

    async with mem_db() as session:
        run = ScanRun(status="running", ranges=["10.0.0.0/24"])
        session.add(run)
        await session.commit()
        run_id = run.id

    with (
        patch("app.api.routes.scan.AsyncSessionLocal", mem_db),
        patch("app.api.routes.scan.run_scan", new_callable=AsyncMock) as mock_run_scan,
    ):
        from app.services.scanner import DeepScanOptions
        await _background_scan(run_id, ["10.0.0.0/24"], DeepScanOptions())
        mock_run_scan.assert_awaited_once()


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
        select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.50")
    )
    device = result.scalar_one_or_none()
    assert device is not None
    assert device.hostname == "myhost.lan"
    assert any(s["port"] == 8096 for s in device.services)
    assert device.suggested_type == "server"


@pytest.mark.asyncio
async def test_run_scan_keeps_stale_pending_for_canvas_nodes(db_session: AsyncSession):
    """Pending devices whose IP is already on a canvas are NOT purged — they stay
    in the inventory and are surfaced with an "In N canvas" badge."""
    stale = InventoryDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.50",
        mac=None,
        hostname=None,
        os=None,
        services=[],
        suggested_type="generic",
        status="pending",
    )
    db_session.add(stale)
    await db_session.flush()
    # A canvas already draws that device.
    db_session.add(Node(
        id=str(uuid.uuid4()),
        label="Existing Server",
        type="server",
        device_id=stale.id,
        pos_x=0.0,
        pos_y=0.0,
    ))
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
        select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.50")
    )
    assert result.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_run_scan_records_ip_already_in_canvas(db_session: AsyncSession):
    """A scanned IP already drawn on a canvas refreshes the one inventory row.

    The device is never suppressed, and never duplicated: the node draws that
    row, so a second row for the same host would split the device in two.
    """
    existing = InventoryDevice(id=str(uuid.uuid4()), ip="192.168.1.50", status="approved")
    db_session.add(existing)
    await db_session.flush()
    existing_id = existing.id
    db_session.add(Node(
        id=str(uuid.uuid4()),
        label="Existing Server",
        type="server",
        device_id=existing.id,
        pos_x=0.0,
        pos_y=0.0,
    ))
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

    rows = (
        await db_session.execute(
            select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.50")
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].id == existing_id
    # The scan refreshed it; it did not reset the lifecycle.
    assert rows[0].status == "approved"
    assert rows[0].hostname == MOCK_HOST["hostname"]


@pytest.mark.asyncio
async def test_run_scan_refreshes_approved_device_without_duplicating(db_session: AsyncSession):
    """Re-scanning an already-approved device updates its row in place instead of
    spawning a fresh pending duplicate, and keeps it approved."""
    approved = InventoryDevice(
        id=str(uuid.uuid4()), ip="192.168.1.50", mac=None, hostname="old",
        os=None, services=[], suggested_type="server", status="approved",
    )
    db_session.add(approved)
    run_id = str(uuid.uuid4())
    db_session.add(ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"]))
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[MOCK_HOST]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    rows = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.50")
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == "approved"
    assert rows[0].hostname == "myhost.lan"  # refreshed from the scan


@pytest.mark.asyncio
async def test_run_scan_collapses_existing_duplicate_rows(db_session: AsyncSession):
    """Pre-existing duplicate inventory rows for one IP are collapsed to a single
    row at scan start, even if the device is not re-discovered."""
    for status in ("approved", "pending", "pending"):
        db_session.add(InventoryDevice(
            id=str(uuid.uuid4()), ip="192.168.1.77", mac=None, hostname=None,
            os=None, services=[], suggested_type="server", status=status,
        ))
    run_id = str(uuid.uuid4())
    db_session.add(ScanRun(id=run_id, status="running", ranges=["192.168.1.0/24"]))
    await db_session.commit()

    with (
        patch("app.services.scanner._nmap_scan", return_value=[]),
        patch("app.api.routes.status.broadcast_scan_update", new_callable=AsyncMock),
    ):
        await run_scan(["192.168.1.0/24"], db_session, run_id)

    rows = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.77")
    )).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == "approved"  # approved row is the one kept


@pytest.mark.asyncio
async def test_run_scan_skips_hidden_device(db_session: AsyncSession):
    """Devices previously hidden by the user must not re-appear in pending on re-scan."""
    hidden = InventoryDevice(
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
        select(InventoryDevice).where(
            InventoryDevice.ip == "192.168.1.50",
            InventoryDevice.status == "pending",
        )
    )
    assert result.scalar_one_or_none() is None


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
    # status flipped eagerly so the UI reacts without waiting for a checkpoint
    await db_session.refresh(run)
    assert run.status == "cancelled"
    assert run.finished_at is not None
    # cleanup for other tests
    _cancelled_runs.discard(run.id)


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

    def nmap_side_effect(target: str, port_spec: str | None = None, run_id: str | None = None):
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
    existing = InventoryDevice(
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
        select(InventoryDevice).where(InventoryDevice.ip == "192.168.1.50")
    )
    devices = list(result.scalars().all())
    assert len(devices) == 1
    device = devices[0]
    # Services and hostname should be updated
    assert device.hostname == "myhost.lan"
    assert any(s["port"] == 8096 for s in device.services)


@pytest.mark.asyncio
async def test_background_device_scan_marks_run_errored_on_exception(mem_db):
    """Same word as the network scan — a device run that blows up reads alike."""
    from app.api.routes.scan import _background_device_scan

    async with mem_db() as session:
        run = ScanRun(status="running", kind="device", ranges=["10.0.0.5/32"])
        session.add(run)
        await session.commit()
        run_id = run.id

    with (
        patch("app.api.routes.scan.AsyncSessionLocal", mem_db),
        patch(
            "app.api.routes.scan.run_device_scan",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ),
    ):
        await _background_device_scan(run_id, "d1")

    async with mem_db() as session:
        refreshed = await session.get(ScanRun, run_id)
        assert refreshed is not None
        assert refreshed.status == "error"


# --- reconcile_orphan_runs (issue #374) --------------------------------------


@pytest.mark.asyncio
async def test_reconcile_orphan_runs_marks_running_as_error(mem_db):
    """A run left "running" by a process that died mid-scan is immortal, and it
    also locks its range out of future scans. Startup must reconcile it."""
    async with mem_db() as session:
        orphan = ScanRun(status="running", ranges=["10.0.0.0/24"])
        session.add(orphan)
        await session.commit()
        orphan_id = orphan.id

        assert await reconcile_orphan_runs(session) == 1

        reconciled = await session.get(ScanRun, orphan_id)
        # "error", not "failed" — one condition, one name, and the only status
        # Scan History filters and colours.
        assert reconciled.status == "error"
        assert reconciled.finished_at is not None
        assert "restarted" in reconciled.error


@pytest.mark.asyncio
async def test_reconcile_orphan_runs_leaves_finished_runs_alone(mem_db):
    """Only "running" is orphaned. Terminal rows must not be rewritten."""
    async with mem_db() as session:
        done = ScanRun(status="done", ranges=["10.0.0.0/24"], devices_found=7)
        cancelled = ScanRun(status="cancelled", ranges=["10.0.1.0/24"])
        errored = ScanRun(status="error", ranges=["10.0.2.0/24"], error="nmap missing")
        session.add_all([done, cancelled, errored])
        await session.commit()
        ids = (done.id, cancelled.id, errored.id)

        assert await reconcile_orphan_runs(session) == 0

        for run_id, expected in zip(ids, ("done", "cancelled", "error"), strict=True):
            assert (await session.get(ScanRun, run_id)).status == expected
        # The pre-existing error message must survive untouched.
        assert (await session.get(ScanRun, ids[2])).error == "nmap missing"


@pytest.mark.asyncio
async def test_reconcile_orphan_runs_handles_several_and_an_empty_table(mem_db):
    async with mem_db() as session:
        # Nothing to do on a fresh database.
        assert await reconcile_orphan_runs(session) == 0

        session.add_all([
            ScanRun(status="running", ranges=["10.0.0.0/24"]),
            ScanRun(status="running", kind="device", ranges=["10.0.0.5"]),
            ScanRun(status="done", ranges=["10.0.1.0/24"]),
        ])
        await session.commit()

        assert await reconcile_orphan_runs(session) == 2
        remaining = (
            await session.execute(select(ScanRun).where(ScanRun.status == "running"))
        ).scalars().all()
        assert remaining == []


@pytest.mark.asyncio
async def test_reconcile_orphan_runs_unblocks_a_new_scan(mem_db):
    """The point of the reconcile: the trigger endpoints reject a scan while one
    is "running" for the same target, so an orphan blocks that range for good."""
    async with mem_db() as session:
        session.add(ScanRun(status="running", kind="device", ranges=["10.0.0.5"]))
        await session.commit()

        await reconcile_orphan_runs(session)

        blocking = (
            await session.execute(
                select(ScanRun).where(
                    ScanRun.status == "running", ScanRun.kind == "device"
                )
            )
        ).scalars().all()
        assert not any("10.0.0.5" in (r.ranges or []) for r in blocking)


@pytest.mark.asyncio
async def test_lifespan_reconciles_orphan_runs_at_startup():
    """The reconcile is worthless unless startup actually calls it."""
    from app.main import app as fastapi_app
    from app.main import lifespan

    with patch("app.main.init_db", new=AsyncMock()), \
         patch("app.main.start_scheduler"), \
         patch("app.main.stop_scheduler"), \
         patch("app.main.reconcile_orphan_runs", new=AsyncMock()) as reconcile:
        async with lifespan(fastapi_app):
            pass

    reconcile.assert_awaited_once()
