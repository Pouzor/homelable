"""Unit tests for the Synology DSM import service (parsing, props, sanitizer)."""

from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from app.services import synology_service as svc


def test_gb_conversion() -> None:
    assert svc._gb(1024 ** 3) == 1.0
    assert svc._gb(2 * 1024 ** 3) == 2.0
    assert svc._gb(0) is None
    assert svc._gb(None) is None
    assert svc._gb("nope") is None


def test_ram_gb_treats_mb_and_bytes() -> None:
    assert svc._ram_gb(8192) == 8.0          # MB
    assert svc._ram_gb(16 * 1024 ** 3) == 16.0  # bytes
    assert svc._ram_gb(0) is None
    assert svc._ram_gb(None) is None


def test_identity_prefers_serial() -> None:
    assert svc._identity("1234ABC", "nas", "192.168.1.5") == "syno-1234ABC"
    assert svc._identity(None, "DiskStation", "host") == "syno-DiskStation"
    assert svc._identity(None, None, "192.168.1.5") == "syno-192.168.1.5"
    assert svc._identity("weird serial!", None, "h") == "syno-weird-serial"


def test_extract_ip_skips_loopback() -> None:
    payload = {
        "ifaces": [
            {"ip": "127.0.0.1", "mac": "00:11:22:33:44:55"},
            {"ip": "192.168.1.20", "mac": "AA:BB:CC:DD:EE:FF"},
        ]
    }
    assert svc._extract_ip_from_ifaces(payload) == "192.168.1.20"
    assert svc._extract_ip_from_ifaces(None) is None


def test_extract_mac_skips_zero() -> None:
    payload = {"ifaces": [{"mac": "00:00:00:00:00:00"}, {"mac": "AA:BB:CC:DD:EE:FF"}]}
    assert svc._extract_mac_from_ifaces(payload) == "aa:bb:cc:dd:ee:ff"


def test_volume_and_disk_summaries() -> None:
    storage = {
        "volumes": [{
            "id": "volume_1",
            "vol_desc": "Volume 1",
            "status": "normal",
            "size": {"total": str(10 * 1024 ** 3), "used": str(4 * 1024 ** 3)},
        }],
        "disks": [
            {"id": "sata1", "status": "normal"},
            {"id": "sata2", "status": "degraded"},
        ],
    }
    total, lines, health = svc._volume_summaries(storage)
    assert total == 10.0
    assert lines and "Volume 1" in lines[0] and "40%" in lines[0]
    assert health == "healthy"
    assert svc._disk_summary(storage) == "1/2 healthy"


def test_build_node_and_properties() -> None:
    system = {
        "model": "DS1821+",
        "serial": "1230ABC",
        "hostname": "nas",
        "firmware_ver": "DSM 7.2.1",
        "ram_size": 16384,
    }
    storage = {
        "volumes": [{
            "id": "volume_1",
            "vol_desc": "Volume 1",
            "status": "normal",
            "size": {"total": str(32 * 1024 ** 3), "used": str(8 * 1024 ** 3)},
        }],
        "disks": [{"id": "sata1", "status": "normal"}],
    }
    node = svc.build_synology_node(system, storage, "192.168.1.20", "aa:bb:cc:dd:ee:ff", "192.168.1.20")
    assert node["type"] == "nas"
    assert node["ieee_address"] == "syno-1230ABC"
    assert node["vendor"] == "Synology"
    assert node["model"] == "DS1821+"
    assert node["ram_gb"] == 16.0
    assert node["disk_gb"] == 32.0
    assert node["status"] == "online"
    props = svc.build_synology_properties(node)
    keys = {p["key"] for p in props}
    assert {"Model", "Serial", "DSM", "RAM", "Disk", "Volume 1", "Source"} <= keys
    assert all(p["visible"] is False for p in props)


def test_default_check_https_vs_tcp() -> None:
    assert svc.default_check("nas", 5001, True) == ("https", "https://nas:5001")
    assert svc.default_check("nas", 5001, False) == ("tcp", "nas:5001")


def test_sanitize_error_hides_credentials() -> None:
    exc = httpx.HTTPStatusError(
        "boom",
        request=httpx.Request("GET", "https://h/webapi/auth.cgi?passwd=secret"),
        response=httpx.Response(401),
    )
    msg = svc._sanitize_synology_error(exc)
    assert "secret" not in msg.lower()
    assert "Authentication failed" in msg


def test_auth_error_messages() -> None:
    assert "OTP" in svc._auth_error_message(403)
    assert "Invalid OTP" in svc._auth_error_message(404)
    assert "username and password" in svc._auth_error_message(400)


def _api_of(request: httpx.Request) -> tuple[str | None, str | None]:
    q = {k: v[0] for k, v in parse_qs(str(request.url.query)).items()}
    api, method = q.get("api"), q.get("method")
    if request.content:
        body = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        api = api or body.get("api")
        method = method or body.get("method")
    return api, method


def _ok(data: dict | list) -> httpx.Response:
    return httpx.Response(200, json={"success": True, "data": data})


def _dsm_handler(request: httpx.Request) -> httpx.Response:
    api, method = _api_of(request)
    if api == "SYNO.API.Info":
        return _ok({
            "SYNO.API.Auth": {"path": "auth.cgi", "minVersion": 1, "maxVersion": 7},
            "SYNO.Core.System": {"path": "entry.cgi", "minVersion": 1, "maxVersion": 3},
            "SYNO.Storage.CGI.Storage": {"path": "entry.cgi", "minVersion": 1, "maxVersion": 1},
            "SYNO.Core.Network.Ethernet": {"path": "entry.cgi", "minVersion": 1, "maxVersion": 1},
        })
    if api == "SYNO.API.Auth" and method == "login":
        return _ok({"sid": "sid-abc"})
    if api == "SYNO.API.Auth" and method == "logout":
        return _ok({})
    if api == "SYNO.Core.System":
        return _ok({
            "model": "DS1821+",
            "serial": "1230ABC",
            "hostname": "nas",
            "firmware_ver": "DSM 7.2.1-69057",
            "ram_size": 8192,
        })
    if api == "SYNO.Storage.CGI.Storage":
        return _ok({
            "volumes": [{
                "id": "volume_1",
                "vol_desc": "Volume 1",
                "status": "normal",
                "size": {"total": str(8 * 1024 ** 3), "used": str(2 * 1024 ** 3)},
            }],
            "disks": [{"id": "sata1", "status": "normal"}],
        })
    if api == "SYNO.Core.Network.Ethernet":
        return _ok({"ifaces": [{"ip": "192.168.1.20", "mac": "AA:BB:CC:DD:EE:FF"}]})
    return httpx.Response(404, json={"success": False})


@pytest.mark.asyncio
async def test_fetch_inventory_happy_path() -> None:
    transport = httpx.MockTransport(_dsm_handler)
    async with httpx.AsyncClient(base_url="https://nas:5001", transport=transport) as client:
        node = await svc._fetch_nas(client, "user", "pass", None, "192.168.1.20")
    assert node["type"] == "nas"
    assert node["ieee_address"] == "syno-1230ABC"
    assert node["ip"] == "192.168.1.20"
    assert node["mac"] == "aa:bb:cc:dd:ee:ff"
    assert node["model"] == "DS1821+"
    assert node["ram_gb"] == 8.0


@pytest.mark.asyncio
async def test_fetch_synology_inventory_sets_https_check() -> None:
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(_dsm_handler)
        return real(*args, **kwargs)

    from unittest.mock import patch
    with patch.object(svc.httpx, "AsyncClient", side_effect=factory):
        nodes = await svc.fetch_synology_inventory("nas", 5001, "user", "pass", verify_tls=True)
    assert len(nodes) == 1
    assert nodes[0]["check_method"] == "https"
    assert nodes[0]["check_target"] == "https://nas:5001"


@pytest.mark.asyncio
async def test_login_failure_is_sanitized() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        api, method = _api_of(request)
        if api == "SYNO.API.Info":
            return _ok({"SYNO.API.Auth": {"path": "auth.cgi", "maxVersion": 6}})
        if api == "SYNO.API.Auth" and method == "login":
            return httpx.Response(200, json={"success": False, "error": {"code": 400}})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(base_url="https://nas:5001", transport=transport) as client:
        with pytest.raises(ConnectionError, match="username and password"):
            await svc._login(client, {"SYNO.API.Auth": {"path": "auth.cgi", "maxVersion": 6}}, "u", "p", None)


@pytest.mark.asyncio
async def test_login_otp_required() -> None:
    api_map = {"SYNO.API.Auth": {"path": "auth.cgi", "maxVersion": 6}}

    def handler(request: httpx.Request) -> httpx.Response:
        api, method = _api_of(request)
        if api == "SYNO.API.Auth" and method == "login":
            return httpx.Response(200, json={"success": False, "error": {"code": 403}})
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(base_url="https://nas:5001", transport=transport) as client:
        with pytest.raises(ConnectionError, match="Two-factor"):
            await svc._login(client, api_map, "u", "p", None)


@pytest.mark.asyncio
async def test_test_connection_returns_message() -> None:
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(_dsm_handler)
        return real(*args, **kwargs)

    from unittest.mock import patch
    with patch.object(svc.httpx, "AsyncClient", side_effect=factory):
        ok, msg = await svc.test_synology_connection("nas", 5001, "user", "pass")
    assert ok is True
    assert "DS1821+" in msg
    assert "pass" not in msg


@pytest.mark.asyncio
async def test_logout_always_runs_after_fetch() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        api, method = _api_of(request)
        calls.append(f"{api}.{method}")
        return _dsm_handler(request)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(base_url="https://nas:5001", transport=transport) as client:
        await svc._fetch_nas(client, "user", "pass", None, "nas")
    assert "SYNO.API.Auth.login" in calls
    assert "SYNO.API.Auth.logout" in calls
    assert calls.index("SYNO.API.Auth.logout") > calls.index("SYNO.API.Auth.login")
