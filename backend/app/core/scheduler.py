"""APScheduler setup for background scan and status check jobs."""
import asyncio
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.models import Node, NodeStatusLog, ScanRun
from app.services.scanner import run_scan
from app.services.status_checker import check_node

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler = AsyncIOScheduler()


async def _check_single_node(
    node_id: str,
    check_method: str,
    check_target: str | None,
    ip: str | None,
) -> tuple[str, dict[str, object] | None]:
    """Run a single node check; returns (node_id, result_or_None)."""
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
                db.add(NodeStatusLog(
                    node_id=node_id,
                    status=check_result["status"],
                    response_time_ms=check_result["response_time_ms"],
                    checked_at=now,
                ))
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


async def _run_scheduled_scan() -> None:
    ranges = [cidr for cidr in settings.scanner_ranges if cidr]
    if not ranges:
        logger.warning("Automatic scan skipped: no CIDR ranges configured")
        return

    async with AsyncSessionLocal() as db:
        running = await db.execute(select(ScanRun).where(ScanRun.status == "running").limit(1))
        if running.scalar_one_or_none() is not None:
            logger.info("Automatic scan skipped: another scan is already running")
            return

        run = ScanRun(status="running", ranges=ranges)
        db.add(run)
        await db.commit()
        await db.refresh(run)

        await run_scan(ranges, db, run.id)


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
    if settings.scan_interval_seconds > 0:
        scheduler.add_job(
            _run_scheduled_scan,
            "interval",
            seconds=settings.scan_interval_seconds,
            id="scheduled_scan",
            max_instances=1,
            coalesce=True,
        )
    scheduler.start()
    if settings.scan_interval_seconds > 0:
        logger.info(
            "Scheduler started: status checks every %ds, auto-scan every %ds",
            settings.status_checker_interval,
            settings.scan_interval_seconds,
        )
    else:
        logger.info("Scheduler started: status checks every %ds, auto-scan disabled", settings.status_checker_interval)


def reschedule_status_checks(interval_seconds: int) -> None:
    """Update the status check interval on the running scheduler."""
    if interval_seconds < 10:
        raise ValueError(f"interval_seconds must be >= 10, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    scheduler.reschedule_job("status_checks", trigger="interval", seconds=interval_seconds)
    logger.info("Status checks rescheduled to every %ds", interval_seconds)


def reschedule_auto_scan(interval_seconds: int) -> None:
    if interval_seconds < 0:
        raise ValueError(f"interval_seconds must be >= 0, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping auto-scan reschedule")
        return
    if interval_seconds == 0:
        try:
            scheduler.remove_job("scheduled_scan")
        except Exception:
            pass
        logger.info("Automatic scan disabled")
        return
    try:
        scheduler.reschedule_job("scheduled_scan", trigger="interval", seconds=interval_seconds)
    except Exception:
        scheduler.add_job(
            _run_scheduled_scan,
            "interval",
            seconds=interval_seconds,
            id="scheduled_scan",
            max_instances=1,
            coalesce=True,
        )
    logger.info("Automatic scan rescheduled to every %ds", interval_seconds)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
