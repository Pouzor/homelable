"""STATUS_CHECKER_ENABLED=false: no check job is ever registered, the runners
are inert, and nothing re-enables them at runtime."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.scheduler import (
    _run_service_checks,
    _run_status_checks,
    reschedule_status_checks,
    set_service_checks_enabled,
    start_scheduler,
)


def _configure(mock_settings, *, checker: bool, services: bool = False) -> None:
    mock_settings.status_checker_enabled = checker
    mock_settings.status_checker_interval = 60
    mock_settings.service_check_enabled = services
    mock_settings.service_check_interval = 300
    mock_settings.proxmox_sync_enabled = False
    mock_settings.zigbee_sync_enabled = False
    mock_settings.zwave_sync_enabled = False
    mock_settings.unifi_sync_enabled = False


def _job_ids(mock_sched: MagicMock) -> list[str]:
    return [kw.get("id") for _, kw in mock_sched.add_job.call_args_list]


def test_switch_defaults_to_enabled():
    from app.core.config import Settings

    assert Settings.model_fields["status_checker_enabled"].default is True


def test_env_var_turns_the_switch_off(monkeypatch):
    from app.core.config import Settings

    monkeypatch.setenv("STATUS_CHECKER_ENABLED", "false")
    assert Settings().status_checker_enabled is False


def test_switch_is_not_persisted_to_scan_config(tmp_path, monkeypatch):
    """The UI writes scan_config.json; it must never carry this switch."""
    from app.core.config import Settings

    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "homelab.db"))
    monkeypatch.setenv("STATUS_CHECKER_ENABLED", "false")
    s = Settings()
    (tmp_path / "scan_config.json").write_text('{"status_checker_enabled": true}')
    s.load_overrides()
    assert s.status_checker_enabled is False


def test_start_scheduler_registers_no_check_job_when_disabled():
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as s, \
         patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched):
        _configure(s, checker=False, services=True)
        start_scheduler()
    assert "status_checks" not in _job_ids(mock_sched)
    assert "service_checks" not in _job_ids(mock_sched)
    mock_sched.start.assert_called_once()


def test_start_scheduler_logs_that_checks_are_disabled(caplog):
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as s, \
         patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched), \
         caplog.at_level("INFO", logger="app.core.scheduler"):
        _configure(s, checker=False)
        start_scheduler()
    assert "status checks disabled (STATUS_CHECKER_ENABLED=false)" in caplog.text


def test_start_scheduler_unchanged_when_enabled():
    mock_sched = MagicMock()
    with patch("app.core.scheduler.settings") as s, \
         patch("app.core.scheduler.AsyncIOScheduler", return_value=mock_sched):
        _configure(s, checker=True, services=True)
        start_scheduler()
    assert "status_checks" in _job_ids(mock_sched)
    assert "service_checks" in _job_ids(mock_sched)


@pytest.mark.asyncio
async def test_run_status_checks_is_inert_when_disabled():
    with patch("app.core.scheduler.settings") as s, \
         patch("app.core.scheduler.AsyncSessionLocal") as sessions, \
         patch("app.core.scheduler.check_node", new_callable=AsyncMock) as check:
        _configure(s, checker=False)
        await _run_status_checks()
    sessions.assert_not_called()
    check.assert_not_called()


@pytest.mark.asyncio
async def test_run_service_checks_is_inert_when_disabled_even_if_services_on():
    with patch("app.core.scheduler.settings") as s, \
         patch("app.core.scheduler.AsyncSessionLocal") as sessions, \
         patch("app.core.scheduler.check_services", new_callable=AsyncMock) as check:
        _configure(s, checker=False, services=True)
        await _run_service_checks()
    sessions.assert_not_called()
    check.assert_not_called()


def test_reschedule_without_a_job_does_not_raise():
    """POST /settings calls this; with no job it used to 500 (JobLookupError)."""
    mock_sched = MagicMock()
    mock_sched.running = True
    mock_sched.get_job.return_value = None
    with patch("app.core.scheduler.scheduler", mock_sched):
        reschedule_status_checks(60)
    mock_sched.reschedule_job.assert_not_called()


def test_enabling_service_checks_is_refused_when_disabled():
    mock_sched = MagicMock()
    mock_sched.running = True
    mock_sched.get_job.return_value = None
    with patch("app.core.scheduler.scheduler", mock_sched), \
         patch("app.core.scheduler.settings") as s:
        _configure(s, checker=False)
        set_service_checks_enabled(True)
    mock_sched.add_job.assert_not_called()
