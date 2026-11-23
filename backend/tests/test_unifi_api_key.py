"""UniFi API-key auth (#612): X-API-KEY on the classic endpoints, no login.

A Fabric console holds no local users, so the key is its only way in. The
handlers below mimic what such a console answered: 200 on the classic
/proxy/network/api/s/<site>/… paths with the key header, no login involved.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import httpx
import pytest
from httpx import AsyncClient

from app.core.config import Settings, settings
from app.services.unifi_service import UnifiApiError, fetch_unifi_inventory
from app.services.unifi_service import test_unifi_connection as check_connection

_KEY = "k3y-for-tests"
_DEVICES = [{"mac": "00:27:22:e0:00:01", "ip": "192.168.1.100", "name": "U7 Pro", "type": "uap"}]
_STA = [{"mac": "aa:bb:cc:00:00:01", "ip": "192.168.1.50", "hostname": "laptop", "ap_mac": "00:27:22:e0:00:01"}]
_USERS = [{"mac": "aa:bb:cc:00:00:02", "name": "printer"}]


class _Transport:
    """httpx.AsyncClient stand-in over a MockTransport, recording requests."""

    def __init__(self, handler):
        self._handler = handler
        self._real = httpx.AsyncClient
        self.requests: list[httpx.Request] = []

    def _record(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._handler(request)

    def __call__(self, **kwargs):
        kwargs.pop("verify", None)
        return self._real(transport=httpx.MockTransport(self._record), **kwargs)


def _patch(handler):
    factory = _Transport(handler)
    return patch("app.services.unifi_service.httpx.AsyncClient", factory), factory


def _ok(data: list) -> httpx.Response:
    return httpx.Response(200, json={"meta": {"rc": "ok"}, "data": data})


def _fabric_console(request: httpx.Request) -> httpx.Response:
    """Answers the classic proxy paths for the right key, refuses any login."""
    path = request.url.path
    if "login" in path:
        return httpx.Response(401, json={"code": "AUTHENTICATION_FAILED_INVALID_CREDENTIALS"})
    if request.headers.get("X-API-KEY") != _KEY:
        return httpx.Response(401, json={"error": {"code": 401, "message": "Unauthorized"}})
    if not path.startswith("/proxy/network/api/s/default/"):
        return httpx.Response(
            400, json={"meta": {"rc": "error", "msg": "api.err.NoSiteContext"}, "data": []}
        )
    return _ok({"stat/device": _DEVICES, "stat/sta": _STA, "list/user": _USERS}[
        path.removeprefix("/proxy/network/api/s/default/")
    ])


# ── service ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_key_connects_without_any_login_request() -> None:
    ctx, factory = _patch(_fabric_console)
    with ctx:
        connected, message, counts = await check_connection(
            "192.168.1.1", 443, "default", api_key=_KEY
        )
    assert connected is True, message
    assert counts == {"infrastructure": 1}
    assert not any("login" in r.url.path for r in factory.requests)
    assert all(r.headers["X-API-KEY"] == _KEY for r in factory.requests)
    assert all("cookie" not in r.headers for r in factory.requests)


@pytest.mark.asyncio
async def test_a_key_imports_every_source() -> None:
    ctx, _ = _patch(_fabric_console)
    with ctx:
        devices = await fetch_unifi_inventory(
            "192.168.1.1", 443, "default",
            infrastructure=True, known_clients=True, active_clients=True, api_key=_KEY,
        )
    macs = {d["mac"] for d in devices}
    assert macs == {"00:27:22:e0:00:01", "aa:bb:cc:00:00:01", "aa:bb:cc:00:00:02"}


@pytest.mark.asyncio
async def test_a_key_wins_over_a_username_and_password() -> None:
    ctx, factory = _patch(_fabric_console)
    with ctx:
        connected, _, _ = await check_connection(
            "192.168.1.1", 443, "default", "admin", "pw", api_key=_KEY
        )
    assert connected is True
    assert not any("login" in r.url.path for r in factory.requests)


@pytest.mark.asyncio
async def test_a_rejected_key_is_named_as_the_cause() -> None:
    ctx, _ = _patch(_fabric_console)
    with ctx:
        connected, message, _ = await check_connection(
            "192.168.1.1", 443, "default", api_key="wrong"
        )
    assert connected is False
    assert "HTTP 401" in message
    assert "API key" in message


@pytest.mark.asyncio
async def test_a_rejected_key_fails_the_import() -> None:
    ctx, _ = _patch(_fabric_console)
    with ctx, pytest.raises(UnifiApiError, match="API key"):
        await fetch_unifi_inventory("192.168.1.1", 443, "default", api_key="wrong")


@pytest.mark.asyncio
async def test_a_wrong_site_is_not_blamed_on_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"meta": {"rc": "error", "msg": "api.err.NoSiteContext"}, "data": []}
        )

    ctx, _ = _patch(handler)
    with ctx:
        connected, message, _ = await check_connection(
            "192.168.1.1", 443, "nosuchsite", api_key=_KEY
        )
    assert connected is False
    assert "API key" not in message


@pytest.mark.asyncio
async def test_a_redirect_is_not_followed_with_a_key() -> None:
    """httpx keeps X-API-KEY across a cross-host redirect, so none is followed."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "192.168.1.1":
            return httpx.Response(302, headers={"location": "https://evil.example/steal"})
        return _ok(_DEVICES)

    ctx, factory = _patch(handler)
    with ctx:
        connected, message, _ = await check_connection(
            "192.168.1.1", 443, "default", api_key=_KEY
        )
    assert connected is False
    assert "redirect, not followed" in message
    assert {r.url.host for r in factory.requests} == {"192.168.1.1"}


@pytest.mark.asyncio
async def test_a_key_to_the_cloud_portal_is_refused_without_a_request() -> None:
    ctx, factory = _patch(lambda request: _ok([]))
    with ctx:
        connected, message, _ = await check_connection(
            "unifi.ui.com", 443, "default", api_key=_KEY
        )
    assert connected is False
    assert "cloud portal" in message
    assert factory.requests == []


# ── settings ────────────────────────────────────────────────────────────────

def _settings(tmp_path, **env) -> Settings:
    s = Settings(secret_key="x", sqlite_path=str(tmp_path / "homelab.db"))
    s.unifi_username = s.unifi_password = s.unifi_api_key = ""
    for key, value in env.items():
        setattr(s, key, value)
    return s


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({}, False),
        ({"unifi_api_key": _KEY}, True),
        ({"unifi_username": "admin", "unifi_password": "pw"}, True),
        ({"unifi_username": "admin"}, False),
    ],
)
def test_credentials_configured_accepts_a_key_or_a_full_login(tmp_path, env, expected) -> None:
    assert _settings(tmp_path, **env).unifi_credentials_configured is expected


def test_the_key_is_never_written_to_the_overrides(tmp_path) -> None:
    s = _settings(tmp_path, unifi_api_key=_KEY, unifi_sync_enabled=True)
    s.save_overrides()
    raw = (tmp_path / "scan_config.json").read_text()
    assert _KEY not in raw
    assert "unifi_api_key" not in json.loads(raw)


# ── routes ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _clear_unifi_env(monkeypatch):
    for name in ("unifi_host", "unifi_url", "unifi_username", "unifi_password", "unifi_api_key"):
        monkeypatch.setattr(settings, name, "")
    monkeypatch.setattr(settings, "unifi_port", 443)
    monkeypatch.setattr(settings, "unifi_verify_tls", False)


@pytest.fixture
def seen(monkeypatch) -> dict:
    """Captures the kwargs the routes hand to the service."""
    captured: dict = {}

    async def _fake_test(**kwargs):
        captured.update(kwargs)
        return True, "ok", {"infrastructure": 0}

    async def _fake_fetch(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr("app.api.routes.unifi.test_unifi_connection", _fake_test)
    monkeypatch.setattr("app.api.routes.unifi.fetch_unifi_inventory", _fake_fetch)
    return captured


@pytest.mark.asyncio
async def test_test_connection_accepts_a_key_alone(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    res = await client.post(
        "/api/v1/unifi/test-connection", headers=headers,
        json={"host": "192.168.1.1", "api_key": _KEY},
    )
    assert res.status_code == 200
    assert seen["api_key"] == _KEY
    assert seen["username"] == "" and seen["password"] == ""


@pytest.mark.asyncio
async def test_import_falls_back_to_the_env_key(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    settings.unifi_host = "192.168.1.1"
    settings.unifi_api_key = _KEY
    res = await client.post(
        "/api/v1/unifi/import-pending", headers=headers, json={"host": "192.168.1.1"},
    )
    assert res.status_code == 200
    assert seen["api_key"] == _KEY


@pytest.mark.asyncio
async def test_the_env_key_is_never_sent_to_another_host(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    settings.unifi_host = "192.168.1.1"
    settings.unifi_api_key = _KEY
    for target in ({"host": "attacker.example"}, {"host": "192.168.1.1", "port": 8443}):
        res = await client.post(
            "/api/v1/unifi/test-connection", headers=headers, json=target,
        )
        assert res.status_code == 400
        assert "UNIFI_API_KEY" in res.json()["detail"]
    assert seen == {}


@pytest.mark.asyncio
async def test_the_env_key_is_not_sent_when_no_env_host_is_set(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    settings.unifi_api_key = _KEY
    res = await client.post(
        "/api/v1/unifi/test-connection", headers=headers, json={"host": "192.168.1.1"},
    )
    assert res.status_code == 400
    assert seen == {}


@pytest.mark.asyncio
async def test_another_host_still_falls_back_to_the_env_login(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    """Key-only binding: the env username/password fallback is unchanged."""
    settings.unifi_host = "192.168.1.1"
    settings.unifi_api_key = _KEY
    settings.unifi_username = "admin"
    settings.unifi_password = "pw"
    res = await client.post(
        "/api/v1/unifi/test-connection", headers=headers, json={"host": "10.0.0.9"},
    )
    assert res.status_code == 200
    assert seen["api_key"] == ""
    assert (seen["username"], seen["password"]) == ("admin", "pw")


@pytest.mark.asyncio
async def test_the_env_key_uses_the_env_tls_setting(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    settings.unifi_host = "192.168.1.1"
    settings.unifi_api_key = _KEY
    settings.unifi_verify_tls = True
    res = await client.post(
        "/api/v1/unifi/test-connection", headers=headers,
        json={"host": "192.168.1.1", "verify_tls": False},
    )
    assert res.status_code == 200
    assert seen["verify_tls"] is True


@pytest.mark.asyncio
async def test_a_login_typed_in_the_form_beats_the_env_key(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    settings.unifi_api_key = _KEY
    res = await client.post(
        "/api/v1/unifi/test-connection", headers=headers,
        json={"host": "192.168.1.1", "username": "admin", "password": "pw"},
    )
    assert res.status_code == 200
    assert seen["api_key"] == ""
    assert (seen["username"], seen["password"]) == ("admin", "pw")


@pytest.mark.asyncio
async def test_no_key_and_no_login_is_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/unifi/test-connection", headers=headers, json={"host": "192.168.1.1"},
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_config_reports_a_key_as_credentials_without_leaking_it(
    client: AsyncClient, headers: dict
) -> None:
    settings.unifi_host = "192.168.1.1"
    settings.unifi_api_key = _KEY
    res = await client.get("/api/v1/unifi/config", headers=headers)
    assert res.status_code == 200
    assert res.json()["credentials_configured"] is True
    assert _KEY not in res.text


@pytest.mark.asyncio
async def test_sync_now_runs_on_an_env_key_alone(
    client: AsyncClient, headers: dict, seen: dict
) -> None:
    settings.unifi_host = "192.168.1.1"
    settings.unifi_api_key = _KEY
    res = await client.post("/api/v1/unifi/sync-now", headers=headers)
    assert res.status_code == 200
    assert seen["api_key"] == _KEY
    assert seen["username"] == ""
