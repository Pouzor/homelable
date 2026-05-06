"""Unit tests for zigbee_service: parser and hierarchy builder."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import aiomqtt  # noqa: F401
import pytest

from app.services.zigbee_service import (
    _find_parent_router,
    _z2m_type_to_homelable,
    fetch_networkmap,
    parse_networkmap,
)
from app.services.zigbee_service import (
    test_mqtt_connection as _test_mqtt_connection,
)

# ---------------------------------------------------------------------------
# Helper builders — real Z2M `bridge/response/networkmap` shape
# (data.value.nodes + data.value.links)
# ---------------------------------------------------------------------------

def _make_node(
    ieee: str,
    device_type: str = "EndDevice",
    friendly_name: str | None = None,
    model: str | None = None,
    vendor: str | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "ieeeAddr": ieee,
        "type": device_type,
        "friendlyName": friendly_name or ieee,
    }
    if model or vendor:
        entry["definition"] = {"model": model, "vendor": vendor}
    return entry


def _make_link(source_ieee: str, target_ieee: str, lqi: int = 200) -> dict[str, Any]:
    return {
        "source": {"ieeeAddr": source_ieee},
        "target": {"ieeeAddr": target_ieee},
        "lqi": lqi,
    }


def _wrap(nodes: list[dict[str, Any]], links: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "data": {
            "type": "raw",
            "routes": False,
            "value": {"nodes": nodes, "links": links or []},
        },
        "status": "ok",
    }


# ---------------------------------------------------------------------------
# _z2m_type_to_homelable
# ---------------------------------------------------------------------------

class TestZ2mTypeToHomelable:
    def test_coordinator(self) -> None:
        assert _z2m_type_to_homelable("Coordinator") == "zigbee_coordinator"

    def test_router(self) -> None:
        assert _z2m_type_to_homelable("Router") == "zigbee_router"

    def test_enddevice(self) -> None:
        assert _z2m_type_to_homelable("EndDevice") == "zigbee_enddevice"

    def test_unknown_defaults_to_enddevice(self) -> None:
        assert _z2m_type_to_homelable("Unknown") == "zigbee_enddevice"


# ---------------------------------------------------------------------------
# parse_networkmap
# ---------------------------------------------------------------------------

class TestParseNetworkmap:
    def test_empty_payload(self) -> None:
        nodes, edges = parse_networkmap({})
        assert nodes == []
        assert edges == []

    def test_empty_value(self) -> None:
        nodes, edges = parse_networkmap(_wrap([], []))
        assert nodes == []
        assert edges == []

    def test_coordinator_only(self) -> None:
        payload = _wrap([_make_node("0x0000000000000000", "Coordinator", "Coordinator")])
        nodes, edges = parse_networkmap(payload)
        assert len(nodes) == 1
        assert nodes[0]["type"] == "zigbee_coordinator"
        assert nodes[0]["ieee_address"] == "0x0000000000000000"
        assert edges == []

    def test_coordinator_router_enddevice(self) -> None:
        coord_ieee = "0x0000000000000000"
        router_ieee = "0x0000000000000001"
        end_ieee = "0x0000000000000002"

        payload = _wrap(
            nodes=[
                _make_node(coord_ieee, "Coordinator", "Coordinator"),
                _make_node(router_ieee, "Router", "my_router"),
                _make_node(end_ieee, "EndDevice"),
            ],
            links=[
                _make_link(coord_ieee, router_ieee),
                _make_link(router_ieee, end_ieee),
            ],
        )

        nodes, edges = parse_networkmap(payload)
        node_by_id = {n["id"]: n for n in nodes}

        assert coord_ieee in node_by_id
        assert router_ieee in node_by_id
        assert end_ieee in node_by_id

        assert node_by_id[coord_ieee]["type"] == "zigbee_coordinator"
        assert node_by_id[router_ieee]["type"] == "zigbee_router"
        assert node_by_id[end_ieee]["type"] == "zigbee_enddevice"

        # Parent hierarchy
        assert node_by_id[router_ieee]["parent_id"] == coord_ieee
        assert node_by_id[end_ieee]["parent_id"] == router_ieee
        assert len(edges) == 2

    def test_no_duplicate_nodes(self) -> None:
        ieee = "0x0000000000000001"
        payload = _wrap(
            nodes=[_make_node(ieee, "Router"), _make_node(ieee, "Router")],
        )
        nodes, _ = parse_networkmap(payload)
        assert len(nodes) == 1

    def test_edges_built_correctly(self) -> None:
        coord = "0x0000"
        router = "0x0001"
        payload = _wrap(
            nodes=[_make_node(coord, "Coordinator"), _make_node(router, "Router")],
            links=[_make_link(coord, router)],
        )
        _, edges = parse_networkmap(payload)
        assert len(edges) == 1
        assert edges[0]["source"] == coord
        assert edges[0]["target"] == router

    def test_friendly_name_used_as_label(self) -> None:
        payload = _wrap([_make_node("0xABCD", "EndDevice", "Living Room Sensor")])
        nodes, _ = parse_networkmap(payload)
        assert nodes[0]["label"] == "Living Room Sensor"

    def test_enddevice_falls_back_to_coordinator_when_no_router(self) -> None:
        coord = "0x0000"
        end = "0x0003"
        payload = _wrap([_make_node(coord, "Coordinator"), _make_node(end, "EndDevice")])
        nodes, _ = parse_networkmap(payload)
        end_node = next(n for n in nodes if n["id"] == end)
        assert end_node["parent_id"] == coord

    def test_missing_ieee_skipped(self) -> None:
        payload = _wrap([{"type": "EndDevice"}])  # no ieeeAddr
        nodes, edges = parse_networkmap(payload)
        assert nodes == []
        assert edges == []

    def test_lqi_propagated_from_link_to_target_node(self) -> None:
        coord = "0x0000"
        end = "0x0001"
        payload = _wrap(
            nodes=[_make_node(coord, "Coordinator"), _make_node(end, "EndDevice")],
            links=[_make_link(coord, end, lqi=180)],
        )
        nodes, _ = parse_networkmap(payload)
        end_node = next(n for n in nodes if n["id"] == end)
        assert end_node["lqi"] == 180

    def test_definition_model_and_vendor_extracted(self) -> None:
        payload = _wrap([
            _make_node("0xAA", "EndDevice", "Sensor", model="WSDCGQ11LM", vendor="Aqara"),
        ])
        nodes, _ = parse_networkmap(payload)
        assert nodes[0]["model"] == "WSDCGQ11LM"
        assert nodes[0]["vendor"] == "Aqara"

    def test_legacy_shape_without_value_wrapper(self) -> None:
        """Some Z2M variants put nodes/links directly under data."""
        payload = {"data": {"nodes": [_make_node("0x01", "Coordinator")], "links": []}}
        nodes, _ = parse_networkmap(payload)
        assert len(nodes) == 1
        assert nodes[0]["type"] == "zigbee_coordinator"

    def test_routes_bool_is_ignored(self) -> None:
        """`routes: false` echo from the request must not crash the parser."""
        payload = {"data": {"routes": False, "type": "raw", "value": {"nodes": [], "links": []}}}
        nodes, edges = parse_networkmap(payload)
        assert nodes == []
        assert edges == []

    def test_malformed_nodes_not_list_raises(self) -> None:
        with pytest.raises(ValueError, match="not a list"):
            parse_networkmap({"data": {"value": {"nodes": "oops", "links": []}}})

    def test_link_to_unknown_node_dropped(self) -> None:
        payload = _wrap(
            nodes=[_make_node("0x01", "Coordinator")],
            links=[_make_link("0x01", "0xDEAD")],  # 0xDEAD not in nodes
        )
        _, edges = parse_networkmap(payload)
        assert edges == []


# ---------------------------------------------------------------------------
# _find_parent_router
# ---------------------------------------------------------------------------

class TestFindParentRouter:
    def test_finds_router_as_source(self) -> None:
        router_ids = {"r1"}
        edges = [{"source": "r1", "target": "e1"}]
        assert _find_parent_router("e1", router_ids, edges) == "r1"

    def test_finds_router_as_target(self) -> None:
        router_ids = {"r1"}
        edges = [{"source": "e1", "target": "r1"}]
        assert _find_parent_router("e1", router_ids, edges) == "r1"

    def test_returns_none_when_no_router(self) -> None:
        router_ids: set[str] = set()
        edges = [{"source": "e1", "target": "e2"}]
        assert _find_parent_router("e1", router_ids, edges) is None

    def test_returns_none_empty_edges(self) -> None:
        assert _find_parent_router("e1", {"r1"}, []) is None


# ---------------------------------------------------------------------------
# fetch_networkmap (integration-style with mocked aiomqtt)
# ---------------------------------------------------------------------------

SAMPLE_RESPONSE_PAYLOAD = {
    "data": {
        "type": "raw",
        "routes": False,
        "value": {
            "nodes": [
                {
                    "ieeeAddr": "0x00000000",
                    "type": "Coordinator",
                    "friendlyName": "Coordinator",
                },
                {
                    "ieeeAddr": "0x00000001",
                    "type": "Router",
                    "friendlyName": "router_1",
                },
            ],
            "links": [
                {
                    "source": {"ieeeAddr": "0x00000000"},
                    "target": {"ieeeAddr": "0x00000001"},
                    "lqi": 230,
                }
            ],
        },
    },
    "status": "ok",
}


@pytest.mark.asyncio
async def test_fetch_networkmap_success() -> None:
    """fetch_networkmap returns parsed nodes/edges when MQTT responds normally."""

    class _FakeMessage:
        topic = "zigbee2mqtt/bridge/response/networkmap"
        payload = json.dumps(SAMPLE_RESPONSE_PAYLOAD).encode()

        def __aiter__(self):
            return self

        async def __anext__(self):
            return self

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def subscribe(self, _topic: str) -> None:
            pass

        async def publish(self, _topic: str, _payload: str) -> None:
            pass

        @property
        def messages(self):
            return _FakeMessage()

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        nodes, edges = await fetch_networkmap(
            mqtt_host="localhost",
            mqtt_port=1883,
            base_topic="zigbee2mqtt",
        )

    assert any(n["type"] == "zigbee_coordinator" for n in nodes)
    assert any(n["type"] == "zigbee_router" for n in nodes)


@pytest.mark.asyncio
async def test_fetch_networkmap_connection_error() -> None:
    """fetch_networkmap raises ConnectionError when MQTT broker is unreachable."""

    class _FakeClient:
        async def __aenter__(self):
            raise Exception("Connection refused")

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        with pytest.raises(ConnectionError):
            await fetch_networkmap(
                mqtt_host="bad-host",
                mqtt_port=1883,
                base_topic="zigbee2mqtt",
            )


@pytest.mark.asyncio
async def test_test_mqtt_connection_success() -> None:
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        result = await _test_mqtt_connection("localhost", 1883)
    assert result is True


@pytest.mark.asyncio
async def test_test_mqtt_connection_failure() -> None:
    class _FakeClient:
        async def __aenter__(self):
            raise Exception("refused")

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        with pytest.raises(ConnectionError):
            await _test_mqtt_connection("bad-host", 1883)


# ---------------------------------------------------------------------------
# TLS context
# ---------------------------------------------------------------------------

import ssl  # noqa: E402

from app.services.zigbee_service import _build_tls_context  # noqa: E402


def test_build_tls_context_secure_verifies_cert() -> None:
    ctx = _build_tls_context(insecure=False)
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED


def test_build_tls_context_insecure_disables_verification() -> None:
    ctx = _build_tls_context(insecure=True)
    assert ctx.check_hostname is False
    assert ctx.verify_mode == ssl.CERT_NONE


@pytest.mark.asyncio
async def test_test_mqtt_connection_passes_tls_context() -> None:
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        await _test_mqtt_connection("host", 8883, tls=True)
        kwargs = mock_aiomqtt.Client.call_args.kwargs
        assert kwargs["tls_context"] is not None
        assert kwargs["tls_context"].verify_mode == ssl.CERT_REQUIRED


@pytest.mark.asyncio
async def test_test_mqtt_connection_no_tls_context_when_disabled() -> None:
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        await _test_mqtt_connection("host", 1883, tls=False)
        assert mock_aiomqtt.Client.call_args.kwargs["tls_context"] is None


@pytest.mark.asyncio
async def test_test_mqtt_connection_insecure_passes_no_verify_context() -> None:
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        await _test_mqtt_connection("host", 8883, tls=True, tls_insecure=True)
        ctx = mock_aiomqtt.Client.call_args.kwargs["tls_context"]
        assert ctx.verify_mode == ssl.CERT_NONE
        assert ctx.check_hostname is False


# ---------------------------------------------------------------------------
# Sanitize MQTT errors
# ---------------------------------------------------------------------------

from app.services.zigbee_service import _sanitize_mqtt_error  # noqa: E402


def test_sanitize_auth_error_does_not_leak_credentials() -> None:
    msg = _sanitize_mqtt_error(
        Exception("Not authorized: bad username or password for user=admin pwd=secret")
    )
    assert msg == "Authentication failed"
    assert "admin" not in msg
    assert "secret" not in msg


def test_sanitize_refused() -> None:
    assert _sanitize_mqtt_error(Exception("Connection refused")) == "Connection refused by broker"


def test_sanitize_dns_failure_strips_host() -> None:
    msg = _sanitize_mqtt_error(
        Exception("[Errno 8] nodename nor servname provided, or not known: broker.internal.lan")
    )
    assert msg == "Broker hostname could not be resolved"
    assert "broker.internal.lan" not in msg


def test_sanitize_tls_error() -> None:
    assert _sanitize_mqtt_error(
        Exception("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed")
    ) == "TLS handshake failed"


def test_sanitize_unknown_falls_back_to_generic() -> None:
    msg = _sanitize_mqtt_error(Exception("mqtt://admin:hunter2@broker:1883 weird state"))
    assert msg == "MQTT connection failed"
    assert "hunter2" not in msg
    assert "admin" not in msg


@pytest.mark.asyncio
async def test_fetch_networkmap_does_not_leak_creds_in_connection_error() -> None:
    class _FakeClient:
        async def __aenter__(self):
            raise Exception("Not authorized: rejected mqtt://admin:hunter2@host")

        async def __aexit__(self, *_):
            pass

    with patch("app.services.zigbee_service.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception

        with pytest.raises(ConnectionError) as ei:
            await fetch_networkmap(
                mqtt_host="host", mqtt_port=1883, base_topic="zigbee2mqtt"
            )
    msg = str(ei.value)
    assert "hunter2" not in msg
    assert "admin" not in msg
    assert msg == "Authentication failed"
