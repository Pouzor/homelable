import contextlib
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.security import (
    decode_oidc_session_token,
    decode_token,
    oidc_session_cookie_name,
    origin_is_allowed,
)

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
    if not origin_is_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)  # Policy Violation
        return

    if settings.auth_mode == "oidc":
        cookie_token = websocket.cookies.get(oidc_session_cookie_name(), "")
        if not cookie_token or decode_oidc_session_token(cookie_token) is None:
            await websocket.close(code=1008)  # Policy Violation
            return
    else:
        # Local mode keeps the existing first-message bearer protocol.
        try:
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


async def broadcast_status(
    device_id: str,
    node_ids: list[str],
    status: str,
    checked_at: str,
    response_time_ms: int | None = None,
) -> None:
    """Report one device's reachability to every canvas drawing it.

    A device is checked once, not once per canvas, so the result is addressed by
    device and carries the nodes it lights up. ``node_ids`` is empty for a
    device that is in the inventory but on no canvas.
    """
    await _broadcast(json.dumps({
        "type": "status",
        "device_id": device_id,
        "node_ids": node_ids,
        "status": status,
        "checked_at": checked_at,
        "response_time_ms": response_time_ms,
    }))


async def broadcast_service_status(
    device_id: str, node_ids: list[str], services: list[dict[str, object]], checked_at: str
) -> None:
    await _broadcast(json.dumps({
        "type": "service_status",
        "device_id": device_id,
        "node_ids": node_ids,
        "services": services,
        "checked_at": checked_at,
    }))


async def broadcast_scan_update(run_id: str, devices_found: int) -> None:
    await _broadcast(json.dumps({
        "type": "scan_device_found",
        "run_id": run_id,
        "devices_found": devices_found,
    }))
