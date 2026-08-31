"""Unit tests for the in-process canvas-import job registry."""

from __future__ import annotations

import pytest

from app.services import import_jobs
from app.services.import_jobs import (
    create_job,
    fail_job,
    finish_job,
    get_job,
    reset_jobs,
)


@pytest.fixture(autouse=True)
def _clean() -> None:
    reset_jobs()


def test_create_job_starts_running_with_unique_id() -> None:
    a = create_job()
    b = create_job()
    assert a.id != b.id
    assert a.status == "running"
    assert a.result is None
    assert a.error is None


def test_get_job_returns_the_registered_job() -> None:
    job = create_job()
    assert get_job(job.id) is job


def test_get_unknown_job_returns_none() -> None:
    assert get_job("nope") is None


def test_finish_job_records_the_payload() -> None:
    job = create_job()
    finish_job(job.id, {"device_count": 3})
    stored = get_job(job.id)
    assert stored is not None
    assert stored.status == "done"
    assert stored.result == {"device_count": 3}
    assert stored.finished_at is not None


def test_fail_job_records_message_and_status() -> None:
    job = create_job()
    fail_job(job.id, "broker unreachable", 502)
    stored = get_job(job.id)
    assert stored is not None
    assert stored.status == "error"
    assert stored.error == "broker unreachable"
    assert stored.error_status == 502


def test_finish_and_fail_are_noops_for_unknown_ids() -> None:
    finish_job("gone", {"device_count": 0})
    fail_job("gone", "boom", 500)
    assert get_job("gone") is None


def test_finished_jobs_expire_after_the_ttl(monkeypatch) -> None:
    clock = {"now": 0.0}
    monkeypatch.setattr(import_jobs.time, "monotonic", lambda: clock["now"])

    job = create_job()
    finish_job(job.id, {"device_count": 1})

    clock["now"] = import_jobs.JOB_TTL_SECONDS + 1
    assert get_job(job.id) is None


def test_running_jobs_never_expire(monkeypatch) -> None:
    """A slow mesh must not have its job purged out from under it."""
    clock = {"now": 0.0}
    monkeypatch.setattr(import_jobs.time, "monotonic", lambda: clock["now"])

    job = create_job()
    clock["now"] = import_jobs.JOB_TTL_SECONDS * 10
    assert get_job(job.id) is not None


def test_reset_jobs_clears_everything() -> None:
    job = create_job()
    reset_jobs()
    assert get_job(job.id) is None
