"""Zigbee2MQTT service: connects to MQTT broker and fetches the network map."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.core.config import settings
from app.services.mqtt_common import _build_tls_context, _sanitize_mqtt_error

logger = logging.getLogger(__name__)

try:
    import aiomqtt
except ImportError:  # pragma: no cover
    aiomqtt = None  # type: ignore[assignment]

_NETWORKMAP_REQUEST_TOPIC = "{base_topic}/bridge/request/networkmap"
_NETWORKMAP_RESPONSE_TOPIC = "{base_topic}/bridge/response/networkmap"
_CONNECTION_TIMEOUT = 5.0   # seconds to verify broker reachability
# Fallback wait for the networkmap response. The effective value comes from
# ``settings.zigbee_networkmap_timeout`` (env ZIGBEE_NETWORKMAP_TIMEOUT), read at
# call time so an operator with a large mesh can raise it without a code change.
_NETWORKMAP_TIMEOUT = 300.0

# Re-exported for backwards compatibility — these now live in mqtt_common.
__all__ = ["_build_tls_context", "_sanitize_mqtt_error"]


def build_zigbee_properties(
    ieee: str | None,
    vendor: str | None,
    model: str | None,
    lqi: int | None,
) -> list[dict[str, Any]]:
    """Build a NodeProperty list for a Zigbee device (IEEE, Vendor, Model, LQI).

    Only includes a row when the value is non-empty. Shape matches the
    frontend ``NodeProperty`` type: ``{key, value, icon, visible}``.

    New props default to ``visible=False`` — users opt in to showing them on
    the canvas card from the right panel.
    """
    props: list[dict[str, Any]] = []
    if ieee:
        props.append({"key": "IEEE", "value": ieee, "icon": None, "visible": False})
    if vendor:
        props.append({"key": "Vendor", "value": vendor, "icon": None, "visible": False})
    if model:
        props.append({"key": "Model", "value": model, "icon": None, "visible": False})
    if lqi is not None:
        props.append({"key": "LQI", "value": str(lqi), "icon": None, "visible": False})
    return props


def merge_zigbee_properties(
    existing: list[dict[str, Any]] | None,
    new_props: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge fresh zigbee props into an existing property list.

    For keys already present: update ``value`` but preserve the user's
    ``visible`` choice. New keys are appended with whatever visibility the
    caller gave them (hidden by default per ``build_zigbee_properties``).
    Non-zigbee custom properties are preserved untouched.
    """
    out = [dict(p) for p in (existing or [])]
    by_key = {p.get("key"): p for p in out}
    for np in new_props:
        key = np.get("key")
        if key in by_key:
            by_key[key]["value"] = np.get("value")
        else:
            out.append(dict(np))
    return out


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
    include_mesh_links: bool = False,
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

    # Z2M `links` is bidirectional/mesh: every pair appears twice and routers
    # carry sibling-mesh paths. Walk it only to extract LQI per link and to
    # resolve which router an end device hangs off; do NOT emit edges directly
    # from links. The final edge set is the strict parent→child tree built
    # from parent_id below — that avoids duplicate edges and keeps the visual
    # flow consistent (parent bottom → child top).
    raw_edges: list[dict[str, Any]] = []
    lqi_by_pair: dict[tuple[str, str], int] = {}

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
        raw_edges.append({"source": src, "target": tgt})
        # LQI belongs to the *link*, never to one endpoint. Z2M emits
        # neighbour -> reporting device, so keying it by either side attributes
        # a neighbour's measurement to a device — and leaves every EndDevice at
        # None, since a sleepy device keeps no neighbour table and is therefore
        # never a target. Keep it per ordered pair; project it below.
        # A falsy `or` would swallow a legitimate lqi == 0 (a dead link, and the
        # most interesting value of all), so test for None explicitly.
        lqi = link.get("lqi")
        if lqi is None:
            lqi = link.get("linkquality")
        if isinstance(lqi, int):
            pair = (src, tgt)
            previous = lqi_by_pair.get(pair)
            lqi_by_pair[pair] = lqi if previous is None else max(previous, lqi)

    # Build parent_id hierarchy: coordinator → routers → end devices
    if coordinator_id:
        router_ids = {n["id"] for n in nodes_list if n["device_type"] == "Router"}
        for node in nodes_list:
            if node["device_type"] == "Router":
                node["parent_id"] = coordinator_id
            elif node["device_type"] == "EndDevice":
                parent = _find_parent_router(node["id"], router_ids, raw_edges)
                node["parent_id"] = parent or coordinator_id

    # A device's LQI is a *projection* of the link to its parent, reported in
    # whichever direction Z2M measured it. Deterministic, unlike "whichever
    # neighbour happened to be listed first".
    for node in nodes_list:
        parent = node.get("parent_id")
        if not parent:
            continue
        lqi = _link_lqi(lqi_by_pair, node["id"], parent)
        if lqi is not None:
            node["lqi"] = lqi

    # Final edges = strict parent → child tree (one edge per non-coordinator)
    edges_list: list[dict[str, Any]] = [
        {
            "source": node["parent_id"],
            "target": node["id"],
            "lqi": node.get("lqi"),
            "kind": "tree",
        }
        for node in nodes_list
        if node.get("parent_id")
    ]

    # Opt-in: also emit the neighbour links the tree drops. Off by default —
    # a 37-device mesh turns ~36 tree edges into 115, which is unreadable
    # unless the user asked for it.
    if include_mesh_links:
        tree_pairs = {_pair_key(e["source"], e["target"]) for e in edges_list}
        seen_mesh: set[tuple[str, str]] = set()
        for edge in raw_edges:
            src, tgt = edge["source"], edge["target"]
            pair = _pair_key(src, tgt)
            # Z2M reports each link once per endpoint that measured it, so the
            # same pair arrives twice — collapse it to one undirected edge, and
            # never duplicate one the parent tree already draws.
            if src == tgt or pair in tree_pairs or pair in seen_mesh:
                continue
            seen_mesh.add(pair)
            edges_list.append(
                {
                    "source": src,
                    "target": tgt,
                    "lqi": _link_lqi(lqi_by_pair, src, tgt),
                    "kind": "mesh",
                }
            )

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


def _link_lqi(
    lqi_by_pair: dict[tuple[str, str], int],
    a: str,
    b: str,
) -> int | None:
    """Best LQI reported for the a<->b link, in either direction.

    Z2M reports a link once per endpoint that keeps a neighbour table, so the
    same physical link can carry two different measurements. Keep the better
    one rather than whichever was parsed first.
    """
    measured = [
        value
        for value in (lqi_by_pair.get((a, b)), lqi_by_pair.get((b, a)))
        if value is not None
    ]
    return max(measured) if measured else None


def _pair_key(a: str, b: str) -> tuple[str, str]:
    """Undirected key for a link, so A->B and B->A collapse to one edge."""
    return (a, b) if a <= b else (b, a)


async def fetch_networkmap(
    mqtt_host: str,
    mqtt_port: int,
    base_topic: str,
    username: str | None = None,
    password: str | None = None,
    tls: bool = False,
    tls_insecure: bool = False,
    response_timeout: float | None = None,
    include_mesh_links: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Connect to the MQTT broker, request the Z2M networkmap, and return (nodes, edges).

    ``include_mesh_links`` also emits the neighbour links the parent tree drops;
    see :func:`parse_networkmap`.

    ``response_timeout`` defaults to ``settings.zigbee_networkmap_timeout``
    (env ``ZIGBEE_NETWORKMAP_TIMEOUT``, 300 s) — a 200+ device mesh can take
    minutes to answer.

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

    timeout = (
        float(settings.zigbee_networkmap_timeout)
        if response_timeout is None
        else response_timeout
    )
    if timeout <= 0:
        timeout = _NETWORKMAP_TIMEOUT

    request_topic = _NETWORKMAP_REQUEST_TOPIC.format(base_topic=base_topic)
    response_topic = _NETWORKMAP_RESPONSE_TOPIC.format(base_topic=base_topic)

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
            # Give the broker a brief window to register the subscription
            # before we publish the request. Without this, brokers that
            # race SUBACK with our PUBLISH may deliver the response before
            # the subscription is active and we'd hang until timeout.
            await asyncio.sleep(0.1)
            await client.publish(
                request_topic,
                json.dumps({"type": "raw", "routes": False}),
            )

            async def _wait_for_response() -> None:
                async for message in client.messages:
                    if str(message.topic) != response_topic:
                        continue
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
                    return

            await asyncio.wait_for(_wait_for_response(), timeout=timeout)

    except aiomqtt.MqttError as exc:
        raise ConnectionError(_sanitize_mqtt_error(exc)) from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"Timed out waiting for networkmap response after {timeout:g}s — "
            "raise ZIGBEE_NETWORKMAP_TIMEOUT if your mesh is large"
        ) from exc

    if not response_payload:
        raise ValueError("Empty networkmap response received")

    return parse_networkmap(response_payload, include_mesh_links)


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
