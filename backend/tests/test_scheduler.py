"""Tests for background scheduler: _run_status_checks, lifecycle."""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.scheduler import (
    _run_proxmox_sync,
    _run_service_checks,
    _run_status_checks,
    _run_zigbee_sync,
    _run_zwave_sync,
    reschedule_proxmox_sync,
    reschedule_service_checks,
    reschedule_status_checks,
    reschedule_zigbee_sync,
    reschedule_zwave_sync,
    set_proxmox_sync_enabled,
    set_service_checks_enabled,
    set_zigbee_sync_enabled,
    set_zwave_sync_enabled,
    start_scheduler,
    stop_scheduler,
)
from app.db.database import Base
from app.db.models import InventoryDevice, Node

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_device(**kwargs) -> InventoryDevice:
    """An inventory row — what the checker iterates now that a device is checked
    once rather than once per canvas."""
    defaults = dict(id=str(uuid.uuid4()), status="approved", status_live="unknown")
    return InventoryDevice(**{**defaults, **kwargs})


def _make_node(device_id: str | None = None, **kwargs) -> Node:
    defaults = dict(
        id=str(uuid.uuid4()),
        type="server",
        label="Test",
        device_id=device_id,
        pos_x=0.0,
        pos_y=0.0,
    )
    return Node(**{**defaults, **kwargs})


# ---------------------------------------------------------------------------
# _run_status_checks
# ---------------------------------------------------------------------------

@pytest.fixture
async def mem_db():
    """In-memory SQLite DB with Node table created."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.mark.asyncio
async def test_run_status_checks_skips_devices_without_check_method(mem_db):
    """Devices with no check_method are skipped; check_node is never called."""
    async with mem_db() as session:
        session.add(_make_device(check_method=None, ip="10.0.0.1"))
        await session.commit()

    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_node", new_callable=AsyncMock) as mock_check:
        await _run_status_checks()
        mock_check.assert_not_called()


@pytest.mark.asyncio
async def test_run_status_checks_updates_device_status(mem_db):
    """check_node result lands on the device row and is broadcast to its nodes."""
    async with mem_db() as session:
        device = _make_device(check_method="ping", ip="10.0.0.1")
        session.add(device)
        await session.flush()
        node = _make_node(device_id=device.id)
        session.add(node)
        await session.commit()
        device_id, node_id = device.id, node.id

    check_result = {"status": "online", "response_time_ms": 5}

    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_node", new_callable=AsyncMock, return_value=check_result), \
         patch("app.api.routes.status.broadcast_status", new_callable=AsyncMock) as mock_broadcast:
        await _run_status_checks()

    # Verify the row updated — `status_live` is reachability, `status` is the
    # pending/approved/hidden lifecycle and must not be touched.
    async with mem_db() as session:
        updated = await session.get(InventoryDevice, device_id)
        assert updated is not None
        assert updated.status_live == "online"
        assert updated.status == "approved"
        assert updated.response_time_ms == 5

    # Verify WebSocket broadcast, addressed by device and carrying its nodes
    mock_broadcast.assert_awaited_once()
    _, kwargs = mock_broadcast.call_args
    assert kwargs["device_id"] == device_id
    assert kwargs["node_ids"] == [node_id]
    assert kwargs["status"] == "online"


@pytest.mark.asyncio
async def test_run_status_checks_covers_a_device_no_canvas_draws(mem_db):
    """Deliberate: the inventory row, not a node, is what gets monitored.

    A rack mount or an inventory-only entry reports live status without being
    drawn on any canvas, and deleting a node does not silently stop monitoring
    the host. `hide` (or clearing the check method) is what ends the checks.
    """
    async with mem_db() as session:
        device = _make_device(check_method="ping", ip="10.0.0.1")
        session.add(device)
        await session.commit()
        device_id = device.id

    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_node", new_callable=AsyncMock,
               return_value={"status": "online", "response_time_ms": 5}), \
         patch("app.api.routes.status.broadcast_status", new_callable=AsyncMock) as mock_broadcast:
        await _run_status_checks()

    async with mem_db() as session:
        updated = await session.get(InventoryDevice, device_id)
        assert updated is not None
        assert updated.status_live == "online"

    _, kwargs = mock_broadcast.call_args
    assert kwargs["device_id"] == device_id
    assert kwargs["node_ids"] == []


@pytest.mark.asyncio
async def test_run_status_checks_skips_a_hidden_device(mem_db):
    """Hiding a device is how a user stops the checks, node or no node."""
    async with mem_db() as session:
        session.add(_make_device(check_method="ping", ip="10.0.0.1", status="hidden"))
        await session.commit()

    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_node", new_callable=AsyncMock) as mock_check:
        await _run_status_checks()
        mock_check.assert_not_called()


@pytest.mark.asyncio
async def test_run_status_checks_sets_last_seen_only_when_online(mem_db):
    """last_seen is updated only when status is 'online'."""
    async with mem_db() as session:
        device = _make_device(check_method="ping", ip="10.0.0.1", last_seen=None)
        session.add(device)
        await session.commit()
        device_id = device.id

    check_result = {"status": "offline", "response_time_ms": None}

    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_node", new_callable=AsyncMock, return_value=check_result), \
         patch("app.api.routes.status.broadcast_status", new_callable=AsyncMock):
        await _run_status_checks()

    async with mem_db() as session:
        updated = await session.get(InventoryDevice, device_id)
        assert updated is not None
        assert updated.last_seen is None  # not set for offline


@pytest.mark.asyncio
async def test_run_status_checks_handles_check_error_gracefully(mem_db):
    """An exception from check_node is logged and does not abort other devices."""
    async with mem_db() as session:
        session.add_all([
            _make_device(check_method="ping", ip="10.0.0.1"),
            _make_device(check_method="ping", ip="10.0.0.2"),
        ])
        await session.commit()

    call_count = 0
    async def flaky_check(method, target, ip):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("timeout")
        return {"status": "online", "response_time_ms": 1}

    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_node", side_effect=flaky_check), \
         patch("app.api.routes.status.broadcast_status", new_callable=AsyncMock):
        await _run_status_checks()  # must not raise

    assert call_count == 2


# ---------------------------------------------------------------------------
# start_scheduler / stop_scheduler
# ---------------------------------------------------------------------------

def test_scheduler_uses_settings_interval():
    """Scheduler registers the job with the interval from settings."""
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as mock_settings, \
         patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched):
        mock_settings.status_checker_interval = 45
        mock_settings.service_check_enabled = False
        mock_settings.proxmox_sync_enabled = False
        mock_settings.zigbee_sync_enabled = False
        mock_settings.zwave_sync_enabled = False
        start_scheduler()
        _, kwargs = mock_sched.add_job.call_args
        assert kwargs["seconds"] == 45


def test_start_and_stop_scheduler():
    """Scheduler can be started and stopped without errors."""
    mock_sched = MagicMock()
    with patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched), \
         patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.status_checker_interval = 60
        mock_settings.service_check_enabled = False
        mock_settings.proxmox_sync_enabled = False
        mock_settings.zigbee_sync_enabled = False
        mock_settings.zwave_sync_enabled = False
        start_scheduler()
        stop_scheduler()
        mock_sched.add_job.assert_called_once()
        mock_sched.start.assert_called_once()
        mock_sched.shutdown.assert_called_once()


# ---------------------------------------------------------------------------
# Service checks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_service_checks_disabled_does_nothing(mem_db):
    async with mem_db() as session:
        session.add(_make_device(services=[{"port": 80, "protocol": "tcp", "service_name": "http"}]))
        await session.commit()

    with patch("app.core.scheduler.settings") as mock_settings, \
         patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.services.status_checker.check_services", new_callable=AsyncMock) as mock_cs:
        mock_settings.service_check_enabled = False
        await _run_service_checks()
    mock_cs.assert_not_called()


@pytest.mark.asyncio
async def test_run_service_checks_broadcasts_per_device(mem_db):
    async with mem_db() as session:
        device = _make_device(
            ip="10.0.0.5",
            services=[{"port": 80, "protocol": "tcp", "service_name": "http"}],
        )
        session.add(device)
        await session.flush()
        node = _make_node(device_id=device.id)
        session.add(node)
        await session.commit()
        device_id, node_id = device.id, node.id

    statuses = [{"port": 80, "protocol": "tcp", "status": "offline"}]

    with patch("app.core.scheduler.settings") as mock_settings, \
         patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_services", new_callable=AsyncMock, return_value=statuses), \
         patch("app.api.routes.status.broadcast_service_status", new_callable=AsyncMock) as mock_bcast:
        mock_settings.service_check_enabled = True
        await _run_service_checks()

    mock_bcast.assert_awaited_once()
    _, kwargs = mock_bcast.call_args
    assert kwargs["device_id"] == device_id
    assert kwargs["node_ids"] == [node_id]
    assert kwargs["services"] == statuses


@pytest.mark.asyncio
async def test_run_service_checks_skips_devices_without_services(mem_db):
    async with mem_db() as session:
        session.add(_make_device(ip="10.0.0.6", services=[]))
        await session.commit()

    with patch("app.core.scheduler.settings") as mock_settings, \
         patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
         patch("app.core.scheduler.check_services", new_callable=AsyncMock) as mock_cs:
        mock_settings.service_check_enabled = True
        await _run_service_checks()
    mock_cs.assert_not_called()


def test_set_service_checks_enabled_adds_and_removes_job():
    mock_sched = MagicMock()
    mock_sched.running = True
    with patch("app.core.scheduler.scheduler", mock_sched), \
         patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.service_check_interval = 300
        # Enable: no existing job -> add
        mock_sched.get_job.return_value = None
        set_service_checks_enabled(True)
        mock_sched.add_job.assert_called_once()
        # Disable: existing job -> remove
        mock_sched.get_job.return_value = MagicMock()
        set_service_checks_enabled(False)
        mock_sched.remove_job.assert_called_once_with("service_checks")


def test_start_scheduler_adds_service_job_when_enabled():
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as mock_settings, \
         patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched):
        mock_settings.status_checker_interval = 60
        mock_settings.service_check_enabled = True
        mock_settings.service_check_interval = 300
        mock_settings.proxmox_sync_enabled = False
        mock_settings.zigbee_sync_enabled = False
        mock_settings.zwave_sync_enabled = False
        start_scheduler()
    job_ids = [kw.get("id") for _, kw in mock_sched.add_job.call_args_list]
    assert "status_checks" in job_ids
    assert "service_checks" in job_ids


def test_start_scheduler_adds_kubernetes_job_only_when_explicitly_enabled():
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as mock_settings, patch(
        "app.core.scheduler.AsyncIOScheduler", return_value=mock_sched
    ):
        mock_settings.status_checker_interval = 60
        mock_settings.service_check_enabled = False
        mock_settings.proxmox_sync_enabled = False
        mock_settings.zigbee_sync_enabled = False
        mock_settings.zwave_sync_enabled = False
        mock_settings.kubernetes_enabled = True
        mock_settings.kubernetes_sync_interval = 300
        start_scheduler()

    job_ids = [kw.get("id") for _, kw in mock_sched.add_job.call_args_list]
    assert "kubernetes_sync" in job_ids


# ---------------------------------------------------------------------------
# Proxmox auto-sync job
# ---------------------------------------------------------------------------

def test_set_proxmox_sync_enabled_adds_and_removes_job():
    mock_sched = MagicMock()
    mock_sched.running = True
    with patch("app.core.scheduler.scheduler", mock_sched), \
         patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.proxmox_sync_interval = 3600
        mock_sched.get_job.return_value = None
        set_proxmox_sync_enabled(True)
        mock_sched.add_job.assert_called_once()
        mock_sched.get_job.return_value = MagicMock()
        set_proxmox_sync_enabled(False)
        mock_sched.remove_job.assert_called_once_with("proxmox_sync")


def test_reschedule_proxmox_sync_rejects_short_interval():
    with pytest.raises(ValueError):
        reschedule_proxmox_sync(60)


@pytest.mark.asyncio
async def test_run_proxmox_sync_skips_when_disabled():
    with patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.proxmox_sync_enabled = False
        # Must return before importing/fetching anything.
        await _run_proxmox_sync()


@pytest.mark.asyncio
async def test_run_proxmox_sync_skips_when_no_token():
    with patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.proxmox_sync_enabled = True
        mock_settings.proxmox_host = "pve"
        mock_settings.proxmox_token_id = ""
        mock_settings.proxmox_token_secret = ""
        await _run_proxmox_sync()  # no exception, no fetch


def _proxmox_settings(mock_settings):
    mock_settings.proxmox_sync_enabled = True
    mock_settings.proxmox_host = "pve"
    mock_settings.proxmox_port = 8006
    mock_settings.proxmox_token_id = "root@pam!tok"
    mock_settings.proxmox_token_secret = "secret"
    mock_settings.proxmox_verify_tls = False


@pytest.mark.asyncio
async def test_run_proxmox_sync_records_scan_run(mem_db):
    """Auto-sync must create a ScanRun (kind=proxmox) so it shows in Scan
    history, then delegate to the shared background import with the run id."""
    from app.db.models import ScanRun

    with (
        patch("app.core.scheduler.settings") as mock_settings,
        patch("app.core.scheduler.AsyncSessionLocal", mem_db),
        patch(
            "app.api.routes.proxmox._background_proxmox_import",
            new_callable=AsyncMock,
        ) as mock_bg,
    ):
        _proxmox_settings(mock_settings)
        await _run_proxmox_sync()

    # A ScanRun row exists — the missing scan-history trace.
    async with mem_db() as db:
        from sqlalchemy import select
        run = (await db.execute(select(ScanRun))).scalars().one()
    assert run.kind == "proxmox"
    assert run.ranges == ["pve:8006"]

    # Delegated to the same background flow the manual /sync-now uses, passing
    # the run id + env connection settings.
    mock_bg.assert_awaited_once_with(
        run.id, "pve", 8006, "root@pam!tok", "secret", False,
    )


# ---------------------------------------------------------------------------
# Zigbee / Z-Wave auto-sync jobs (MQTT mesh imports)
# ---------------------------------------------------------------------------

def test_set_zigbee_sync_enabled_adds_and_removes_job():
    mock_sched = MagicMock()
    mock_sched.running = True
    with patch("app.core.scheduler.scheduler", mock_sched), \
         patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.zigbee_sync_interval = 3600
        mock_sched.get_job.return_value = None
        set_zigbee_sync_enabled(True)
        mock_sched.add_job.assert_called_once()
        mock_sched.get_job.return_value = MagicMock()
        set_zigbee_sync_enabled(False)
        mock_sched.remove_job.assert_called_once_with("zigbee_sync")


def test_set_zwave_sync_enabled_adds_and_removes_job():
    mock_sched = MagicMock()
    mock_sched.running = True
    with patch("app.core.scheduler.scheduler", mock_sched), \
         patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.zwave_sync_interval = 3600
        mock_sched.get_job.return_value = None
        set_zwave_sync_enabled(True)
        mock_sched.add_job.assert_called_once()
        mock_sched.get_job.return_value = MagicMock()
        set_zwave_sync_enabled(False)
        mock_sched.remove_job.assert_called_once_with("zwave_sync")


def test_reschedule_zigbee_sync_rejects_short_interval():
    with pytest.raises(ValueError):
        reschedule_zigbee_sync(60)


def test_reschedule_zwave_sync_rejects_short_interval():
    with pytest.raises(ValueError):
        reschedule_zwave_sync(60)


@pytest.mark.asyncio
async def test_run_zigbee_sync_skips_when_disabled():
    with patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.zigbee_sync_enabled = False
        await _run_zigbee_sync()  # returns before importing/fetching anything


@pytest.mark.asyncio
async def test_run_zigbee_sync_skips_when_no_host():
    with patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.zigbee_sync_enabled = True
        mock_settings.zigbee_mqtt_host = ""
        await _run_zigbee_sync()  # no exception, no fetch


@pytest.mark.asyncio
async def test_run_zwave_sync_skips_when_no_host():
    with patch("app.core.scheduler.settings") as mock_settings:
        mock_settings.zwave_sync_enabled = True
        mock_settings.zwave_mqtt_host = ""
        await _run_zwave_sync()


@pytest.mark.asyncio
async def test_run_zigbee_sync_records_scan_run(mem_db):
    """Auto-sync must create a ScanRun (kind=zigbee) so it shows in Scan history,
    then delegate to the shared background import with the run id + env payload."""
    from app.db.models import ScanRun
    from app.schemas.zigbee import ZigbeeImportRequest

    fake_payload = ZigbeeImportRequest(mqtt_host="broker", mqtt_port=1883)

    with (
        patch("app.core.scheduler.settings") as mock_settings,
        patch("app.core.scheduler.AsyncSessionLocal", mem_db),
        patch("app.api.routes.zigbee._background_zigbee_import", new_callable=AsyncMock) as mock_bg,
        patch("app.api.routes.zigbee.env_import_request", return_value=fake_payload),
    ):
        mock_settings.zigbee_sync_enabled = True
        mock_settings.zigbee_mqtt_host = "broker"
        mock_settings.zigbee_mqtt_port = 1883
        await _run_zigbee_sync()

    async with mem_db() as db:
        from sqlalchemy import select
        run = (await db.execute(select(ScanRun))).scalars().one()
    assert run.kind == "zigbee"
    assert run.ranges == ["broker:1883"]
    mock_bg.assert_awaited_once_with(run.id, fake_payload)


@pytest.mark.asyncio
async def test_run_zwave_sync_records_scan_run(mem_db):
    """Auto-sync must create a ScanRun (kind=zwave) then delegate to the shared
    background import with the run id + env payload."""
    from app.db.models import ScanRun
    from app.schemas.zwave import ZwaveImportRequest

    fake_payload = ZwaveImportRequest(mqtt_host="broker", mqtt_port=1883)

    with (
        patch("app.core.scheduler.settings") as mock_settings,
        patch("app.core.scheduler.AsyncSessionLocal", mem_db),
        patch("app.api.routes.zwave._background_zwave_import", new_callable=AsyncMock) as mock_bg,
        patch("app.api.routes.zwave.env_import_request", return_value=fake_payload),
    ):
        mock_settings.zwave_sync_enabled = True
        mock_settings.zwave_mqtt_host = "broker"
        mock_settings.zwave_mqtt_port = 1883
        await _run_zwave_sync()

    async with mem_db() as db:
        from sqlalchemy import select
        run = (await db.execute(select(ScanRun))).scalars().one()
    assert run.kind == "zwave"
    assert run.ranges == ["broker:1883"]
    mock_bg.assert_awaited_once_with(run.id, fake_payload)


def test_reschedule_zigbee_sync_noop_when_not_running():
    mock_sched = MagicMock()
    mock_sched.running = False
    with patch("app.core.scheduler.scheduler", mock_sched):
        reschedule_zigbee_sync(600)
    mock_sched.reschedule_job.assert_not_called()


def test_start_scheduler_adds_mesh_jobs_when_enabled():
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as mock_settings, \
         patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched):
        mock_settings.status_checker_interval = 60
        mock_settings.service_check_enabled = False
        mock_settings.proxmox_sync_enabled = False
        mock_settings.zigbee_sync_enabled = True
        mock_settings.zigbee_sync_interval = 3600
        mock_settings.zwave_sync_enabled = True
        mock_settings.zwave_sync_interval = 3600
        start_scheduler()
    job_ids = [kw.get("id") for _, kw in mock_sched.add_job.call_args_list]
    assert "zigbee_sync" in job_ids
    assert "zwave_sync" in job_ids


# --- reschedule_* validation and not-running guards ---

def test_reschedule_status_checks_rejects_short_interval():
    with pytest.raises(ValueError):
        reschedule_status_checks(5)


def test_reschedule_status_checks_noop_when_not_running():
    mock_sched = MagicMock()
    mock_sched.running = False
    with patch("app.core.scheduler.scheduler", mock_sched):
        reschedule_status_checks(60)
    mock_sched.reschedule_job.assert_not_called()


def test_reschedule_status_checks_updates_running_job():
    mock_sched = MagicMock()
    mock_sched.running = True
    with patch("app.core.scheduler.scheduler", mock_sched):
        reschedule_status_checks(60)
    mock_sched.reschedule_job.assert_called_once_with(
        "status_checks", trigger="interval", seconds=60,
    )


def test_reschedule_service_checks_rejects_short_interval():
    with pytest.raises(ValueError):
        reschedule_service_checks(10)


def test_reschedule_service_checks_updates_when_job_exists():
    mock_sched = MagicMock()
    mock_sched.running = True
    mock_sched.get_job.return_value = MagicMock()
    with patch("app.core.scheduler.scheduler", mock_sched):
        reschedule_service_checks(60)
    mock_sched.reschedule_job.assert_called_once_with(
        "service_checks", trigger="interval", seconds=60,
    )


def test_reschedule_proxmox_sync_noop_when_not_running():
    mock_sched = MagicMock()
    mock_sched.running = False
    with patch("app.core.scheduler.scheduler", mock_sched):
        reschedule_proxmox_sync(600)
    mock_sched.reschedule_job.assert_not_called()
