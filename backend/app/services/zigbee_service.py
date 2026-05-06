"""Zigbee2MQTT service: connects to MQTT broker and fetches the network map."""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
from typing import Any

logger = logging.getLogger(__name__)

try:
    import aiomqtt
except ImportError:  # pragma: no cover
    aiomqtt = None  # type: ignore[assignment]

_NETWORKMAP_REQUEST_TOPIC = "{base_topic}/bridge/request/networkmap"
_NETWORKMAP_RESPONSE_TOPIC = "{base_topic}/bridge/response/networkmap"
_CONNECTION_TIMEOUT = 5.0   # seconds to verify broker reachability
_NETWORKMAP_TIMEOUT = 10.0  # seconds to wait for the networkmap response


def _build_tls_context(insecure: bool) -> ssl.SSLContext:
    """Build an SSL context for MQTT TLS. If insecure, skip verification."""
    ctx = ssl.create_default_context()
    if insecure:
        logger.warning(
            "MQTT TLS certificate verification is DISABLED — "
            "use only with self-signed brokers on trusted networks."
        )
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _z2m_type_to_homelable(device_type: str) -> str:
    """Map a Z2M device type string to a homelable node type."""
    mapping = {
        "Coordinator": "zigbee_coordinator",
        "Router": "zigbee_router",
        "EndDevice": "zigbee_enddevice",
    }
    return mapping.get(device_type, "zigbee_enddevice")


def parse_networkmap(
    payload: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a Z2M networkmap response payload into node + edge lists.

    Returns:
        (nodes, edges) where each node/edge is a plain dict with the fields
        expected by ZigbeeNodeOut / ZigbeeEdgeOut.
    """
    data: dict[str, Any] = payload.get("data", {})
    routes: list[dict[str, Any]] = data.get("routes", [])

    nodes_list: list[dict[str, Any]] = []
    edges_list: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    # Coordinator is always present; find it first so we can wire the hierarchy
    coordinator_id: str | None = None

    for route in routes:
        source: dict[str, Any] = route.get("source", {})
        if not source:
            continue

        ieee: str = source.get("ieeeAddr") or source.get("ieee_address") or ""
        if not ieee:
            continue

        device_type: str = source.get("type", "EndDevice")
        friendly_name: str = (
            source.get("friendlyName") or source.get("friendly_name") or ieee
        )
        model: str | None = source.get("modelID") or source.get("model") or None
        vendor: str | None = source.get("vendor") or None

        if ieee not in seen_ids:
            seen_ids.add(ieee)
            node_type = _z2m_type_to_homelable(device_type)
            node: dict[str, Any] = {
                "id": ieee,
                "label": friendly_name,
                "type": node_type,
                "ieee_address": ieee,
                "friendly_name": friendly_name,
                "device_type": device_type,
                "model": model,
                "vendor": vendor,
                "lqi": None,
                "parent_id": None,
            }
            nodes_list.append(node)
            if device_type == "Coordinator":
                coordinator_id = ieee

        # Walk the route targets to build edges and collect additional nodes
        targets: list[dict[str, Any]] = route.get("routes", [])
        for target_entry in targets:
            target_src: dict[str, Any] = target_entry.get("target", {})
            target_ieee: str = (
                target_src.get("ieeeAddr") or target_src.get("ieee_address") or ""
            )
            lqi: int | None = target_entry.get("lqi")

            if not target_ieee:
                continue

            if target_ieee not in seen_ids:
                seen_ids.add(target_ieee)
                t_type: str = target_src.get("type", "EndDevice")
                t_fn: str = (
                    target_src.get("friendlyName")
                    or target_src.get("friendly_name")
                    or target_ieee
                )
                t_model: str | None = (
                    target_src.get("modelID") or target_src.get("model") or None
                )
                t_vendor: str | None = target_src.get("vendor") or None
                t_node: dict[str, Any] = {
                    "id": target_ieee,
                    "label": t_fn,
                    "type": _z2m_type_to_homelable(t_type),
                    "ieee_address": target_ieee,
                    "friendly_name": t_fn,
                    "device_type": t_type,
                    "model": t_model,
                    "vendor": t_vendor,
                    "lqi": lqi,
                    "parent_id": None,
                }
                nodes_list.append(t_node)

            edges_list.append({"source": ieee, "target": target_ieee})

    # Build parent_id hierarchy: coordinator → routers → end devices
    if coordinator_id:
        router_ids = {n["id"] for n in nodes_list if n["device_type"] == "Router"}
        for node in nodes_list:
            if node["device_type"] == "Router":
                node["parent_id"] = coordinator_id
            elif node["device_type"] == "EndDevice":
                parent = _find_parent_router(node["id"], router_ids, edges_list)
                node["parent_id"] = parent or coordinator_id

    return nodes_list, edges_list


def _find_parent_router(
    device_id: str,
    router_ids: set[str],
    edges: list[dict[str, Any]],
) -> str | None:
    """Return the first router that has a direct edge to device_id."""
    for edge in edges:
        src: str = edge["source"]
        tgt: str = edge["target"]
        if tgt == device_id and src in router_ids:
            return src
        if src == device_id and tgt in router_ids:
            return tgt
    return None


async def fetch_networkmap(
    mqtt_host: str,
    mqtt_port: int,
    base_topic: str,
    username: str | None = None,
    password: str | None = None,
    tls: bool = False,
    tls_insecure: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Connect to the MQTT broker, request the Z2M networkmap, and return (nodes, edges).

    Raises:
        TimeoutError: if the broker does not respond in time.
        ConnectionError: if the broker cannot be reached.
        ValueError: if the response payload is malformed.
    """
    if aiomqtt is None:  # pragma: no cover
        raise ImportError(
            "aiomqtt is required for Zigbee import. "
            "Install it with: pip install aiomqtt"
        )

    request_topic = _NETWORKMAP_REQUEST_TOPIC.format(base_topic=base_topic)
    response_topic = _NETWORKMAP_RESPONSE_TOPIC.format(base_topic=base_topic)

    result_event: asyncio.Event = asyncio.Event()
    response_payload: dict[str, Any] = {}

    tls_context = _build_tls_context(tls_insecure) if tls else None

    try:
        async with aiomqtt.Client(
            hostname=mqtt_host,
            port=mqtt_port,
            username=username,
            password=password,
            timeout=_CONNECTION_TIMEOUT,
            tls_context=tls_context,
        ) as client:
            await client.subscribe(response_topic)
            await client.publish(
                request_topic,
                json.dumps({"type": "raw", "routes": False}),
            )

            async def _wait_for_response() -> None:
                async for message in client.messages:
                    if str(message.topic) == response_topic:
                        raw = message.payload
                        try:
                            payload_str = (
                                raw.decode() if isinstance(raw, bytes | bytearray) else str(raw)
                            )
                            response_payload.update(json.loads(payload_str))
                        except (json.JSONDecodeError, TypeError) as exc:
                            raise ValueError(
                                f"Malformed networkmap response: {exc}"
                            ) from exc
                        result_event.set()
                        break

            await asyncio.wait_for(_wait_for_response(), timeout=_NETWORKMAP_TIMEOUT)

    except aiomqtt.MqttError as exc:
        raise ConnectionError(f"MQTT connection failed: {exc}") from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"Timed out waiting for networkmap response from {mqtt_host}:{mqtt_port}"
        ) from exc

    if not response_payload:
        raise ValueError("Empty networkmap response received")

    return parse_networkmap(response_payload)


async def test_mqtt_connection(
    mqtt_host: str,
    mqtt_port: int,
    username: str | None = None,
    password: str | None = None,
    tls: bool = False,
    tls_insecure: bool = False,
) -> bool:
    """Attempt a quick MQTT connection to verify broker reachability.

    Returns True on success, raises ConnectionError on failure.
    """
    if aiomqtt is None:  # pragma: no cover
        raise ImportError("aiomqtt is required")

    tls_context = _build_tls_context(tls_insecure) if tls else None

    try:
        async with aiomqtt.Client(
            hostname=mqtt_host,
            port=mqtt_port,
            username=username,
            password=password,
            timeout=_CONNECTION_TIMEOUT,
            tls_context=tls_context,
        ):
            return True
    except aiomqtt.MqttError as exc:
        raise ConnectionError(f"MQTT connection failed: {exc}") from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"Connection to {mqtt_host}:{mqtt_port} timed out"
        ) from exc
