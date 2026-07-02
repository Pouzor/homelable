"""APScheduler setup for background scan and status check jobs."""
import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.models import Node
from app.services.status_checker import check_node, check_services

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler = AsyncIOScheduler()


async def _check_single_node(
    node_id: str,
    check_method: str,
    check_target: str | None,
    ip: str | None,
) -> tuple[str, dict[str, object] | None]:
    """Run a single node check; returns (node_id, result_or_None).

    Accepts plain scalars — not an ORM object — so there is no risk of
    DetachedInstanceError when the originating session has already closed.
    """
    from app.api.routes.status import broadcast_status  # avoid circular import

    try:
        check_result = await check_node(check_method, check_target, ip)
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            n = await db.get(Node, node_id)
            if n:
                n.status = check_result["status"]
                n.response_time_ms = check_result["response_time_ms"]
                if check_result["status"] == "online":
                    n.last_seen = now
                await db.commit()
        await broadcast_status(
            node_id=node_id,
            status=check_result["status"],
            checked_at=now.isoformat(),
            response_time_ms=check_result["response_time_ms"],
        )
        return node_id, check_result
    except Exception as exc:
        logger.error("Status check failed for node %s: %s", node_id, exc)
        return node_id, None


async def _run_status_checks() -> None:
    """Check all nodes concurrently and broadcast results via WebSocket."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Node))
        nodes = result.scalars().all()
        # Extract scalars while the session is open to avoid DetachedInstanceError
        checkable = [
            (n.id, n.check_method, n.check_target, n.ip)
            for n in nodes
            if n.check_method
        ]

    if not checkable:
        return

    await asyncio.gather(*[
        _check_single_node(node_id, method, target, ip)
        for node_id, method, target, ip in checkable
    ])


def _node_host(ip: str | None, hostname: str | None) -> str | None:
    """Pick the address to probe services on: first IP, else hostname."""
    if ip:
        first = ip.split(",")[0].strip()
        if first:
            return first
    return hostname or None


async def _run_service_checks() -> None:
    """Check every service of every node and broadcast per-service results."""
    if not settings.service_check_enabled:
        return
    from app.api.routes.status import broadcast_service_status  # avoid circular import

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Node))
        nodes = result.scalars().all()
        checkable = [
            (n.id, _node_host(n.ip, n.hostname), list(n.services or []))
            for n in nodes
            if n.services
        ]

    now = datetime.now(timezone.utc).isoformat()
    for node_id, host, services in checkable:
        try:
            statuses = await check_services(host, services)
            await broadcast_service_status(node_id=node_id, services=statuses, checked_at=now)
        except Exception as exc:
            logger.error("Service checks failed for node %s: %s", node_id, exc)


def _add_service_check_job() -> None:
    scheduler.add_job(
        _run_service_checks,
        "interval",
        seconds=settings.service_check_interval,
        id="service_checks",
        max_instances=1,
        coalesce=True,
    )


def start_scheduler() -> None:
    global scheduler
    if scheduler.running:
        try:
            scheduler.shutdown(wait=False)
        except Exception as exc:
            logger.warning("Failed to shut down previous scheduler instance: %s", exc)
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_status_checks,
        "interval",
        seconds=settings.status_checker_interval,
        id="status_checks",
        max_instances=1,
        coalesce=True,
    )
    if settings.service_check_enabled:
        _add_service_check_job()
    scheduler.start()
    logger.info("Scheduler started — status checks every %ds", settings.status_checker_interval)


def reschedule_status_checks(interval_seconds: int) -> None:
    """Update the status check interval on the running scheduler."""
    if interval_seconds < 10:
        raise ValueError(f"interval_seconds must be >= 10, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    scheduler.reschedule_job("status_checks", trigger="interval", seconds=interval_seconds)
    logger.info("Status checks rescheduled to every %ds", interval_seconds)


def reschedule_service_checks(interval_seconds: int) -> None:
    """Update the service-check interval on the running scheduler (if enabled)."""
    if interval_seconds < 30:
        raise ValueError(f"interval_seconds must be >= 30, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    if scheduler.get_job("service_checks"):
        scheduler.reschedule_job("service_checks", trigger="interval", seconds=interval_seconds)
        logger.info("Service checks rescheduled to every %ds", interval_seconds)


def set_service_checks_enabled(enabled: bool) -> None:
    """Add or remove the service-check job on the running scheduler."""
    if not scheduler.running:
        return
    job = scheduler.get_job("service_checks")
    if enabled and not job:
        _add_service_check_job()
        logger.info("Service checks enabled — every %ds", settings.service_check_interval)
    elif not enabled and job:
        scheduler.remove_job("service_checks")
        logger.info("Service checks disabled")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
