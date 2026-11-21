"""Unit tests for zigbee_ha_service: the Home Assistant ZHA import source."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from app.services.zigbee_ha_service import (
    _ws_url,
    fetch_zha_devices,
    parse_zha_devices,
)

# ---------------------------------------------------------------------------
# parse_zha_devices — pure parsing, no network
# ---------------------------------------------------------------------------


def _zha_device(
    ieee: str,
    device_type: str = "EndDevice",
    name: str | None = None,
    model: str | None = None,
    manufacturer: str | None = None,
    lqi: int | None = 200,
) -> dict[str, Any]:
    return {
        "ieee": ieee,
        "device_type": device_type,
        "name": name or ieee,
        "model": model,
        "manufacturer": manufacturer,
        "lqi": lqi,
    }


def test_parse_zha_devices_maps_types_and_flat_hierarchy() -> None:
    devices = [
        _zha_device("coord", device_type="Coordinator", lqi=None),
        _zha_device("router1", device_type="Router", lqi=250),
        _zha_device("end1", device_type="EndDevice", lqi=180),
    ]
    nodes, edges = parse_zha_devices(devices)

    by_id = {n["id"]: n for n in nodes}
    assert by_id["coord"]["type"] == "zigbee_coordinator"
    assert by_id["coord"]["parent_id"] is None
    assert by_id["router1"]["type"] == "zigbee_router"
    assert by_id["router1"]["parent_id"] == "coord"
    assert by_id["end1"]["type"] == "zigbee_enddevice"
    assert by_id["end1"]["parent_id"] == "coord"

    # Flat tree: every non-coordinator device attaches directly to the
    # coordinator (no neighbour table available via zha/devices).
    assert {(e["source"], e["target"]) for e in edges} == {
        ("coord", "router1"),
        ("coord", "end1"),
    }
    assert all(e["kind"] == "tree" for e in edges)


def test_parse_zha_devices_no_coordinator_yields_no_edges() -> None:
    devices = [_zha_device("router1", device_type="Router")]
    nodes, edges = parse_zha_devices(devices)
    assert len(nodes) == 1
    assert edges == []


def test_parse_zha_devices_carries_model_vendor_lqi() -> None:
    devices = [
        _zha_device(
            "end1",
            model="lumi.sensor_motion",
            manufacturer="Xiaomi",
            lqi=42,
        )
    ]
    nodes, _ = parse_zha_devices(devices)
    assert nodes[0]["model"] == "lumi.sensor_motion"
    assert nodes[0]["vendor"] == "Xiaomi"
    assert nodes[0]["lqi"] == 42


def test_parse_zha_devices_skips_entries_without_ieee() -> None:
    nodes, _ = parse_zha_devices([{"device_type": "EndDevice"}])
    assert nodes == []


def test_parse_zha_devices_dedupes_by_ieee() -> None:
    devices = [_zha_device("end1"), _zha_device("end1")]
    nodes, _ = parse_zha_devices(devices)
    assert len(nodes) == 1


def test_ws_url_converts_http_and_https() -> None:
    assert _ws_url("http://ha.local:8123") == "ws://ha.local:8123/api/websocket"
    assert _ws_url("https://ha.example.com") == "wss://ha.example.com/api/websocket"


# ---------------------------------------------------------------------------
# fetch_zha_devices — websocket handshake, mocked like fetch_networkmap mocks
# aiomqtt in test_zigbee_service.py
# ---------------------------------------------------------------------------


def _fake_ws(messages: list[dict[str, Any]], raise_on_enter: Exception | None = None):
    class _FakeWS:
        def __init__(self) -> None:
            self._queue = list(messages)

        async def __aenter__(self):
            if raise_on_enter:
                raise raise_on_enter
            return self

        async def __aexit__(self, *_exc: object) -> None:
            pass

        async def recv(self) -> str:
            return json.dumps(self._queue.pop(0))

        async def send(self, _payload: str) -> None:
            pass

    return _FakeWS()


@pytest.mark.asyncio
async def test_fetch_zha_devices_success() -> None:
    ws = _fake_ws(
        [
            {"type": "auth_required"},
            {"type": "auth_ok"},
            {
                "id": 1,
                "type": "result",
                "success": True,
                "result": [_zha_device("coord", device_type="Coordinator")],
            },
        ]
    )
    with patch("app.services.zigbee_ha_service.websockets") as mock_ws:
        mock_ws.connect.return_value = ws
        mock_ws.exceptions.WebSocketException = Exception
        nodes, _ = await fetch_zha_devices("http://ha.local:8123", "token")
    assert nodes[0]["id"] == "coord"


@pytest.mark.asyncio
async def test_fetch_zha_devices_auth_failure() -> None:
    ws = _fake_ws([{"type": "auth_required"}, {"type": "auth_invalid"}])
    with patch("app.services.zigbee_ha_service.websockets") as mock_ws:
        mock_ws.connect.return_value = ws
        mock_ws.exceptions.WebSocketException = Exception
        with pytest.raises(ConnectionError):
            await fetch_zha_devices("http://ha.local:8123", "bad-token")


@pytest.mark.asyncio
async def test_fetch_zha_devices_connection_refused() -> None:
    ws = _fake_ws([], raise_on_enter=OSError("Connection refused"))
    with patch("app.services.zigbee_ha_service.websockets") as mock_ws:
        mock_ws.connect.return_value = ws
        mock_ws.exceptions.WebSocketException = Exception
        with pytest.raises(ConnectionError):
            await fetch_zha_devices("http://bad-host:8123", "token")


@pytest.mark.asyncio
async def test_fetch_zha_devices_call_failure_raises_value_error() -> None:
    ws = _fake_ws(
        [
            {"type": "auth_required"},
            {"type": "auth_ok"},
            {"id": 1, "type": "result", "success": False, "error": {"message": "nope"}},
        ]
    )
    with patch("app.services.zigbee_ha_service.websockets") as mock_ws:
        mock_ws.connect.return_value = ws
        mock_ws.exceptions.WebSocketException = Exception
        with pytest.raises(ValueError, match="nope"):
            await fetch_zha_devices("http://ha.local:8123", "token")


@pytest.mark.asyncio
async def test_fetch_zha_devices_requires_url_and_token() -> None:
    with pytest.raises(ValueError):
        await fetch_zha_devices("", "token")
    with pytest.raises(ValueError):
        await fetch_zha_devices("http://ha.local:8123", "")
