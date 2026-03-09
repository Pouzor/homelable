"""APScheduler setup for background scan and status check jobs."""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.models import Node
from app.services.status_checker import check_node

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler = AsyncIOScheduler()


async def _run_status_checks() -> None:
    """Check all nodes and broadcast results via WebSocket."""
    from app.api.routes.status import broadcast_status  # avoid circular import

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Node))
        nodes = result.scalars().all()

    for node in nodes:
        if not node.check_method:
            continue
        try:
            check_result = await check_node(node.check_method, node.check_target, node.ip)
            async with AsyncSessionLocal() as db:
                n = await db.get(Node, node.id)
                if n:
                    n.status = check_result["status"]
                    n.response_time_ms = check_result["response_time_ms"]
                    n.last_seen = datetime.now(timezone.utc) if check_result["status"] == "online" else n.last_seen
                    await db.commit()
            await broadcast_status(
                node_id=node.id,
                status=check_result["status"],
                checked_at=datetime.now(timezone.utc).isoformat(),
                response_time_ms=check_result["response_time_ms"],
            )
        except Exception as exc:
            logger.error("Status check failed for node %s: %s", node.id, exc)


def start_scheduler() -> None:
    global scheduler
    scheduler = AsyncIOScheduler()
    scheduler.add_job(_run_status_checks, "interval", seconds=settings.status_checker_interval, id="status_checks")
    scheduler.start()
    logger.info("Scheduler started — status checks every %ds", settings.status_checker_interval)


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
