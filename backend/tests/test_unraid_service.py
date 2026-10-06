"""Unit tests for the Unraid import service (parsing, properties, errors)."""

from __future__ import annotations

import httpx
import pytest

from app.services import unraid_service as svc

HOST_UUID = "AA67F8CB-8DEA-8A1D-AB9C-D8BBC16C6573"
HOST_KEY = HOST_UUID.lower()


def _container(name: str, network: str, ip: str = "", mac: str = "", state: str = "RUNNING", **extra) -> dict:
    return {
        "id": f"server:{name}id",
        "names": [f"/{name}"],
        "image": f"img/{name}:latest",
        "state": state,
        "webUiUrl": None,
        "labels": {},
        "lanIpPorts": None,
        "hostConfig": {"networkMode": network},
        "networkSettings": {"Networks": {network: {"IPAddress": ip, "MacAddress": mac}}},
        **extra,
    }


def _payload(containers: list[dict]) -> dict:
    return {
        "info": {
            "system": {"uuid": HOST_UUID, "manufacturer": "MSI", "model": "MS-7D25"},
            "cpu": {"brand": "Core i5-13600K", "threads": 20},
            "os": {"hostname": "Pearl"},
            "primaryNetwork": {"macAddress": "A0:36:9F:77:F9:44", "ipAddress": "10.1.1.231"},
            "versions": {"core": {"unraid": "7.3.1"}},
        },
        "docker": {
            "networks": [
                {"name": "bridge", "driver": "bridge"},
                {"name": "br0", "driver": "ipvlan"},
                {"name": "mv0", "driver": "macvlan"},
                {"name": "host", "driver": "host"},
            ],
            "containers": containers,
        },
    }


def test_host_node_from_info() -> None:
    nodes, edges = svc._parse_inventory(_payload([]))
    assert edges == []
    host = nodes[0]
    assert host["ieee_address"] == f"unraid-host-{HOST_KEY}"
    assert host["type"] == "docker_host"
    assert host["ip"] == "10.1.1.231"
    assert host["mac"] == "a0:36:9f:77:f9:44"
    assert host["cpu_count"] == 20
    assert host["model"] == "MSI MS-7D25"
    assert host["os_version"] == "Unraid 7.3.1"


def test_host_key_falls_back_to_hostname() -> None:
    data = _payload([])
    data["info"]["system"]["uuid"] = None
    nodes, _ = svc._parse_inventory(data)
    assert nodes[0]["ieee_address"] == "unraid-host-pearl"


def test_server_web_ui_is_the_address_the_import_used() -> None:
    assert svc._server_web_ui("10.1.1.231", 80, False)["host"] == "http://10.1.1.231"
    assert svc._server_web_ui("10.1.1.231", 443, True)["host"] == "https://10.1.1.231"
    custom = svc._server_web_ui("tower.local", 8443, True)
    assert (custom["host"], custom["port"], custom["service_name"]) == ("https://tower.local:8443", 8443, "Web UI")
    assert svc._server_web_ui("fd00::5", 80, False)["host"] == "http://[fd00::5]"


def test_container_identity_is_host_and_name() -> None:
    nodes, edges = svc._parse_inventory(_payload([_container("plex", "host")]))
    plex = nodes[1]
    assert plex["ieee_address"] == f"unraid-{HOST_KEY}-ct-plex"
    assert plex["type"] == "docker_container"
    assert plex["parent_ieee"] == f"unraid-host-{HOST_KEY}"
    assert edges == [{"source": f"unraid-host-{HOST_KEY}", "target": plex["id"]}]


def test_bridge_container_gets_no_address() -> None:
    # The 172.x address is internal to the host and the MAC changes on every
    # recreate - neither may identify the container.
    nodes, _ = svc._parse_inventory(_payload([_container("app", "bridge", "172.17.0.3", "12:64:29:75:17:49")]))
    assert nodes[1]["ip"] is None
    assert nodes[1]["mac"] is None


def test_ipvlan_container_gets_ip_but_never_a_mac() -> None:
    # ipvlan shares the parent interface's MAC with the host.
    nodes, _ = svc._parse_inventory(_payload([_container("netdata", "br0", "10.1.1.198", "a0:36:9f:77:f9:44")]))
    assert nodes[1]["ip"] == "10.1.1.198"
    assert nodes[1]["mac"] is None


def test_macvlan_container_keeps_its_own_mac() -> None:
    nodes, _ = svc._parse_inventory(_payload([_container("pihole", "mv0", "10.1.1.53", "02:42:0A:01:01:35")]))
    assert nodes[1]["ip"] == "10.1.1.53"
    assert nodes[1]["mac"] == "02:42:0a:01:01:35"


def test_container_network_mode_resolves_to_a_name() -> None:
    vpn = _container("vpn", "bridge")
    stash = _container("stash", "container:vpnid")
    stash["networkSettings"] = {"Networks": {}}
    nodes, _ = svc._parse_inventory(_payload([vpn, stash]))
    assert nodes[2]["network"] == "container:vpn"


def test_stopped_container_is_offline() -> None:
    nodes, _ = svc._parse_inventory(_payload([_container("old", "bridge", state="EXITED")]))
    assert nodes[1]["status"] == "offline"


def test_container_properties() -> None:
    ct = _container(
        "jellyfin", "bridge",
        webUiUrl="http://10.1.1.231:8096",
        lanIpPorts=["10.1.1.231:8096", "10.1.1.231:8096", "10.1.1.231:7359"],
        labels={"com.docker.compose.project": "media"},
    )
    nodes, _ = svc._parse_inventory(_payload([ct]))
    props = {p["key"]: p["value"] for p in svc.build_unraid_properties(nodes[1])}
    assert props["Image"] == "img/jellyfin:latest"
    assert props["Ports"] == "10.1.1.231:7359, 10.1.1.231:8096"
    assert "Web UI" not in props
    assert props["Compose Project"] == "media"
    assert props["Source"] == "Unraid"


def test_web_ui_becomes_a_service() -> None:
    ct = _container("jellyfin", "bridge", webUiUrl="http://10.1.1.231:8096")
    nodes, _ = svc._parse_inventory(_payload([ct]))
    assert nodes[1]["services"] == [{
        "port": 8096, "protocol": "tcp", "service_name": "Web UI",
        "host": "http://10.1.1.231:8096", "path": "",
    }]


def test_web_ui_points_at_the_containers_own_lan_ip() -> None:
    # Unraid resolves [IP] to the server, but an ipvlan/macvlan container only
    # answers on its own address.
    ct = _container("netdata", "br0", "10.1.1.198", webUiUrl="http://10.1.1.231:19999")
    nodes, _ = svc._parse_inventory(_payload([ct]))
    assert nodes[1]["services"][0]["host"] == "http://10.1.1.198:19999"


def test_web_ui_service_unescapes_the_template_query() -> None:
    service = svc._web_ui_service(
        "http://10.1.1.231:6080/vnc.html?resize=remote&amp;host=10.1.1.231&amp;port=6080"
    )
    assert service is not None
    assert service["path"] == "/vnc.html?resize=remote&host=10.1.1.231&port=6080"


def test_web_ui_service_defaults_the_scheme_port() -> None:
    service = svc._web_ui_service("https://10.1.1.231/")
    assert service is not None
    assert service["port"] == 443
    assert service["host"] == "https://10.1.1.231"


def test_no_service_without_a_usable_web_ui() -> None:
    assert svc._web_ui_service(None) is None
    assert svc._web_ui_service("ftp://10.1.1.231:21") is None
    assert svc._web_ui_service("http://10.1.1.231:notaport") is None
    nodes, _ = svc._parse_inventory(_payload([_container("redis", "bridge")]))
    assert nodes[1]["services"] == []


def test_malformed_payload_raises() -> None:
    with pytest.raises(ValueError):
        svc._parse_inventory({"info": None, "docker": {}})


def test_unauthenticated_graphql_error_is_auth_error() -> None:
    payload = {"errors": [{"message": "API key validation failed", "extensions": {"code": "UNAUTHENTICATED"}}]}
    with pytest.raises(svc.UnraidAuthError):
        svc._graphql_errors(payload)


def test_other_graphql_error_is_value_error() -> None:
    with pytest.raises(ValueError, match="boom"):
        svc._graphql_errors({"errors": [{"message": "boom"}]})


def test_client_uses_the_chosen_scheme() -> None:
    assert svc._client("tower", 8080, "k", False, False).base_url.scheme == "http"
    assert svc._client("tower", 8443, "k", False, True).base_url.scheme == "https"


def test_redirect_to_https_says_to_use_https() -> None:
    req = httpx.Request("POST", "http://tower:80/graphql")
    resp = httpx.Response(302, request=req, headers={"location": "https://tower/graphql"})
    exc = httpx.HTTPStatusError("x", request=req, response=resp)
    assert svc._sanitize_unraid_error(exc) == "This server uses HTTPS - tick 'Use HTTPS'"


def test_https_to_a_plain_http_port_says_to_untick() -> None:
    exc = httpx.ConnectError("[SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:1032)")
    assert "untick 'Use HTTPS'" in svc._sanitize_unraid_error(exc)


def test_sanitizer_hides_details() -> None:
    req = httpx.Request("POST", "https://h/graphql", headers={"x-api-key": "secret"})
    exc = httpx.HTTPStatusError("x", request=req, response=httpx.Response(403, request=req))
    msg = svc._sanitize_unraid_error(exc)
    assert "secret" not in msg
    assert "Authentication failed" in msg
    assert "TLS" in svc._sanitize_unraid_error(httpx.ConnectError("certificate verify failed"))


VMS = [
    {"id": "server:AC4A600A-C5F8-C5A5-B82A-5F9B46FC8167", "name": "UbuntuServer", "state": "RUNNING"},
    {"id": "server:bde24b48-b75b-24de-0280-c2aacec154b5", "name": "Mhmmint", "state": "SHUTOFF"},
]


def test_vm_nodes_are_keyed_on_their_uuid() -> None:
    nodes, edges = svc._parse_inventory(_payload([]), VMS)
    ubuntu, mint = nodes[1], nodes[2]
    assert ubuntu["ieee_address"] == f"unraid-{HOST_KEY}-vm-ac4a600a-c5f8-c5a5-b82a-5f9b46fc8167"
    assert ubuntu["type"] == "vm"
    assert ubuntu["status"] == "online"
    assert mint["status"] == "offline"
    # No address of its own in the API: nothing to match a scanned row on.
    assert ubuntu["ip"] is None and ubuntu["mac"] is None
    assert edges[0] == {"source": f"unraid-host-{HOST_KEY}", "target": ubuntu["id"]}
    props = {p["key"]: p["value"] for p in svc.build_unraid_properties(ubuntu)}
    assert props["UUID"] == "ac4a600a-c5f8-c5a5-b82a-5f9b46fc8167"


def _mock_client(monkeypatch: pytest.MonkeyPatch, vm_response: dict) -> None:
    """Answer the inventory query with one container and the VM query with ``vm_response``."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-api-key"] == "k"
        query = request.read().decode()
        if "vms" in query:
            return httpx.Response(200, json=vm_response)
        if "versions" in query and "docker" not in query:
            return httpx.Response(200, json={"data": {"info": {
                "os": {"hostname": "Pearl"}, "versions": {"core": {"unraid": "7.3.1"}},
            }}})
        return httpx.Response(200, json={"data": _payload([_container("plex", "host")])})

    def fake_client(host: str, port: int, api_key: str, verify_tls: bool, use_https: bool) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=f"{'https' if use_https else 'http'}://{host}:{port}",
            headers={"x-api-key": api_key},
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(svc, "_client", fake_client)


FORBIDDEN = {"errors": [{"message": "Forbidden", "extensions": {"code": "FORBIDDEN"}}], "data": None}


@pytest.mark.asyncio
async def test_fetch_inventory_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_client(monkeypatch, {"data": {"vms": {"domains": VMS}}})
    nodes, edges, notice = await svc.fetch_unraid_inventory("h", 443, "k", verify_tls=False, use_https=True)
    assert [n["type"] for n in nodes] == ["docker_host", "docker_container", "vm", "vm"]
    assert nodes[0]["services"] == [svc._server_web_ui("h", 443, True)]
    assert len(edges) == 3
    assert notice is None


@pytest.mark.asyncio
async def test_no_vm_access_keeps_the_containers(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_client(monkeypatch, FORBIDDEN)
    nodes, _, notice = await svc.fetch_unraid_inventory("h", 443, "k", verify_tls=False)
    assert [n["type"] for n in nodes] == ["docker_host", "docker_container"]
    assert notice is not None and "no read access to VMs" in notice


@pytest.mark.asyncio
async def test_connection_test_mentions_missing_vm_access(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_client(monkeypatch, FORBIDDEN)
    connected, message = await svc.test_unraid_connection("h", 443, "k", verify_tls=False)
    assert connected is True
    assert message.startswith("Connected to Pearl (Unraid 7.3.1)")
    assert "no read access to VMs" in message
