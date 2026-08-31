"""In-process registry for long-running import jobs that return a payload.

Pending imports already run in the background and report through ``scan_runs``.
Canvas imports are different: the caller wants the fetched map *back* so it can
drop it on the canvas, which kept the request open for the whole MQTT
round-trip. On a large mesh that outlives any reverse proxy's read timeout
(Cloudflare cuts at 100 s and returns a 524), so the browser never sees the
result even though the fetch succeeded server-side.

The fix is to hand the client a job id immediately and let it poll. Results are
transient — a canvas import is meaningless once the user has closed the modal —
so they live in memory rather than the DB, and expire on a TTL. The backend runs
a single uvicorn worker, the same assumption the scheduler and ``BackgroundTasks``
already make.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

JobStatus = Literal["running", "done", "error"]

# How long a finished job stays readable. Long enough for a client that polls
# slowly or reloads mid-import, short enough that a forgotten map is not held
# for the life of the process.
JOB_TTL_SECONDS = 900.0


@dataclass
class ImportJob:
    id: str
    status: JobStatus = "running"
    result: dict[str, Any] | None = None
    error: str | None = None
    # HTTP status the synchronous route would have raised, so the client can
    # keep reacting to failures the way it always has.
    error_status: int | None = None
    created_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None


_jobs: dict[str, ImportJob] = {}


def _purge_expired(now: float) -> None:
    for job_id, job in list(_jobs.items()):
        if job.finished_at is not None and now - job.finished_at > JOB_TTL_SECONDS:
            del _jobs[job_id]


def create_job() -> ImportJob:
    """Register a new running job and return it."""
    now = time.monotonic()
    _purge_expired(now)
    job = ImportJob(id=str(uuid.uuid4()))
    _jobs[job.id] = job
    return job


def get_job(job_id: str) -> ImportJob | None:
    """Return a job, or None if it never existed or has expired."""
    _purge_expired(time.monotonic())
    return _jobs.get(job_id)


def finish_job(job_id: str, result: dict[str, Any]) -> None:
    """Mark a job done and attach its payload. No-op if it expired."""
    job = _jobs.get(job_id)
    if job is None:
        return
    job.status = "done"
    job.result = result
    job.finished_at = time.monotonic()


def fail_job(job_id: str, error: str, status: int) -> None:
    """Mark a job failed with a client-safe message. No-op if it expired."""
    job = _jobs.get(job_id)
    if job is None:
        return
    job.status = "error"
    job.error = error
    job.error_status = status
    job.finished_at = time.monotonic()


def reset_jobs() -> None:
    """Drop every job. For tests."""
    _jobs.clear()
