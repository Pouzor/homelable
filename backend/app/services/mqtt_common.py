"""Shared MQTT helpers for the Zigbee and Z-Wave import services.

Holds the credential-safe error sanitizer, the TLS context builder, and a
generic request/response round-trip over MQTT used by gateway-style APIs
(publish a request topic, wait for a single response topic message).
"""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import aiomqtt
except ImportError:  # pragma: no cover
    aiomqtt = None  # type: ignore[assignment]

_CONNECTION_TIMEOUT = 5.0   # seconds to verify broker reachability
# Fallback wait for a gateway response. The effective value comes from
# ``settings.mqtt_response_timeout`` (env MQTT_RESPONSE_TIMEOUT), read at call
# time so an operator with a large mesh can raise it without a code change.
_RESPONSE_TIMEOUT = 300.0


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


async def request_response(
    mqtt_host: str,
    mqtt_port: int,
    request_topic: str,
    response_topic: str,
    request_payload: dict[str, Any],
    username: str | None = None,
    password: str | None = None,
    tls: bool = False,
    tls_insecure: bool = False,
    response_timeout: float | None = None,
) -> dict[str, Any]:
    """Publish ``request_payload`` to ``request_topic`` and return the first
    JSON message received on ``response_topic`` as a dict.

    ``response_timeout`` defaults to ``settings.mqtt_response_timeout``
    (env ``MQTT_RESPONSE_TIMEOUT``, 300 s) — a large mesh can take minutes.

    Raises:
        ImportError: if aiomqtt is not installed.
        TimeoutError: if no response arrives in time.
        ConnectionError: if the broker cannot be reached.
        ValueError: if the response payload is not valid JSON / is empty.
    """
    if aiomqtt is None:  # pragma: no cover
        raise ImportError(
            "aiomqtt is required for MQTT import. "
            "Install it with: pip install aiomqtt"
        )

    timeout = (
        float(settings.mqtt_response_timeout)
        if response_timeout is None
        else response_timeout
    )
    if timeout <= 0:
        timeout = _RESPONSE_TIMEOUT

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
            await client.publish(request_topic, json.dumps(request_payload))

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
                        raise ValueError(f"Malformed MQTT response: {exc}") from exc
                    return

            await asyncio.wait_for(_wait_for_response(), timeout=timeout)

    except aiomqtt.MqttError as exc:
        raise ConnectionError(_sanitize_mqtt_error(exc)) from exc
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"Timed out waiting for MQTT response after {timeout:g}s — "
            "raise MQTT_RESPONSE_TIMEOUT if your mesh is large"
        ) from exc

    if not response_payload:
        raise ValueError("Empty MQTT response received")

    return response_payload


async def test_connection(
    mqtt_host: str,
    mqtt_port: int,
    username: str | None = None,
    password: str | None = None,
    tls: bool = False,
    tls_insecure: bool = False,
) -> bool:
    """Attempt a quick MQTT connection to verify broker reachability.

    Returns True on success, raises ConnectionError/TimeoutError on failure.
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
