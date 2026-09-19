"""Tests for the UniFi Network Controller API client.

The fixtures here are trimmed copies of what a real controller answers
(Network 10.6) so the login fallback and the device mapping are exercised
against genuine response shapes rather than invented ones.
"""
from unittest.mock import patch

import httpx
import pytest

from app.services.unifi_service import (
    UnifiApiError,
    fetch_unifi_inventory,
)

# Aliased: a module-level name starting with `test_` would be collected as a test.
from app.services.unifi_service import test_unifi_connection as check_connection

# A self-hosted controller answers 401 on the UniFi OS login path and 404 on the
# UniFi OS proxy path, so both fallbacks below are the real behaviour.
_LOGIN_OS = "/api/auth/login"
_LOGIN_LEGACY = "/api/login"
_PROXY_DEVICES = "/proxy/network/api/s/default/stat/device"
_LEGACY_DEVICES = "/api/s/default/stat/device"

_DEVICES = [
    {
        "mac": "00:27:22:e0:00:01",
        "ip": "192.168.1.100",
        "name": "U7 Pro",
        "type": "uap",
        "model": "U7PRO",
        "version": "8.6.11.18870",
        "uptime": 137,
    },
    {
        "mac": "00:27:22:e0:00:02",
        "ip": "192.168.1.101",
        "name": "USW Ultra",
        "type": "usw",
        "model": "USM8P",
        "version": "2.1.8.971",
    },
    {
        "mac": "00:27:22:e0:00:04",
        "ip": "192.168.1.103",
        "name": "USG 3P",
        "type": "ugw",
        "model": "UGW3",
    },
]


class _TransportClient:
    """Patch target for httpx.AsyncClient routing through a MockTransport.

    Real client, fake network — the service exercises the genuine httpx request
    path. `requests` records what was actually sent.
    """

    def __init__(self, handler):
        self._handler = handler
        # Bound before patching, so building the real client here does not
        # recurse back into this stand-in.
        self._real = httpx.AsyncClient
        self.requests: list[httpx.Request] = []

    def _record(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._handler(request)

    def __call__(self, **kwargs):
        kwargs.pop("verify", None)
        return self._real(transport=httpx.MockTransport(self._record), **kwargs)


def _patch(handler) -> tuple:
    factory = _TransportClient(handler)
    return patch("app.services.unifi_service.httpx.AsyncClient", factory), factory


def _err(msg: str, status: int = 401) -> httpx.Response:
    return httpx.Response(status, json={"meta": {"rc": "error", "msg": msg}, "data": []})


def _ok(data: list) -> httpx.Response:
    return httpx.Response(200, json={"meta": {"rc": "ok"}, "data": data})


def _self_hosted(devices: list, site: str = "default"):
    """Handler mimicking a legacy controller: OS paths refused, legacy served."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == _LOGIN_OS:
            return _err("api.err.LoginRequired")
        if path == _LOGIN_LEGACY:
            return httpx.Response(
                200,
                json={"meta": {"rc": "ok"}, "data": []},
                headers={"set-cookie": "unifises=abc123; Path=/; HttpOnly"},
            )
        if path.startswith("/proxy/network/"):
            return httpx.Response(404, text="<html>HTTP Status 404</html>")
        if path == f"/api/s/{site}/stat/device":
            return _ok(devices)
        # Any other site: what the controller really answers.
        return _err("api.err.NoSiteContext")

    return handler


# ── login fallback ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_falls_back_to_the_legacy_path() -> None:
    ctx, factory = _patch(_self_hosted(_DEVICES))
    with ctx:
        connected, message = await check_connection(
            "unifi.local", 8443, "default", "admin", "pw"
        )
    assert connected is True
    assert "3 device(s)" in message
    tried = [r.url.path for r in factory.requests]
    # The UniFi OS path is tried first and refused, then the legacy one.
    assert tried[:2] == [_LOGIN_OS, _LOGIN_LEGACY]


@pytest.mark.asyncio
async def test_devices_fall_back_to_the_legacy_path() -> None:
    ctx, factory = _patch(_self_hosted(_DEVICES))
    with ctx:
        await check_connection("unifi.local", 8443, "default", "admin", "pw")
    tried = [r.url.path for r in factory.requests]
    assert _PROXY_DEVICES in tried
    assert tried[-1] == _LEGACY_DEVICES


@pytest.mark.asyncio
async def test_bad_credentials_report_a_login_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return _err("api.err.Invalid", status=400)

    ctx, _ = _patch(handler)
    with ctx:
        connected, message = await check_connection(
            "unifi.local", 8443, "default", "admin", "wrong"
        )
    assert connected is False
    assert "Login failed" in message


# ── an unreachable endpoint is not an empty site ────────────────────────────

@pytest.mark.asyncio
async def test_unknown_site_is_not_reported_as_connected() -> None:
    """Regression: a wrong site answered 401 and read as "Connected — 0 devices"."""
    ctx, _ = _patch(_self_hosted(_DEVICES))
    with ctx:
        connected, message = await check_connection(
            "unifi.local", 8443, "nosuchsite", "admin", "pw"
        )
    assert connected is False
    assert "401" in message


@pytest.mark.asyncio
async def test_unknown_site_raises_on_import() -> None:
    ctx, _ = _patch(_self_hosted(_DEVICES))
    with ctx, pytest.raises(UnifiApiError):
        await fetch_unifi_inventory("unifi.local", 8443, "nosuchsite", "admin", "pw")


@pytest.mark.asyncio
async def test_an_empty_site_still_connects() -> None:
    """The other half of the regression: genuinely empty must stay a success."""
    ctx, _ = _patch(_self_hosted([]))
    with ctx:
        connected, message = await check_connection(
            "unifi.local", 8443, "default", "admin", "pw"
        )
    assert connected is True
    assert "0 device(s)" in message


# ── mapping ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_inventory_maps_unifi_types_to_node_types() -> None:
    ctx, _ = _patch(_self_hosted(_DEVICES))
    with ctx:
        devices = await fetch_unifi_inventory(
            "unifi.local", 8443, "default", "admin", "pw"
        )
    assert [d["type"] for d in devices] == ["ap", "switch", "router"]
    ap = devices[0]
    assert ap["ieee_address"] == "unifi-00:27:22:e0:00:01"
    assert ap["ip"] == "192.168.1.100"
    assert ap["vendor"] == "Ubiquiti"
    assert ap["model"] == "U7PRO"
    assert {"name": "Firmware", "value": "8.6.11.18870"} in ap["properties"]
