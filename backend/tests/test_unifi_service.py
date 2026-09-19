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
        connected, message, _ = await check_connection(
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
        connected, message, _ = await check_connection(
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
        connected, message, _ = await check_connection(
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
        connected, message, _ = await check_connection(
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
    assert {"key": "Firmware", "value": "8.6.11.18870", "icon": "CircuitBoard",
            "visible": False} in ap["properties"]


# ── import modes ────────────────────────────────────────────────────────────

_KNOWN_CLIENTS = [
    # A hand-added client: what list/user really carries — no IP, no uplink.
    {
        "_id": "6aaef4dff140c244eb55edbd",
        "mac": "bc:24:11:8d:26:ed",
        "name": "Paperless",
        "oui": "Proxmox Server Solutions GmbH",
        "is_wired": True,
        "noted": True,
    },
    {"mac": "bc:24:11:00:00:99", "hostname": "nas", "oui": "Synology"},
]

_ACTIVE_CLIENTS = [
    # Same MAC as Paperless above, seen live: this is where the IP lives.
    {
        "mac": "bc:24:11:8d:26:ed",
        "ip": "192.168.1.50",
        "hostname": "paperless",
        "is_wired": True,
        "sw_mac": "00:27:22:e0:00:02",
        "sw_port": 7,
        "network": "LAN",
    },
]


def _full_controller(site: str = "default"):
    """A controller serving all three inventories on the legacy paths."""

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
            return _ok(_DEVICES)
        if path == f"/api/s/{site}/list/user":
            return _ok(_KNOWN_CLIENTS)
        if path == f"/api/s/{site}/stat/sta":
            return _ok(_ACTIVE_CLIENTS)
        return _err("api.err.NoSiteContext")

    return handler


async def _fetch(**modes):
    ctx, factory = _patch(_full_controller())
    with ctx:
        devices = await fetch_unifi_inventory(
            "unifi.local", 8443, "default", "admin", "pw", **modes
        )
    return devices, [r.url.path for r in factory.requests]


@pytest.mark.asyncio
async def test_infrastructure_only_is_the_default() -> None:
    devices, paths = await _fetch()
    assert len(devices) == 3
    assert {d["source"] for d in devices} == {"unifi"}
    # No client endpoint is even contacted.
    assert not any("list/user" in p or "stat/sta" in p for p in paths)


@pytest.mark.asyncio
async def test_known_clients_can_be_imported_alone() -> None:
    devices, paths = await _fetch(infrastructure=False, known_clients=True)
    assert [d["hostname"] for d in devices] == ["Paperless", "nas"]
    assert {d["source"] for d in devices} == {"unifi-client"}
    assert all(d["type"] == "computer" for d in devices)
    # list/user carries no address — the entry lands without one.
    assert devices[0]["ip"] is None
    assert devices[0]["vendor"] == "Proxmox Server Solutions GmbH"
    assert not any("stat/device" in p for p in paths)


@pytest.mark.asyncio
async def test_active_clients_carry_the_live_attachment() -> None:
    devices, _ = await _fetch(infrastructure=False, active_clients=True)
    assert len(devices) == 1
    props = {p["key"]: p["value"] for p in devices[0]["properties"]}
    assert devices[0]["ip"] == "192.168.1.50"
    assert props["Switch"] == "00:27:22:e0:00:02"
    assert props["Switch port"] == "7"
    assert props["Connection"] == "wired"


@pytest.mark.asyncio
async def test_a_client_in_both_sources_is_merged_once() -> None:
    devices, _ = await _fetch(
        infrastructure=False, known_clients=True, active_clients=True
    )
    macs = [d["mac"] for d in devices]
    assert macs.count("bc:24:11:8d:26:ed") == 1
    paperless = next(d for d in devices if d["mac"] == "bc:24:11:8d:26:ed")
    # Live data wins for the IP, and the OUI from list/user survives.
    assert paperless["ip"] == "192.168.1.50"
    assert paperless["vendor"] == "Proxmox Server Solutions GmbH"
    assert {p["key"] for p in paperless["properties"]} >= {"Switch port", "OUI"}


@pytest.mark.asyncio
async def test_every_source_at_once() -> None:
    devices, _ = await _fetch(
        infrastructure=True, known_clients=True, active_clients=True
    )
    assert len(devices) == 5  # 3 infra + 2 distinct clients
    assert [d["source"] for d in devices].count("unifi") == 3
    assert [d["source"] for d in devices].count("unifi-client") == 2


@pytest.mark.asyncio
async def test_a_client_without_a_mac_is_skipped() -> None:
    from app.services.unifi_service import _normalize_client

    assert _normalize_client({"name": "ghost"}) is None


@pytest.mark.asyncio
async def test_test_connection_counts_only_the_requested_sources() -> None:
    ctx, factory = _patch(_full_controller())
    with ctx:
        connected, _msg, counts = await check_connection(
            "unifi.local", 8443, "default", "admin", "pw", known_clients=True
        )
    assert connected is True
    # Infrastructure always — it is the reachability check. stat/sta untouched.
    assert counts == {"infrastructure": 3, "known_clients": 2}
    assert not any("stat/sta" in p for p in (r.url.path for r in factory.requests))


@pytest.mark.asyncio
async def test_test_connection_counts_every_source_when_asked() -> None:
    ctx, _ = _patch(_full_controller())
    with ctx:
        _c, _m, counts = await check_connection(
            "unifi.local", 8443, "default", "admin", "pw",
            known_clients=True, active_clients=True,
        )
    assert counts == {"infrastructure": 3, "known_clients": 2, "active_clients": 1}


# ── the NodeProperty contract ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_properties_follow_the_node_property_contract() -> None:
    """key/value/icon/visible — not the {name, value} pairs this used to emit.

    The inventory and the canvas address a property row by its `key`
    (`_property_view_key`), and PropertyList reads `key`, `icon` and `visible`.
    A `name` pair collapsed every row onto one keyless entry.
    """
    devices, _ = await _fetch(
        infrastructure=True, known_clients=True, active_clients=True
    )
    for dev in devices:
        for prop in dev["properties"]:
            assert set(prop) == {"key", "value", "icon", "visible"}
            assert isinstance(prop["key"], str) and prop["key"]
            # Opt-in, like the Proxmox and mesh importers build theirs.
            assert prop["visible"] is False


@pytest.mark.asyncio
async def test_a_wired_and_a_wifi_client_get_different_icons() -> None:
    from app.services.unifi_service import _normalize_client

    wired = _normalize_client({"mac": "aa:bb:cc:dd:ee:01", "is_wired": True})
    wifi = _normalize_client({"mac": "aa:bb:cc:dd:ee:02", "is_wired": False})
    assert wired is not None and wifi is not None
    assert wired["properties"][0]["icon"] == "EthernetPort"
    assert wifi["properties"][0]["icon"] == "Wifi"


@pytest.mark.asyncio
async def test_every_icon_is_one_the_front_end_can_render() -> None:
    """PROPERTY_ICONS in frontend/src/utils/propertyIcons.ts is the whole set."""
    known = {
        "Battery", "Box", "CircuitBoard", "Clock", "Cpu", "Database",
        "EthernetPort", "Globe", "Gpu", "HardDrive", "HdmiPort", "Hash", "Key",
        "Layers", "Link", "MemoryStick", "Monitor", "Network", "Server",
        "Shield", "Tag", "Thermometer", "Usb", "Wifi", "Zap",
    }
    devices, _ = await _fetch(
        infrastructure=True, known_clients=True, active_clients=True
    )
    used = {p["icon"] for d in devices for p in d["properties"] if p["icon"]}
    assert used and used <= known, f"unknown icon(s): {used - known}"
