"""APScheduler setup for background scan and status check jobs."""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.models import Node
from app.services.status_checker import check_node

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler = AsyncIOScheduler()

async def _check_single_node(
    node_id: str,
    check_method: str,
    check_target: str | None,
    ip: str | None,
) -> tuple[str, dict[str, Any] | None]:
    """Run a single node check; returns (node_id, result_or_None).
    
    Accepts plain scalars — not an ORM object — so there is no risk of
    DetachedInstanceError when the originating session has already closed.
    """
    from app.api.routes.status import broadcast_status  # avoid circular import

    try:
        # 1. Fetch properties before check for credentials (e.g., Proxmox API)
        properties = []
        async with AsyncSessionLocal() as db:
            n = await db.get(Node, node_id)
            if n:
                properties = n.properties

        # 2. Execute the status check
        node_data = {
            "check_method": check_method,
            "check_target": check_target,
            "ip": ip,
            "properties": properties
        }
        check_result = await check_node(node_data)
        
        # 3. Update database and broadcast to frontend
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            n = await db.get(Node, node_id)
            if n:
                n.status = check_result["status"]
                if check_result.get("response_time_ms") is not None:
                    n.response_time_ms = check_result["response_time_ms"]
                
                await db.commit()
                
                # Broadcast real-time update to WebSocket clients
                await broadcast_status(
                  node_id=node_id,
                  status=check_result["status"],
                  checked_at=now.isoformat(),
                  response_time_ms=check_result.get("response_time_ms"),
             )

        return node_id, check_result

    except Exception as exc:
        logger.error("Failed to check node %s: %s", node_id, exc)
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

def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")