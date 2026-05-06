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
_NETWORKMAP_TIMEOUT = 180.0  # seconds to wait for the networkmap response (large meshes can be slow)


def _sanitize_mqtt_error(exc: BaseException) -> str:
    """Return a generic, credential-free message for an MQTT error.

    The raw aiomqtt/paho error string can include the broker URI with
    embedded credentials (e.g. ``mqtt://user:pass@host``) or auth-related
    detail that should not leak to API clients. Map known patterns to
    coarse categories; default to a generic failure message. The original
    exception is logged at WARNING level for operator debugging.
    """
    logger.warning("MQTT error (sanitized for client): %r", exc)
    raw = str(exc).lower()
    if "not authoriz" in raw or "bad user" in raw or "bad username" in raw:
        return "Authentication failed"
    if "refused" in raw:
        return "Connection refused by broker"
    if "name or service not known" in raw or "getaddrinfo" in raw or "nodename nor servname" in raw:
        return "Broker hostname could not be resolved"
    if "ssl" in raw or "tls" in raw or "certificate" in raw:
        return "TLS handshake failed"
    if "timed out" in raw or "timeout" in raw:
        return "Connection to broker timed out"
    return "MQTT connection failed"


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


def _node_from_z2m(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Build a homelable node dict from a Z2M raw networkmap node entry."""
    ieee: str = raw.get("ieeeAddr") or raw.get("ieee_address") or ""
    if not ieee:
        return None
    device_type: str = raw.get("type") or "EndDevice"
    friendly_name: str = (
        raw.get("friendlyName") or raw.get("friendly_name") or ieee
    )
    definition: dict[str, Any] = raw.get("definition") or {}
    model: str | None = (
        raw.get("modelID")
        or raw.get("model")
        or definition.get("model")
        or None
    )
    vendor: str | None = raw.get("vendor") or definition.get("vendor") or None
    return {
        "id": ieee,
        "label": friendly_name,
        "type": _z2m_type_to_homelable(device_type),
        "ieee_address": ieee,
        "friendly_name": friendly_name,
        "device_type": device_type,
        "model": model,
        "vendor": vendor,
        "lqi": None,
        "parent_id": None,
    }


def parse_networkmap(
    payload: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a Z2M ``bridge/response/networkmap`` payload into node + edge lists.

    Z2M raw response shape::

        {
          "data": {
            "type": "raw",
            "routes": false,
            "value": {
              "nodes": [{"ieeeAddr": ..., "type": "Coordinator|Router|EndDevice",
                         "friendlyName": ..., "definition": {"model": ..., "vendor": ...}}],
              "links": [{"source": {"ieeeAddr": ...}, "target": {"ieeeAddr": ...},
                         "lqi": 200, "depth": 1}]
            }
          },
          "status": "ok"
        }

    Older or alternate shapes may put nodes/links directly under ``data``.
    Both are accepted.
    """
    data: dict[str, Any] = payload.get("data") or {}
    value = data.get("value")
    container: dict[str, Any] = value if isinstance(value, dict) else data

    raw_nodes: list[dict[str, Any]] = container.get("nodes") or []
    raw_links: list[dict[str, Any]] = container.get("links") or []

    if not isinstance(raw_nodes, list):
        raise ValueError("Malformed networkmap: 'nodes' is not a list")
    if not isinstance(raw_links, list):
        raise ValueError("Malformed networkmap: 'links' is not a list")

    nodes_list: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    coordinator_id: str | None = None

    for entry in raw_nodes:
        if not isinstance(entry, dict):
            continue
        node = _node_from_z2m(entry)
        if node is None or node["id"] in seen_ids:
            continue
        seen_ids.add(node["id"])
        nodes_list.append(node)
        if node["device_type"] == "Coordinator":
            coordinator_id = node["id"]

    edges_list: list[dict[str, Any]] = []
    lqi_by_id: dict[str, int] = {}

    for link in raw_links:
        if not isinstance(link, dict):
            continue
        src_obj = link.get("source") or {}
        tgt_obj = link.get("target") or {}
        src = src_obj.get("ieeeAddr") if isinstance(src_obj, dict) else None
        tgt = tgt_obj.get("ieeeAddr") if isinstance(tgt_obj, dict) else None
        if not src or not tgt:
            continue
        if src not in seen_ids or tgt not in seen_ids:
            continue
        edges_list.append({"source": src, "target": tgt})
        lqi = link.get("lqi") or link.get("linkquality")
        if isinstance(lqi, int) and tgt not in lqi_by_id:
            lqi_by_id[tgt] = lqi

    for node in nodes_list:
        if node["id"] in lqi_by_id:
            node["lqi"] = lqi_by_id[node["id"]]

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
        raise ConnectionError(_sanitize_mqtt_error(exc)) from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError("Timed out waiting for networkmap response") from exc

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
        raise ConnectionError(_sanitize_mqtt_error(exc)) from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError("Connection to broker timed out") from exc
