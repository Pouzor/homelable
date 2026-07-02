"""Unit tests for zwave_service: parser, role mapping, hierarchy builder."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from app.services.zwave_service import (
    build_zwave_properties,
    fetch_zwave_network,
    parse_zwave_nodes,
)

# ---------------------------------------------------------------------------
# Helpers — real zwavejs2mqtt getNodes shape
# ---------------------------------------------------------------------------

def _node(
    node_id: int,
    *,
    controller: bool = False,
    routing: bool = False,
    name: str | None = None,
    neighbors: list[int] | None = None,
    manufacturer: str | None = None,
    product_label: str | None = None,
    home_id: str = "0xabcd1234",
) -> dict[str, Any]:
    return {
        "id": node_id,
        "homeId": home_id,
        "isControllerNode": controller,
        "isRouting": routing,
        "name": name,
        "neighbors": neighbors or [],
        "manufacturer": manufacturer,
        "productLabel": product_label,
    }


def _wrap(nodes: list[dict[str, Any]], success: bool = True) -> dict[str, Any]:
    return {"success": success, "result": nodes}


HOME = "0xabcd1234"


def _ieee(node_id: int) -> str:
    return f"zwave-{HOME}-{node_id}"


# ---------------------------------------------------------------------------
# Role mapping
# ---------------------------------------------------------------------------

class TestRoleMapping:
    def test_controller_is_coordinator(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(1, controller=True)]))
        assert nodes[0]["type"] == "zwave_coordinator"
        assert nodes[0]["device_type"] == "Controller"

    def test_routing_is_router(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(2, routing=True)]))
        assert nodes[0]["type"] == "zwave_router"
        assert nodes[0]["device_type"] == "Router"

    def test_default_is_enddevice(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(3)]))
        assert nodes[0]["type"] == "zwave_enddevice"
        assert nodes[0]["device_type"] == "EndDevice"

    def test_controller_wins_over_routing(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(1, controller=True, routing=True)]))
        assert nodes[0]["type"] == "zwave_coordinator"


# ---------------------------------------------------------------------------
# parse_zwave_nodes
# ---------------------------------------------------------------------------

class TestParse:
    def test_empty_payload(self) -> None:
        nodes, edges = parse_zwave_nodes({})
        assert nodes == []
        assert edges == []

    def test_empty_result(self) -> None:
        nodes, edges = parse_zwave_nodes(_wrap([]))
        assert nodes == []
        assert edges == []

    def test_success_false_raises(self) -> None:
        with pytest.raises(ValueError, match="failure"):
            parse_zwave_nodes(_wrap([], success=False))

    def test_result_not_list_raises(self) -> None:
        with pytest.raises(ValueError, match="not a list"):
            parse_zwave_nodes({"success": True, "result": "oops"})

    def test_missing_id_skipped(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([{"homeId": HOME, "isControllerNode": False}]))
        assert nodes == []

    def test_ieee_identity_format(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(5, controller=True)]))
        assert nodes[0]["ieee_address"] == _ieee(5)

    def test_name_fallback(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(7, name="Living Room")]))
        assert nodes[0]["label"] == "Living Room"
        assert nodes[0]["friendly_name"] == "Living Room"

    def test_model_and_vendor(self) -> None:
        nodes, _ = parse_zwave_nodes(
            _wrap([_node(8, manufacturer="Aeotec", product_label="ZW100")])
        )
        assert nodes[0]["vendor"] == "Aeotec"
        assert nodes[0]["model"] == "ZW100"

    def test_lqi_is_none(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(9)]))
        assert nodes[0]["lqi"] is None

    def test_no_duplicate_nodes(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(1, routing=True), _node(1, routing=True)]))
        assert len(nodes) == 1

    def test_helper_keys_stripped(self) -> None:
        nodes, _ = parse_zwave_nodes(_wrap([_node(1, neighbors=[2])]))
        assert "neighbors" not in nodes[0]
        assert "node_id" not in nodes[0]


class TestHierarchy:
    def test_coordinator_router_enddevice_tree(self) -> None:
        payload = _wrap([
            _node(1, controller=True, neighbors=[2]),
            _node(2, routing=True, neighbors=[1, 3]),
            _node(3, neighbors=[2]),
        ])
        nodes, edges = parse_zwave_nodes(payload)
        by_id = {n["id"]: n for n in nodes}
        assert by_id[_ieee(2)]["parent_id"] == _ieee(1)
        assert by_id[_ieee(3)]["parent_id"] == _ieee(2)
        pairs = {(e["source"], e["target"]) for e in edges}
        assert pairs == {(_ieee(1), _ieee(2)), (_ieee(2), _ieee(3))}

    def test_enddevice_without_router_falls_back_to_coordinator(self) -> None:
        payload = _wrap([_node(1, controller=True), _node(3, neighbors=[])])
        nodes, _ = parse_zwave_nodes(payload)
        end = next(n for n in nodes if n["id"] == _ieee(3))
        assert end["parent_id"] == _ieee(1)

    def test_coordinator_has_no_incoming_edge(self) -> None:
        payload = _wrap([
            _node(1, controller=True, neighbors=[3]),
            _node(3, neighbors=[1]),
        ])
        _, edges = parse_zwave_nodes(payload)
        assert all(e["target"] != _ieee(1) for e in edges)

    def test_neighbor_to_unknown_node_dropped(self) -> None:
        payload = _wrap([_node(1, controller=True, neighbors=[99])])
        _, edges = parse_zwave_nodes(payload)
        assert edges == []

    def test_no_coordinator_means_no_edges(self) -> None:
        payload = _wrap([_node(2, routing=True, neighbors=[3]), _node(3, neighbors=[2])])
        _, edges = parse_zwave_nodes(payload)
        assert edges == []


# ---------------------------------------------------------------------------
# build_zwave_properties
# ---------------------------------------------------------------------------

class TestBuildProperties:
    def test_all_fields(self) -> None:
        props = build_zwave_properties("zwave-x-1", "Aeotec", "ZW100")
        keys = {p["key"]: p["value"] for p in props}
        assert keys == {"Z-Wave ID": "zwave-x-1", "Vendor": "Aeotec", "Model": "ZW100"}

    def test_omits_empty(self) -> None:
        props = build_zwave_properties("zwave-x-1", None, None)
        assert [p["key"] for p in props] == ["Z-Wave ID"]

    def test_defaults_hidden(self) -> None:
        props = build_zwave_properties("zwave-x-1", "V", "M")
        assert all(p["visible"] is False for p in props)

    def test_no_lqi_row(self) -> None:
        props = build_zwave_properties("zwave-x-1", "V", "M")
        assert all(p["key"] != "LQI" for p in props)


# ---------------------------------------------------------------------------
# fetch_zwave_network (mocked MQTT round-trip via mqtt_common)
# ---------------------------------------------------------------------------

_RESPONSE_TOPIC = "zwave/_CLIENTS/ZWAVE_GATEWAY-zwavejs2mqtt/api/getNodes"

_SAMPLE_PAYLOAD = {
    "success": True,
    "result": [
        {"id": 1, "homeId": HOME, "isControllerNode": True, "name": "Controller"},
        {"id": 2, "homeId": HOME, "isRouting": True, "name": "Wall Plug", "neighbors": [1]},
    ],
}


@pytest.mark.asyncio
async def test_fetch_zwave_network_success() -> None:
    class _FakeMessage:
        topic = _RESPONSE_TOPIC
        payload = json.dumps(_SAMPLE_PAYLOAD).encode()
        _yielded = False

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._yielded:
                raise StopAsyncIteration
            self._yielded = True
            return self

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def subscribe(self, _t: str) -> None:
            pass

        async def publish(self, _t: str, _p: str) -> None:
            pass

        @property
        def messages(self):
            return _FakeMessage()

    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception
        nodes, edges = await fetch_zwave_network(mqtt_host="localhost", mqtt_port=1883)

    assert any(n["type"] == "zwave_coordinator" for n in nodes)
    assert any(n["type"] == "zwave_router" for n in nodes)


@pytest.mark.asyncio
async def test_fetch_zwave_network_connection_error() -> None:
    class _FakeClient:
        async def __aenter__(self):
            raise Exception("Connection refused")

        async def __aexit__(self, *_):
            pass

    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception
        with pytest.raises(ConnectionError):
            await fetch_zwave_network(mqtt_host="bad", mqtt_port=1883)
