"""Tests for WebSocket status endpoint and broadcast helpers."""
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.routes.status import (
    _connections,
    _drop,
    broadcast_scan_update,
    broadcast_service_status,
    broadcast_status,
)
from app.main import app

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_token() -> str:
    from app.core.security import create_access_token
    return create_access_token("admin")


# ---------------------------------------------------------------------------
# WebSocket authentication
# ---------------------------------------------------------------------------

def test_websocket_rejected_without_token():
    """Connection that sends no token field must be closed with 1008."""
    with TestClient(app) as client, pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/v1/status/ws/status") as ws:
        ws.send_text(json.dumps({}))  # missing token field
        ws.receive_text()  # triggers WebSocketDisconnect from server close


def test_websocket_rejected_with_invalid_token():
    """Connection that sends a garbage token must be closed."""
    with TestClient(app) as client, pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/v1/status/ws/status") as ws:
        ws.send_text(json.dumps({"token": "not-a-valid-jwt"}))
        ws.receive_text()


def test_websocket_rejected_with_malformed_json():
    """Connection that sends non-JSON as auth must be closed."""
    with TestClient(app) as client, pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/v1/status/ws/status") as ws:
        ws.send_text("not-json")
        ws.receive_text()


def test_websocket_accepted_with_valid_token():
    """Connection that sends a valid JWT as first message must be accepted."""
    token = _make_token()
    with TestClient(app) as client, client.websocket_connect("/api/v1/status/ws/status") as ws:
        ws.send_text(json.dumps({"token": token}))
        # Connection is open — subsequent messages should not raise
        ws.send_text("ping")


# ---------------------------------------------------------------------------
# broadcast_status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_broadcast_status_sends_to_connected_clients():
    """broadcast_status sends a JSON message to all active connections."""
    received: list[str] = []

    class FakeWS:
        async def send_text(self, text: str) -> None:
            received.append(text)

    fake = FakeWS()
    _connections.append(fake)
    try:
        await broadcast_status(
            node_id="node-1",
            status="online",
            checked_at="2024-01-01T00:00:00",
            response_time_ms=42,
        )
    finally:
        _connections.remove(fake)

    assert len(received) == 1
    msg = json.loads(received[0])
    assert msg["type"] == "status"
    assert msg["node_id"] == "node-1"
    assert msg["status"] == "online"
    assert msg["response_time_ms"] == 42


@pytest.mark.asyncio
async def test_broadcast_status_no_response_time():
    """response_time_ms defaults to None."""
    received: list[str] = []

    class FakeWS:
        async def send_text(self, text: str) -> None:
            received.append(text)

    fake = FakeWS()
    _connections.append(fake)
    try:
        await broadcast_status(node_id="n", status="offline", checked_at="t")
    finally:
        _connections.remove(fake)

    msg = json.loads(received[0])
    assert msg["response_time_ms"] is None


@pytest.mark.asyncio
async def test_broadcast_status_removes_dead_connection():
    """A connection that raises on send is removed from _connections."""

    class DeadWS:
        async def send_text(self, _: str) -> None:
            raise RuntimeError("disconnected")

    dead = DeadWS()
    _connections.append(dead)
    initial_len = len(_connections)

    await broadcast_status(node_id="n", status="online", checked_at="t")

    assert dead not in _connections
    assert len(_connections) == initial_len - 1


# ---------------------------------------------------------------------------
# broadcast_scan_update
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_broadcast_scan_update():
    """broadcast_scan_update sends scan_device_found payload."""
    received: list[str] = []

    class FakeWS:
        async def send_text(self, text: str) -> None:
            received.append(text)

    fake = FakeWS()
    _connections.append(fake)
    try:
        await broadcast_scan_update(run_id="run-42", devices_found=3)
    finally:
        _connections.remove(fake)

    assert len(received) == 1
    msg = json.loads(received[0])
    assert msg["type"] == "scan_device_found"
    assert msg["run_id"] == "run-42"
    assert msg["devices_found"] == 3


@pytest.mark.asyncio
async def test_broadcast_no_connections():
    """broadcast_* with no connections must not raise."""
    assert len(_connections) == 0
    await broadcast_status(node_id="n", status="online", checked_at="t")
    await broadcast_scan_update(run_id="r", devices_found=0)


# ---------------------------------------------------------------------------
# broadcast_service_status
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_broadcast_service_status_payload():
    received: list[str] = []

    class FakeWS:
        async def send_text(self, text: str) -> None:
            received.append(text)

    fake = FakeWS()
    _connections.append(fake)
    try:
        await broadcast_service_status(
            node_id="node-7",
            services=[{"port": 80, "protocol": "tcp", "status": "offline"}],
            checked_at="2024-01-01T00:00:00",
        )
    finally:
        _drop(fake)

    msg = json.loads(received[0])
    assert msg["type"] == "service_status"
    assert msg["node_id"] == "node-7"
    assert msg["services"] == [{"port": 80, "protocol": "tcp", "status": "offline"}]


# ---------------------------------------------------------------------------
# _drop — idempotent connection removal (regression for double-remove crash)
# ---------------------------------------------------------------------------

def test_drop_is_idempotent():
    """Dropping a connection twice must not raise (was a ValueError crash)."""
    class FakeWS:
        pass

    fake = FakeWS()
    _connections.append(fake)
    _drop(fake)
    _drop(fake)  # second drop must be a no-op
    assert fake not in _connections


@pytest.mark.asyncio
async def test_broadcast_dead_connection_dropped_once_safely():
    """A send failure removes the dead socket without a double-remove crash."""
    class DeadWS:
        async def send_text(self, _: str) -> None:
            raise RuntimeError("disconnected")

    dead = DeadWS()
    _connections.append(dead)
    await broadcast_status(node_id="n", status="online", checked_at="t")
    # A second broadcast must not raise even though dead is already gone.
    await broadcast_status(node_id="n", status="online", checked_at="t")
    assert dead not in _connections
