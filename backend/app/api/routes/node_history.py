from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Node, NodeStatusLog

router = APIRouter()


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class NodeStatusHistoryItem(BaseModel):
    id: str
    node_id: str
    node_label: str
    status: str
    response_time_ms: int | None = None
    checked_at: datetime


@router.get("", response_model=list[NodeStatusHistoryItem])
async def get_node_status_history(
    node_id: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    limit: int = 5000,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[NodeStatusHistoryItem]:
    safe_limit = max(1, min(limit, 10000))
    stmt = select(NodeStatusLog, Node.label).join(Node, Node.id == NodeStatusLog.node_id)
    if node_id:
        stmt = stmt.where(NodeStatusLog.node_id == node_id)
    if start_date:
        stmt = stmt.where(NodeStatusLog.checked_at >= start_date)
    if end_date:
        stmt = stmt.where(NodeStatusLog.checked_at <= end_date)
    stmt = stmt.order_by(desc(NodeStatusLog.checked_at)).limit(safe_limit)

    result = await db.execute(stmt)
    logs = result.all()
    return [
        NodeStatusHistoryItem(
            id=log.id,
            node_id=log.node_id,
            node_label=label,
            status=log.status,
            response_time_ms=log.response_time_ms,
            checked_at=_ensure_utc(log.checked_at),
        )
        for log, label in logs
    ]
