"""Home Assistant ZHA service: fetches Zigbee devices via HA's WebSocket API.

Alternative to ``zigbee_service``'s Zigbee2MQTT networkmap path, for operators
running Home Assistant's native ZHA integration who have no MQTT broker (and
no Zigbee2MQTT) in the picture — selected via ``settings.zigbee_source ==
"ha_api"``. Produces the same node/edge dict shape ``zigbee_service`` does, so
the import routes and ``_persist_pending_import`` stay source-agnostic.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.services.zigbee_service import _z2m_type_to_homelable

logger = logging.getLogger(__name__)

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None  # type: ignore[assignment]

# Seconds to establish the websocket connection, authenticate, and get the
# zha/devices result back. HA's device list is a single bounded response (no
# mesh-sized wait like Z2M's networkmap), so one short budget covers it all.
_CALL_TIMEOUT = 15.0


def _ws_url(ha_url: str) -> str:
    """Turn a Home Assistant base URL into its websocket API endpoint."""
    parts = urlsplit(ha_url)
    scheme = "wss" if parts.scheme == "https" else "ws"
    return urlunsplit((scheme, parts.netloc, "/api/websocket", "", ""))


def _sanitize_ha_error(exc: BaseException) -> str:
    """Return a generic, token-free message for a Home Assistant API error."""
    logger.warning("Home Assistant API error (sanitized for client): %r", exc)
    raw = str(exc).lower()
    if "refused" in raw:
        return "Connection refused by Home Assistant"
    if "name or service not known" in raw or "getaddrinfo" in raw:
        return "Home Assistant hostname could not be resolved"
    if "ssl" in raw or "tls" in raw or "certificate" in raw:
        return "TLS handshake failed"
    return "Home Assistant connection failed"


def _node_from_zha(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build a homelable node dict from a ``zha/devices`` entry."""
    ieee: str = raw.get("ieee") or ""
    if not ieee:
        return None
    device_type: str = raw.get("device_type") or "EndDevice"
    friendly_name: str = raw.get("user_given_name") or raw.get("name") or ieee
    return {
        "id": ieee,
        "label": friendly_name,
        "type": _z2m_type_to_homelable(device_type),
        "ieee_address": ieee,
        "friendly_name": friendly_name,
        "device_type": device_type,
        "model": raw.get("model") or None,
        "vendor": raw.get("manufacturer") or None,
        "lqi": raw.get("lqi"),
        "parent_id": None,
    }


def parse_zha_devices(
    raw_devices: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a ``zha/devices`` result into (nodes, edges).

    HA's ZHA websocket API reports each device's own radio stats (lqi, rssi)
    but — unlike Zigbee2MQTT's networkmap — does not return the neighbour
    table needed to resolve which router an end device is actually routed
    through.
    # ponytail: every non-coordinator device is attached directly to the
    # coordinator (flat tree) rather than its real parent router; upgrade to
    # a real hierarchy if HA ever exposes neighbour/topology data reliably
    # through the websocket API.
    """
    nodes: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    coordinator_id: str | None = None

    for entry in raw_devices:
        if not isinstance(entry, dict):
            continue
        node = _node_from_zha(entry)
        if node is None or node["id"] in seen_ids:
            continue
        seen_ids.add(node["id"])
        nodes.append(node)
        if node["device_type"] == "Coordinator":
            coordinator_id = node["id"]

    edges: list[dict[str, Any]] = []
    if coordinator_id:
        for node in nodes:
            if node["id"] == coordinator_id:
                continue
            node["parent_id"] = coordinator_id
            edges.append(
                {
                    "source": coordinator_id,
                    "target": node["id"],
                    "lqi": node.get("lqi"),
                    "kind": "tree",
                }
            )

    return nodes, edges


async def fetch_zha_devices(
    ha_url: str, ha_token: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Connect to Home Assistant, authenticate, and fetch the ZHA device list.

    Raises:
        ImportError: if the ``websockets`` package is not installed.
        ValueError: if the connection is not configured or the response is malformed.
        ConnectionError: if Home Assistant cannot be reached or auth fails.
        TimeoutError: if the API does not respond in time.
    """
    if websockets is None:  # pragma: no cover
        raise ImportError(
            "websockets is required for the Home Assistant Zigbee source. "
            "Install it with: pip install websockets"
        )
    if not ha_url:
        raise ValueError("ZIGBEE_HA_URL is not configured")
    if not ha_token:
        raise ValueError("ZIGBEE_HA_TOKEN is not configured")

    async def _call() -> dict[str, Any]:
        async with websockets.connect(_ws_url(ha_url)) as ws:
            hello = json.loads(await ws.recv())
            if hello.get("type") != "auth_required":
                raise ValueError(
                    f"Unexpected Home Assistant handshake: {hello.get('type')}"
                )

            await ws.send(json.dumps({"type": "auth", "access_token": ha_token}))
            auth_result = json.loads(await ws.recv())
            if auth_result.get("type") != "auth_ok":
                raise ConnectionError("Authentication failed — check ZIGBEE_HA_TOKEN")

            await ws.send(json.dumps({"id": 1, "type": "zha/devices"}))
            response: dict[str, Any] = json.loads(await ws.recv())
            return response

    try:
        result = await asyncio.wait_for(_call(), timeout=_CALL_TIMEOUT)
    except (OSError, websockets.exceptions.WebSocketException) as exc:
        raise ConnectionError(_sanitize_ha_error(exc)) from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            "Timed out waiting for Home Assistant's zha/devices response"
        ) from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed Home Assistant response: {exc}") from exc

    if not result.get("success"):
        error = result.get("error") or {}
        raise ValueError(error.get("message") or "zha/devices call failed")

    devices = result.get("result")
    if not isinstance(devices, list):
        raise ValueError("Malformed zha/devices response: 'result' is not a list")

    return parse_zha_devices(devices)
