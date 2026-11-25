"""Tests for the Tailscale API client.

The device records are trimmed copies of the shape ``GET
/api/v2/tailnet/-/devices?fields=all`` returns, so the mapping is exercised
against real field names rather than invented ones.
"""

from unittest.mock import patch

import httpx
import pytest

from app.services.tailscale_service import (
    TOKEN_URL,
    TailscaleApiError,
    TailscaleAuthError,
    fetch_tailscale_inventory,
    normalize_device,
)

# Aliased: a module-level name starting with `test_` would be collected as a test.
from app.services.tailscale_service import test_tailscale_connection as check_connection

_DEVICES_PATH = "/api/v2/tailnet/-/devices"

_SERVER = {
    "addresses": ["100.101.102.103", "fd7a:115c:a1e0::1234:5678"],
    "id": "4512345678901234",
    "nodeId": "nAbCdEf1CNTRL",
    "user": "craig@example.com",
    "name": "vps-clone.tail1234.ts.net",
    "hostname": "vps-clone",
    "clientVersion": "1.80.3-t1234abcd",
    "os": "linux",
    "distro": {"name": "ubuntu", "version": "24.04", "codeName": "noble"},
    "created": "2026-03-01T10:00:00Z",
    "lastSeen": "2026-11-23T07:59:12Z",
    "connectedToControl": True,
    "authorized": True,
    "isExternal": False,
    "keyExpiryDisabled": True,
    "tags": ["tag:server"],
    "advertisedRoutes": ["192.168.1.0/24", "0.0.0.0/0", "::/0"],
    "enabledRoutes": ["192.168.1.0/24"],
    "clientConnectivity": {"endpoints": ["192.168.1.170:41641", "172.17.0.1:41641", "41.0.0.9:41641"]},
}

_PHONE = {
    "addresses": ["100.70.1.2"],
    "id": "4512345678900001",
    "nodeId": "nPhone1CNTRL",
    "name": "pixel.tail1234.ts.net",
    "hostname": "Pixel 9",
    "os": "android",
    "connectedToControl": False,
    "isExternal": False,
    "expires": "2027-05-01T00:00:00Z",
    "tags": [],
}

_SHARED = {
    "addresses": ["100.90.9.9"],
    "id": "4512345678909999",
    "nodeId": "nShared1CNTRL",
    "name": "friends-nas.other.ts.net",
    "hostname": "friends-nas",
    "os": "linux",
    "isExternal": True,
}


class _TransportClient:
    """Patch target for httpx.AsyncClient routing through a MockTransport.

    Real client, fake network: the service exercises the genuine httpx request
    path. `requests` records what was actually sent.
    """

    def __init__(self, handler):
        self._handler = handler
        self._real = httpx.AsyncClient
        self.requests: list[httpx.Request] = []

    def _record(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._handler(request)

    def __call__(self, **kwargs):
        return self._real(transport=httpx.MockTransport(self._record), **kwargs)


def _patch(handler) -> tuple:
    factory = _TransportClient(handler)
    return patch("app.services.tailscale_service.httpx.AsyncClient", factory), factory


def _tailnet(devices: list, *, token_status: int = 200, devices_status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == TOKEN_URL:
            if token_status != 200:
                return httpx.Response(token_status, json={"message": "invalid client"})
            return httpx.Response(
                200, json={"access_token": "tskey-oauth-abc", "token_type": "Bearer", "expires_in": 3600}
            )
        if request.url.path == _DEVICES_PATH:
            if devices_status != 200:
                return httpx.Response(devices_status, json={"message": "nope"})
            return httpx.Response(200, json={"devices": devices})
        return httpx.Response(404, json={"message": "not found"})

    return handler


_OAUTH = {"api_key": None, "client_id": "kCLIENT", "client_secret": "tskey-client-secret", "tailnet": "-"}
_API_KEY = {"api_key": "tskey-api-xyz", "client_id": None, "client_secret": None, "tailnet": "-"}


# ── credentials ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oauth_client_is_exchanged_for_a_bearer_token() -> None:
    ctx, factory = _patch(_tailnet([_SERVER]))
    with ctx:
        devices = await fetch_tailscale_inventory(**_OAUTH)
    assert len(devices) == 1

    token_req, list_req = factory.requests
    assert str(token_req.url) == TOKEN_URL
    body = token_req.content.decode()
    assert "client_id=kCLIENT" in body
    assert "grant_type=client_credentials" in body
    assert list_req.headers["authorization"] == "Bearer tskey-oauth-abc"
    assert list_req.url.params["fields"] == "all"


@pytest.mark.asyncio
async def test_an_api_key_is_used_directly() -> None:
    ctx, factory = _patch(_tailnet([_SERVER]))
    with ctx:
        await fetch_tailscale_inventory(**_API_KEY)
    assert [r.url.path for r in factory.requests] == [_DEVICES_PATH]
    assert factory.requests[0].headers["authorization"] == "Bearer tskey-api-xyz"


@pytest.mark.asyncio
async def test_a_named_tailnet_is_used_in_the_path() -> None:
    ctx, factory = _patch(lambda r: httpx.Response(200, json={"devices": []}))
    with ctx:
        await fetch_tailscale_inventory(**{**_API_KEY, "tailnet": "example.com"})
    assert factory.requests[0].url.path == "/api/v2/tailnet/example.com/devices"


@pytest.mark.asyncio
async def test_a_rejected_oauth_client_is_reported_without_the_secret() -> None:
    ctx, _ = _patch(_tailnet([], token_status=401))
    with ctx, pytest.raises(TailscaleAuthError) as exc:
        await fetch_tailscale_inventory(**_OAUTH)
    assert "OAuth client rejected" in str(exc.value)
    assert "tskey-client-secret" not in str(exc.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "error", "phrase"),
    [
        (401, TailscaleAuthError, "invalid or has expired"),
        (403, TailscaleAuthError, "devices:core:read"),
        (404, TailscaleApiError, "not found"),
        (500, TailscaleApiError, "HTTP 500"),
    ],
)
async def test_device_list_errors_name_the_cause(status: int, error: type, phrase: str) -> None:
    ctx, _ = _patch(_tailnet([], devices_status=status))
    with ctx, pytest.raises(error) as exc:
        await fetch_tailscale_inventory(**_API_KEY)
    assert phrase in str(exc.value)


@pytest.mark.asyncio
async def test_an_unreachable_api_is_a_connection_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    ctx, _ = _patch(handler)
    with ctx, pytest.raises(TailscaleApiError) as exc:
        await fetch_tailscale_inventory(**_API_KEY)
    assert "Cannot reach api.tailscale.com" in str(exc.value)


@pytest.mark.asyncio
async def test_no_credential_at_all_is_refused() -> None:
    with pytest.raises(TailscaleAuthError):
        await fetch_tailscale_inventory(api_key=None, client_id=None, client_secret=None, tailnet="-")


# ── test connection ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connection_counts_what_the_filters_keep() -> None:
    ctx, _ = _patch(_tailnet([_SERVER, _PHONE, _SHARED]))
    with ctx:
        connected, message, count = await check_connection(**_OAUTH)
    assert connected is True
    assert count == 2
    assert "2 device(s)" in message
    assert "1 left out" in message


@pytest.mark.asyncio
async def test_connection_failure_is_reported_not_raised() -> None:
    ctx, _ = _patch(_tailnet([], devices_status=403))
    with ctx:
        connected, message, count = await check_connection(**_API_KEY)
    assert connected is False
    assert count == 0
    assert "devices:core:read" in message


# ── filters ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_shared_in_devices_are_left_out_by_default() -> None:
    ctx, _ = _patch(_tailnet([_SERVER, _SHARED]))
    with ctx:
        devices = await fetch_tailscale_inventory(**_API_KEY)
    assert [d["hostname"] for d in devices] == ["vps-clone"]

    ctx, _ = _patch(_tailnet([_SERVER, _SHARED]))
    with ctx:
        devices = await fetch_tailscale_inventory(**_API_KEY, include_shared=True)
    assert len(devices) == 2


@pytest.mark.asyncio
async def test_a_tag_filter_keeps_only_tagged_devices() -> None:
    ctx, _ = _patch(_tailnet([_SERVER, _PHONE]))
    with ctx:
        devices = await fetch_tailscale_inventory(**_API_KEY, tags=["TAG:Server"])
    assert [d["hostname"] for d in devices] == ["vps-clone"]


# ── normalization ───────────────────────────────────────────────────────────


def _props(dev: dict) -> dict[str, str]:
    return {p["key"]: p["value"] for p in dev["properties"]}


def test_identity_and_addresses() -> None:
    dev = normalize_device(_SERVER)
    assert dev is not None
    assert dev["ieee_address"] == "tailscale-nAbCdEf1CNTRL"
    # Only the tailnet IPv4 is an address: endpoints include a Docker bridge
    # address that repeats on every host, so they never reach `ip`.
    assert dev["ip"] == "100.101.102.103"
    assert dev["mac"] is None
    props = _props(dev)
    assert props["Tailscale IP"] == "100.101.102.103"
    assert props["Tailscale IPv6"] == "fd7a:115c:a1e0::1234:5678"
    assert "172.17.0.1:41641" in props["Endpoints"]


def test_description_fields() -> None:
    dev = normalize_device(_SERVER)
    assert dev is not None
    assert dev["hostname"] == "vps-clone"
    assert dev["label"] == "vps-clone"
    assert dev["type"] == "server"
    assert dev["os"] == "ubuntu 24.04"
    assert dev["online"] is True
    props = _props(dev)
    assert props["MagicDNS name"] == "vps-clone.tail1234.ts.net"
    assert props["Tailscale status"] == "online"
    assert props["Tailscale tags"] == "tag:server"
    assert props["Key expiry"] == "disabled"


def test_routes_and_exit_node() -> None:
    props = _props(normalize_device(_SERVER) or {})
    # The exit-node routes are not subnet routes.
    assert props["Subnet routes"] == "192.168.1.0/24"
    # Advertised but not approved.
    assert props["Exit node"] == "advertised"


def test_a_phone_is_typed_mobile_and_keeps_its_key_expiry() -> None:
    dev = normalize_device(_PHONE)
    assert dev is not None
    assert dev["type"] == "mobile"
    assert dev["label"] == "pixel"
    assert dev["hostname"] == "Pixel 9"
    assert dev["online"] is False
    assert _props(dev)["Key expires"] == "2027-05-01T00:00:00Z"


def test_every_property_starts_hidden() -> None:
    dev = normalize_device(_SERVER)
    assert dev is not None
    assert dev["properties"]
    assert all(p["visible"] is False for p in dev["properties"])


def test_a_record_without_a_node_id_is_skipped() -> None:
    assert normalize_device({"addresses": ["100.1.1.1"], "hostname": "ghost"}) is None


def test_the_legacy_id_stands_in_for_a_missing_node_id() -> None:
    dev = normalize_device({"id": "123", "addresses": ["100.1.1.1"], "hostname": "old"})
    assert dev is not None
    assert dev["ieee_address"] == "tailscale-123"
