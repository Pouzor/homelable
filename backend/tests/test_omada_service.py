"""Tests for the TP-Link Omada Open API client.

The fake controller below answers with the documented Open API shapes: every
reply is HTTP 200 with an ``errorCode`` (0 on success) and a ``result``, lists
are paged as ``{totalRows, currentPage, currentSize, data}``, and MACs come
upper-case and dash-separated.
"""
import json
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.services.omada_service import (
    fetch_omada_inventory,
    normalize_omada_url,
)

# Aliased: a module-level name starting with `test_` would be collected as a test.
from app.services.omada_service import test_omada_connection as check_connection

_URL = "https://omada.lan:8043"
_CID = "c0ffee1234"
_TOKEN = "AT-abc123"

_SITES = [
    {"siteId": "site-home", "name": "Home"},
    {"siteId": "site-lab", "name": "Lab"},
]

_DEVICES = {
    "site-home": [
        {
            "mac": "50-C7-BF-00-00-01",
            "name": "ER605",
            "type": "gateway",
            "model": "ER605",
            "ip": "192.168.0.1",
            "firmwareVersion": "2.2.3",
            "sn": "Y2200000001",
            "uptime": "4day(s) 17h 26m 57s",
        },
        {
            "mac": "50-C7-BF-00-00-02",
            "name": "Core Switch",
            "type": "switch",
            "model": "TL-SG2210P",
            "ip": "192.168.0.2",
            "uplinkDeviceMac": "50-C7-BF-00-00-01",
            "uplinkDeviceName": "ER605",
            "uplinkDevicePort": 2,
        },
        {
            "mac": "50-C7-BF-00-00-03",
            "name": "Living Room AP",
            "type": "ap",
            "model": "EAP653",
            "ip": "192.168.0.3",
            "uplinkDeviceMac": "50-C7-BF-00-00-02",
            "uplinkDeviceName": "Core Switch",
            "uplinkDevicePort": 5,
        },
    ],
    "site-lab": [
        {"mac": "50-C7-BF-00-00-09", "name": "Lab AP", "type": "ap", "ip": "10.0.0.9"},
    ],
}

_CLIENTS = {
    "site-home": [
        {
            "mac": "AA-BB-CC-00-00-01",
            "name": "nas",
            "hostName": "nas.lan",
            "ip": "192.168.0.10",
            "vendor": "Synology",
            "wireless": False,
            "connectDevType": "switch",
            "switchMac": "50-C7-BF-00-00-02",
            "switchName": "Core Switch",
            "port": 3,
            "networkName": "LAN",
            "vid": 1,
        },
        {
            "mac": "AA-BB-CC-00-00-02",
            "hostName": "phone",
            "ip": "192.168.0.11",
            "wireless": True,
            "connectDevType": "ap",
            "apMac": "50-C7-BF-00-00-03",
            "apName": "Living Room AP",
            "ssid": "home-wifi",
        },
    ],
    "site-lab": [],
}


def _ok(result: Any) -> httpx.Response:
    return httpx.Response(200, json={"errorCode": 0, "msg": "Success.", "result": result})


def _fail(code: int, msg: str) -> httpx.Response:
    return httpx.Response(200, json={"errorCode": code, "msg": msg})


def _page(rows: list[dict[str, Any]], page: int, size: int) -> dict[str, Any]:
    chunk = rows[(page - 1) * size: page * size]
    return {"totalRows": len(rows), "currentPage": page, "currentSize": size, "data": chunk}


class _Controller:
    """A fake controller; ``v2_clients=False`` plays a 5.x one without v2."""

    def __init__(
        self,
        *,
        devices: dict[str, list[dict[str, Any]]] | None = None,
        clients: dict[str, list[dict[str, Any]]] | None = None,
        v2_clients: bool = True,
        publishes_id: bool = True,
    ) -> None:
        self.devices = _DEVICES if devices is None else devices
        self.clients = _CLIENTS if clients is None else clients
        self.v2_clients = v2_clients
        self.publishes_id = publishes_id
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/api/info":
            if not self.publishes_id:
                return httpx.Response(404, text="Not Found")
            return _ok({"controllerVer": "5.15.24", "apiVer": "3", "omadacId": _CID})
        if path == "/openapi/authorize/token":
            body = json.loads(request.content)
            if (
                request.url.params.get("grant_type") != "client_credentials"
                or body.get("omadacId") != _CID
            ):
                return _fail(-44106, "The client id or client secret is invalid.")
            if body.get("client_secret") != "secret":
                return _fail(-44106, "The client id or client secret is invalid.")
            return _ok({"accessToken": _TOKEN, "tokenType": "bearer", "expiresIn": 7200})
        if request.headers.get("authorization") != f"AccessToken={_TOKEN}":
            return _fail(-44112, "The access token has expired.")
        prefix_v1 = f"/openapi/v1/{_CID}/sites"
        prefix_v2 = f"/openapi/v2/{_CID}/sites"
        page = int(request.url.params.get("page", 1))
        size = int(request.url.params.get("pageSize", 1000))
        if path == prefix_v1:
            return _ok(_page(_SITES, page, size))
        for site_id in self.devices:
            if path == f"{prefix_v1}/{site_id}/devices":
                return _ok(_page(self.devices[site_id], page, size))
            if path == f"{prefix_v2}/{site_id}/clients":
                if not self.v2_clients:
                    return httpx.Response(404, text="Not Found")
                body = json.loads(request.content)
                assert body["scope"] == 1
                return _ok(_page(self.clients[site_id], body["page"], body["pageSize"]))
            if path == f"{prefix_v1}/{site_id}/clients":
                return _ok(_page(self.clients[site_id], page, size))
        return _fail(-1001, "Invalid request parameters.")


class _TransportClient:
    """Patch target for httpx.AsyncClient routing through a MockTransport."""

    def __init__(self, handler):
        self._handler = handler
        self._real = httpx.AsyncClient

    def __call__(self, **kwargs):
        kwargs.pop("verify", None)
        return self._real(transport=httpx.MockTransport(self._handler), **kwargs)


def _patch(handler):
    return patch("app.services.omada_service.httpx.AsyncClient", _TransportClient(handler))


async def _fetch(**kwargs: Any) -> list[dict[str, Any]]:
    args: dict[str, Any] = {
        "url": _URL, "omada_id": "", "client_id": "client", "client_secret": "secret",
    }
    args.update(kwargs)
    return await fetch_omada_inventory(**args)


def _by_mac(devices: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {d["mac"]: d for d in devices}


def _props(dev: dict[str, Any]) -> dict[str, str]:
    return {p["key"]: p["value"] for p in dev["properties"]}


# ── authorization ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reads_the_omada_id_and_sends_the_token_on_every_call() -> None:
    controller = _Controller()
    with _patch(controller):
        devices = await _fetch()

    assert len(devices) == 4
    paths = [r.url.path for r in controller.requests]
    assert paths[:3] == ["/api/info", "/openapi/authorize/token", f"/openapi/v1/{_CID}/sites"]
    for request in controller.requests[2:]:
        assert request.headers["authorization"] == f"AccessToken={_TOKEN}"


@pytest.mark.asyncio
async def test_a_given_omada_id_skips_the_info_lookup() -> None:
    controller = _Controller(publishes_id=False)
    with _patch(controller):
        await _fetch(omada_id=_CID)
    assert "/api/info" not in [r.url.path for r in controller.requests]


@pytest.mark.asyncio
async def test_a_controller_that_does_not_publish_its_id_asks_for_it() -> None:
    """A cloud-based controller has no /api/info: the Omada ID must be entered."""
    with _patch(_Controller(publishes_id=False)):
        ok, message, _ = await check_connection(_URL, "", "client", "secret")
    assert ok is False
    assert "Omada ID" in message


@pytest.mark.asyncio
async def test_a_rejected_secret_reports_the_controllers_reason() -> None:
    with _patch(_Controller()):
        ok, message, counts = await check_connection(_URL, "", "client", "wrong")
    assert ok is False
    assert "client id or client secret is invalid" in message
    assert "-44106" in message
    assert counts == {}


@pytest.mark.asyncio
async def test_a_redirect_is_reported_not_followed() -> None:
    """The secret must never be re-posted to a host the user did not enter."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://elsewhere.example/login"})

    with _patch(handler):
        ok, message, _ = await check_connection(_URL, _CID, "client", "secret")
    assert ok is False
    assert "elsewhere.example" in message
    assert all(url.startswith(_URL) for url in seen)


@pytest.mark.asyncio
async def test_an_unreachable_controller_is_named() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with _patch(handler):
        ok, message, _ = await check_connection(_URL, _CID, "client", "secret")
    assert ok is False
    assert message.startswith(f"Cannot reach {_URL}")


@pytest.mark.asyncio
async def test_a_url_without_the_open_api_gets_a_url_hint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="<html>Not Found</html>")

    with _patch(handler):
        ok, message, _ = await check_connection(_URL, _CID, "client", "secret")
    assert ok is False
    assert "No Omada Open API" in message


# ── what is imported ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_devices_are_typed_and_carry_their_uplink() -> None:
    with _patch(_Controller()):
        devices = _by_mac(await _fetch())

    gateway = devices["50:c7:bf:00:00:01"]
    assert gateway["type"] == "router"
    assert gateway["ieee_address"] == "omada-50:c7:bf:00:00:01"
    assert gateway["ip"] == "192.168.0.1"
    assert gateway["vendor"] == "TP-Link"
    assert gateway["model"] == "ER605"
    assert gateway["source"] == "omada"
    assert _props(gateway) == {
        "Omada type": "gateway",
        "Model": "ER605",
        "Firmware": "2.2.3",
        "Serial": "Y2200000001",
        "Uptime": "4day(s) 17h 26m 57s",
        "Omada site": "Home",
    }
    assert all(p["visible"] is False for p in gateway["properties"])

    switch = devices["50:c7:bf:00:00:02"]
    assert switch["type"] == "switch"
    assert _props(switch)["Uplink"] == "ER605 (50:c7:bf:00:00:01)"
    assert _props(switch)["Uplink port"] == "2"
    assert devices["50:c7:bf:00:00:03"]["type"] == "ap"
    assert _props(devices["50:c7:bf:00:00:09"])["Omada site"] == "Lab"


@pytest.mark.asyncio
async def test_clients_are_opt_in() -> None:
    with _patch(_Controller()):
        devices = await _fetch()
    assert {d["source"] for d in devices} == {"omada"}


@pytest.mark.asyncio
async def test_clients_carry_what_they_hang_off() -> None:
    with _patch(_Controller()):
        devices = _by_mac(await _fetch(infrastructure=False, clients=True))

    assert set(devices) == {"aa:bb:cc:00:00:01", "aa:bb:cc:00:00:02"}
    nas = devices["aa:bb:cc:00:00:01"]
    assert nas["source"] == "omada-client"
    assert nas["type"] == "computer"
    assert nas["hostname"] == "nas"
    assert nas["vendor"] == "Synology"
    assert _props(nas) == {
        "Connection": "wired",
        "Switch": "Core Switch (50:c7:bf:00:00:02)",
        "Port": "3",
        "Network": "LAN",
        "VLAN": "1",
        "Omada site": "Home",
    }

    phone = devices["aa:bb:cc:00:00:02"]
    assert phone["hostname"] == "phone"  # no alias: falls back to hostName
    assert _props(phone)["Access point"] == "Living Room AP (50:c7:bf:00:00:03)"
    assert _props(phone)["SSID"] == "home-wifi"
    assert "Port" not in _props(phone)


@pytest.mark.asyncio
async def test_clients_fall_back_to_v1_on_a_controller_without_v2() -> None:
    controller = _Controller(v2_clients=False)
    with _patch(controller):
        devices = await _fetch(infrastructure=False, clients=True)

    assert len(devices) == 2
    paths = [r.url.path for r in controller.requests]
    assert f"/openapi/v1/{_CID}/sites/site-home/clients" in paths
    assert f"/openapi/v1/{_CID}/sites/site-lab/clients" in paths
    # Probed once, not once per site.
    assert sum("/openapi/v2/" in p for p in paths) == 1


@pytest.mark.asyncio
async def test_a_device_also_listed_as_a_client_is_one_row_infrastructure_first() -> None:
    clients = {
        "site-home": [{
            "mac": "50-C7-BF-00-00-03", "name": "eap-as-client", "ip": "192.168.0.3",
            "wireless": False, "networkName": "LAN",
        }],
        "site-lab": [],
    }
    with _patch(_Controller(clients=clients)):
        devices = _by_mac(await _fetch(clients=True))

    ap = devices["50:c7:bf:00:00:03"]
    assert ap["source"] == "omada"
    assert ap["type"] == "ap"
    assert ap["hostname"] == "Living Room AP"
    # What only the client record knew is kept.
    assert _props(ap)["Network"] == "LAN"


@pytest.mark.asyncio
async def test_long_lists_are_read_page_by_page() -> None:
    many = [
        {"mac": f"50-C7-BF-01-{i // 256:02X}-{i % 256:02X}", "type": "ap"} for i in range(1500)
    ]
    controller = _Controller(devices={"site-home": many, "site-lab": []})
    with _patch(controller):
        devices = await _fetch(site="Home")

    assert len(devices) == 1500
    pages = [
        r.url.params["page"] for r in controller.requests
        if r.url.path.endswith("/site-home/devices")
    ]
    assert pages == ["1", "2"]


@pytest.mark.asyncio
async def test_a_record_without_a_mac_is_skipped() -> None:
    devices = {"site-home": [{"name": "ghost", "type": "ap"}], "site-lab": []}
    with _patch(_Controller(devices=devices)):
        assert await _fetch() == []


# ── sites ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_site_is_picked_by_name_in_any_case() -> None:
    controller = _Controller()
    with _patch(controller):
        devices = await _fetch(site="lab")

    assert [d["hostname"] for d in devices] == ["Lab AP"]
    assert not any("site-home" in r.url.path for r in controller.requests)


@pytest.mark.asyncio
async def test_an_unknown_site_lists_the_real_ones() -> None:
    with _patch(_Controller()):
        ok, message, _ = await check_connection(_URL, "", "client", "secret", site="Office")
    assert ok is False
    assert "Site 'Office' not found" in message
    assert "Home, Lab" in message


@pytest.mark.asyncio
async def test_connection_test_counts_each_source_asked_for() -> None:
    with _patch(_Controller()):
        ok, message, counts = await check_connection(
            _URL, "", "client", "secret", clients=True,
        )
    assert ok is True
    assert counts == {"infrastructure": 4, "clients": 2}
    assert message == "Connected — 4 device(s) found in 2 site(s)"


# ── URL ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["", "   ", "ftp://omada.lan", "https://", "https://omada.lan/?x=1"])
def test_normalize_omada_url_rejects_what_is_not_a_controller_url(raw: str) -> None:
    with pytest.raises(ValueError):
        normalize_omada_url(raw)


def test_normalize_omada_url_keeps_a_reverse_proxy_path() -> None:
    assert normalize_omada_url("https://proxy.lan/omada/") == "https://proxy.lan/omada"
