"""Unit tests for the shared MQTT helpers in mqtt_common."""

from __future__ import annotations

import json
import ssl
from unittest.mock import patch

import pytest

from app.services.mqtt_common import (
    _build_tls_context,
    _sanitize_mqtt_error,
    request_response,
)
from app.services.mqtt_common import test_connection as _test_connection

# ---------------------------------------------------------------------------
# _sanitize_mqtt_error — never leak credentials
# ---------------------------------------------------------------------------


def test_sanitize_auth_error() -> None:
    msg = _sanitize_mqtt_error(Exception("Not authorized: bad username for user=admin pwd=secret"))
    assert msg == "Authentication failed"
    assert "secret" not in msg


def test_sanitize_refused() -> None:
    assert _sanitize_mqtt_error(Exception("Connection refused")) == "Connection refused by broker"


def test_sanitize_dns() -> None:
    msg = _sanitize_mqtt_error(Exception("nodename nor servname provided: broker.lan"))
    assert msg == "Broker hostname could not be resolved"
    assert "broker.lan" not in msg


def test_sanitize_tls() -> None:
    assert _sanitize_mqtt_error(
        Exception("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed")
    ) == "TLS handshake failed"


def test_sanitize_timeout() -> None:
    assert _sanitize_mqtt_error(Exception("operation timed out")) == "Connection to broker timed out"


def test_sanitize_unknown_falls_back() -> None:
    msg = _sanitize_mqtt_error(Exception("mqtt://admin:hunter2@broker weird"))
    assert msg == "MQTT connection failed"
    assert "hunter2" not in msg


# ---------------------------------------------------------------------------
# _build_tls_context
# ---------------------------------------------------------------------------


def test_tls_secure_verifies() -> None:
    ctx = _build_tls_context(insecure=False)
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED


def test_tls_insecure_disables_verification() -> None:
    ctx = _build_tls_context(insecure=True)
    assert ctx.check_hostname is False
    assert ctx.verify_mode == ssl.CERT_NONE


# ---------------------------------------------------------------------------
# request_response (mocked aiomqtt)
# ---------------------------------------------------------------------------

_SAMPLE = {"success": True, "result": []}


def _fake_client_factory(topic: str, payload: dict):
    class _FakeMessage:
        _yielded = False

        def __init__(self) -> None:
            self.topic = topic
            self.payload = json.dumps(payload).encode()

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

        async def subscribe(self, _topic: str) -> None:
            pass

        async def publish(self, _topic: str, _payload: str) -> None:
            pass

        @property
        def messages(self):
            return _FakeMessage()

    return _FakeClient


@pytest.mark.asyncio
async def test_request_response_success() -> None:
    topic = "zwave/_CLIENTS/ZWAVE_GATEWAY-zwavejs2mqtt/api/getNodes"
    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _fake_client_factory(topic, _SAMPLE)()
        mock_aiomqtt.MqttError = Exception
        out = await request_response(
            "localhost", 1883, "req/topic", topic, {"args": []}
        )
    assert out == _SAMPLE


@pytest.mark.asyncio
async def test_request_response_connection_error() -> None:
    class _FakeClient:
        async def __aenter__(self):
            raise Exception("Connection refused")

        async def __aexit__(self, *_):
            pass

    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception
        with pytest.raises(ConnectionError):
            await request_response("bad", 1883, "req", "resp", {})


@pytest.mark.asyncio
async def test_request_response_passes_tls_context() -> None:
    topic = "resp"
    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _fake_client_factory(topic, _SAMPLE)()
        mock_aiomqtt.MqttError = Exception
        await request_response("h", 8883, "req", topic, {}, tls=True, tls_insecure=True)
        ctx = mock_aiomqtt.Client.call_args.kwargs["tls_context"]
        assert ctx.verify_mode == ssl.CERT_NONE


@pytest.mark.asyncio
async def test_test_connection_success() -> None:
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception
        assert await _test_connection("localhost", 1883) is True


@pytest.mark.asyncio
async def test_test_connection_failure() -> None:
    class _FakeClient:
        async def __aenter__(self):
            raise Exception("refused")

        async def __aexit__(self, *_):
            pass

    with patch("app.services.mqtt_common.aiomqtt") as mock_aiomqtt:
        mock_aiomqtt.Client.return_value = _FakeClient()
        mock_aiomqtt.MqttError = Exception
        with pytest.raises(ConnectionError):
            await _test_connection("bad", 1883)
