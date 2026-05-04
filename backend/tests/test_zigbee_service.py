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
# Helper builders
# ---------------------------------------------------------------------------

def _make_route(
    ieee: str,
    device_type: str = "EndDevice",
    friendly_name: str | None = None,
    targets: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a minimal Z2M route entry for testing."""
    return {
        "source": {
            "ieeeAddr": ieee,
            "type": device_type,
            "friendlyName": friendly_name or ieee,
        },
        "routes": targets or [],
    }


def _make_target(
    ieee: str,
    device_type: str = "EndDevice",
    lqi: int = 200,
) -> dict[str, Any]:
    return {
        "target": {"ieeeAddr": ieee, "type": device_type, "friendlyName": ieee},
        "lqi": lqi,
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

    def test_empty_routes(self) -> None:
        nodes, edges = parse_networkmap({"data": {"routes": []}})
        assert nodes == []
        assert edges == []

    def test_coordinator_only(self) -> None:
        payload = {
            "data": {
                "routes": [
                    _make_route("0x0000000000000000", "Coordinator", "Coordinator"),
                ]
            }
        }
        nodes, edges = parse_networkmap(payload)
        assert len(nodes) == 1
        assert nodes[0]["type"] == "zigbee_coordinator"
        assert nodes[0]["ieee_address"] == "0x0000000000000000"
        assert edges == []

    def test_coordinator_router_enddevice(self) -> None:
        coord_ieee = "0x0000000000000000"
        router_ieee = "0x0000000000000001"
        end_ieee = "0x0000000000000002"

        payload = {
            "data": {
                "routes": [
                    _make_route(
                        coord_ieee,
                        "Coordinator",
                        "Coordinator",
                        targets=[_make_target(router_ieee, "Router")],
                    ),
                    _make_route(
                        router_ieee,
                        "Router",
                        "my_router",
                        targets=[_make_target(end_ieee, "EndDevice")],
                    ),
                ]
            }
        }

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

    def test_no_duplicate_nodes(self) -> None:
        ieee = "0x0000000000000001"
        payload = {
            "data": {
                "routes": [
                    _make_route(ieee, "Router"),
                    _make_route(ieee, "Router"),  # duplicate
                ]
            }
        }
        nodes, _ = parse_networkmap(payload)
        assert len(nodes) == 1

    def test_edges_built_correctly(self) -> None:
        coord = "0x0000"
        router = "0x0001"
        payload = {
            "data": {
                "routes": [
                    _make_route(
                        coord,
                        "Coordinator",
                        targets=[_make_target(router, "Router")],
                    )
                ]
            }
        }
        _, edges = parse_networkmap(payload)
        assert len(edges) == 1
        assert edges[0]["source"] == coord
        assert edges[0]["target"] == router

    def test_friendly_name_used_as_label(self) -> None:
        payload = {
            "data": {
                "routes": [
                    _make_route("0xABCD", "EndDevice", "Living Room Sensor")
                ]
            }
        }
        nodes, _ = parse_networkmap(payload)
        assert nodes[0]["label"] == "Living Room Sensor"

    def test_enddevice_falls_back_to_coordinator_when_no_router(self) -> None:
        coord = "0x0000"
        end = "0x0003"
        payload = {
            "data": {
                "routes": [
                    _make_route(coord, "Coordinator"),
                    _make_route(end, "EndDevice"),
                ]
            }
        }
        nodes, _ = parse_networkmap(payload)
        end_node = next(n for n in nodes if n["id"] == end)
        assert end_node["parent_id"] == coord

    def test_missing_ieee_skipped(self) -> None:
        payload = {
            "data": {
                "routes": [
                    {"source": {}, "routes": []},  # no ieeeAddr
                ]
            }
        }
        nodes, edges = parse_networkmap(payload)
        assert nodes == []
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
        "routes": [
            {
                "source": {
                    "ieeeAddr": "0x00000000",
                    "type": "Coordinator",
                    "friendlyName": "Coordinator",
                },
                "routes": [
                    {
                        "target": {
                            "ieeeAddr": "0x00000001",
                            "type": "Router",
                            "friendlyName": "router_1",
                        },
                        "lqi": 230,
                    }
                ],
            }
        ]
    }
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
