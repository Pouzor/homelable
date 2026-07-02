import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token

router = APIRouter()

# Active WebSocket connections
_connections: list[WebSocket] = []


def _drop(websocket: WebSocket) -> None:
    """Remove a connection if still present — idempotent, never raises."""
    with contextlib.suppress(ValueError):
        _connections.remove(websocket)


@router.websocket("/ws/status")
async def ws_status(websocket: WebSocket) -> None:
    # Accept first so we can send a close frame with a reason code
    await websocket.accept()
    try:
        # Expect the first message to be a JSON auth payload: {"token": "<jwt>"}
        raw = await websocket.receive_text()
        try:
            payload = json.loads(raw)
            token = payload.get("token", "")
        except (json.JSONDecodeError, AttributeError):
            token = ""
        if not token or not decode_token(token):
            await websocket.close(code=1008)  # Policy Violation
            return
    except WebSocketDisconnect:
        return

    _connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        # Any error (disconnect or otherwise) must release the slot, else the
        # dead socket lingers in the broadcast pool.
        _drop(websocket)


async def _broadcast(payload: str) -> None:
    for conn in list(_connections):
        try:
            await conn.send_text(payload)
        except Exception:
            _drop(conn)


async def broadcast_status(node_id: str, status: str, checked_at: str, response_time_ms: int | None = None) -> None:
    await _broadcast(json.dumps({
        "type": "status",
        "node_id": node_id,
        "status": status,
        "checked_at": checked_at,
        "response_time_ms": response_time_ms,
    }))


async def broadcast_service_status(node_id: str, services: list[dict[str, object]], checked_at: str) -> None:
    await _broadcast(json.dumps({
        "type": "service_status",
        "node_id": node_id,
        "services": services,
        "checked_at": checked_at,
    }))


async def broadcast_scan_update(run_id: str, devices_found: int) -> None:
    await _broadcast(json.dumps({
        "type": "scan_device_found",
        "run_id": run_id,
        "devices_found": devices_found,
    }))
