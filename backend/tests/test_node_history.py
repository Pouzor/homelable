import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.db.models import Node, NodeStatusLog


@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_node_history_filters_by_date(client: AsyncClient, db_session, headers):
    node = Node(
        id=str(uuid.uuid4()),
        type="server",
        label="NAS",
        status="online",
        services=[],
        pos_x=0,
        pos_y=0,
    )
    db_session.add(node)
    await db_session.commit()

    old_time = datetime.now(timezone.utc) - timedelta(days=3)
    new_time = datetime.now(timezone.utc)
    db_session.add_all([
        NodeStatusLog(node_id=node.id, status="offline", checked_at=old_time),
        NodeStatusLog(node_id=node.id, status="online", checked_at=new_time),
    ])
    await db_session.commit()

    start_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    res = await client.get("/api/v1/node-history", headers=headers, params={"start_date": start_date})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["node_label"] == "NAS"
    assert data[0]["status"] == "online"
