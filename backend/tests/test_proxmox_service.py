"""Unit tests for the Proxmox VE import service (parsing, props, sanitizer)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services import proxmox_service as svc


def test_gb_conversion() -> None:
    assert svc._gb(1024 ** 3) == 1.0
    assert svc._gb(2 * 1024 ** 3) == 2.0
    assert svc._gb(0) is None
    assert svc._gb(None) is None
    assert svc._gb("nope") is None


def test_extract_qemu_ip_skips_loopback() -> None:
    payload = {
        "result": [
            {"name": "lo", "ip-addresses": [{"ip-address-type": "ipv4", "ip-address": "127.0.0.1"}]},
            {"name": "eth0", "ip-addresses": [{"ip-address-type": "ipv4", "ip-address": "192.168.1.20"}]},
        ]
    }
    assert svc._extract_qemu_ip(payload) == "192.168.1.20"
    assert svc._extract_qemu_ip(None) is None
    assert svc._extract_qemu_ip({"result": []}) is None


def test_extract_lxc_ip_parses_net0_static() -> None:
    cfg = {"net0": "name=eth0,bridge=vmbr0,ip=192.168.1.30/24,gw=192.168.1.1"}
    assert svc._extract_lxc_ip(cfg) == "192.168.1.30"
    # DHCP → no static IP
    assert svc._extract_lxc_ip({"net0": "name=eth0,bridge=vmbr0,ip=dhcp"}) is None
    assert svc._extract_lxc_ip(None) is None


def test_extract_net_mac_parses_qemu_and_lxc_forms() -> None:
    # qemu: "virtio=<MAC>,bridge=.."
    assert svc._extract_net_mac({"net0": "virtio=BC:24:11:AA:BB:CC,bridge=vmbr0"}) == "bc:24:11:aa:bb:cc"
    # lxc: "..,hwaddr=<MAC>,.."
    assert (
        svc._extract_net_mac({"net0": "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:11:22:33,ip=dhcp"})
        == "bc:24:11:11:22:33"
    )
    # No MAC / missing net0 / None → None
    assert svc._extract_net_mac({"net0": "name=eth0,ip=dhcp"}) is None
    assert svc._extract_net_mac({}) is None
    assert svc._extract_net_mac(None) is None


@pytest.mark.asyncio
async def test_fetch_inventory_captures_guest_mac_from_config() -> None:
    """Guests carry a normalized NIC MAC read agent-free from their config."""
    async def fake_get_json(client, path: str):
        if path == "/nodes":
            return [{"node": "pve1", "status": "online", "maxcpu": 8}]
        if path == "/nodes/pve1/qemu":
            return [{"vmid": 101, "name": "web", "status": "stopped"}]  # stopped: no agent IP
        if path == "/nodes/pve1/lxc":
            return [{"vmid": 200, "name": "db", "status": "running"}]
        if path == "/nodes/pve1/qemu/101/config":
            return {"net0": "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0"}
        if path == "/nodes/pve1/lxc/200/config":
            return {"net0": "name=eth0,bridge=vmbr0,hwaddr=11:22:33:44:55:66,ip=10.0.0.6/24"}
        return None

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=fake_get_json)):
        nodes, _ = await svc.fetch_proxmox_inventory("h", 8006, "u@pam!t", "sec")

    vm = next(n for n in nodes if n["type"] == "vm")
    assert vm["mac"] == "aa:bb:cc:dd:ee:ff"  # captured even though VM is stopped (no IP)
    assert vm["ip"] is None
    ct = next(n for n in nodes if n["type"] == "lxc")
    assert ct["mac"] == "11:22:33:44:55:66"
    assert ct["ip"] == "10.0.0.6"


def test_host_and_guest_node_mapping() -> None:
    host = svc._host_node({"node": "pve1", "status": "online", "maxcpu": 8, "maxmem": 16 * 1024 ** 3, "maxdisk": 500 * 1024 ** 3})
    assert host["type"] == "proxmox"
    assert host["ieee_address"] == "pve-node-pve1"
    assert host["cpu_count"] == 8
    assert host["ram_gb"] == 16.0
    assert host["status"] == "online"
    assert host["parent_ieee"] is None

    vm = svc._guest_node({"vmid": 101, "name": "web", "status": "running", "maxcpu": 2, "maxmem": 2 * 1024 ** 3, "maxdisk": 32 * 1024 ** 3}, "pve1", "qemu", "10.0.0.5")
    assert vm["type"] == "vm"
    assert vm["ieee_address"] == "pve-pve1-101"
    assert vm["ip"] == "10.0.0.5"
    assert vm["status"] == "online"
    assert vm["parent_ieee"] == "pve-node-pve1"

    ct = svc._guest_node({"vmid": 200, "name": "db", "status": "stopped"}, "pve1", "lxc", None)
    assert ct["type"] == "lxc"
    assert ct["status"] == "offline"


def test_build_properties_includes_specs() -> None:
    node = {"vmid": 101, "model": "QEMU", "cpu_count": 4, "ram_gb": 8.0, "disk_gb": 40.0}
    props = svc.build_proxmox_properties(node)
    keys = {p["key"] for p in props}
    assert {"VMID", "CPU Cores", "RAM", "Disk", "Source"} <= keys
    assert all(p["visible"] is False for p in props)


def test_parse_inventory_builds_host_guest_edges() -> None:
    hosts = [{"node": "pve1", "status": "online", "maxcpu": 4}]
    guests = {"pve1": [svc._guest_node({"vmid": 101, "name": "web", "status": "running"}, "pve1", "qemu", None)]}
    nodes, edges = svc._parse_inventory(hosts, guests)
    assert len(nodes) == 2
    assert edges == [{"source": "pve-node-pve1", "target": "pve-pve1-101"}]


def test_build_cluster_links_chains_hosts() -> None:
    nodes = [
        svc._host_node({"node": "pve-a", "status": "online"}),
        svc._guest_node({"vmid": 101, "status": "running"}, "pve-a", "qemu", None),
        svc._host_node({"node": "pve-b", "status": "online"}),
        svc._host_node({"node": "pve-c", "status": "online"}),
    ]
    pairs = svc.build_proxmox_cluster_links(nodes)
    assert pairs == [("pve-node-pve-a", "pve-node-pve-b"), ("pve-node-pve-b", "pve-node-pve-c")]


def test_build_cluster_links_single_host_is_not_a_cluster() -> None:
    nodes = [svc._host_node({"node": "pve-a", "status": "online"})]
    assert svc.build_proxmox_cluster_links(nodes) == []
    # Guests alone never form a cluster.
    guest = svc._guest_node({"vmid": 1, "status": "running"}, "pve-a", "qemu", None)
    assert svc.build_proxmox_cluster_links([guest]) == []


def test_sanitize_error_hides_credentials() -> None:
    exc = httpx.HTTPStatusError(
        "boom", request=httpx.Request("GET", "https://h/api2/json"),
        response=httpx.Response(401),
    )
    msg = svc._sanitize_proxmox_error(exc)
    assert "token" not in msg.lower() or "check the api token" in msg.lower()
    assert "Authentication failed" in msg


@pytest.mark.asyncio
async def test_fetch_inventory_happy_path() -> None:
    async def fake_get_json(client, path: str):
        if path == "/nodes":
            return [{"node": "pve1", "status": "online", "maxcpu": 8, "maxmem": 16 * 1024 ** 3}]
        if path == "/nodes/pve1/qemu":
            return [{"vmid": 101, "name": "web", "status": "running", "maxmem": 2 * 1024 ** 3}]
        if path == "/nodes/pve1/lxc":
            return [{"vmid": 200, "name": "db", "status": "stopped"}]
        if path.endswith("/agent/network-get-interfaces"):
            return {"result": [{"name": "eth0", "ip-addresses": [{"ip-address-type": "ipv4", "ip-address": "10.0.0.5"}]}]}
        if path.endswith("/config"):
            return {"net0": "name=eth0,ip=10.0.0.6/24"}
        return None

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=fake_get_json)):
        nodes, edges = await svc.fetch_proxmox_inventory("h", 8006, "u@pam!t", "sec")

    by_type = {n["type"] for n in nodes}
    assert by_type == {"proxmox", "vm", "lxc"}
    vm = next(n for n in nodes if n["type"] == "vm")
    assert vm["ip"] == "10.0.0.5"
    ct = next(n for n in nodes if n["type"] == "lxc")
    assert ct["ip"] == "10.0.0.6"
    assert len(edges) == 2


@pytest.mark.asyncio
async def test_test_connection_returns_message() -> None:
    async def fake_get_json(client, path: str):
        if path == "/access/permissions":
            return {"/": {"VM.Audit": 1}}  # token has an ACL
        return {"version": "8.2.2"}

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=fake_get_json)):
        ok, msg = await svc.test_proxmox_connection("h", 8006, "u@pam!t", "sec")
    assert ok is True
    assert "8.2.2" in msg
    assert "warning" not in msg.lower()


@pytest.mark.asyncio
async def test_test_connection_warns_when_token_has_no_permissions() -> None:
    async def fake_get_json(client, path: str):
        if path == "/access/permissions":
            return {}  # privilege-separated token with no effective ACL
        return {"version": "8.4.19"}

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=fake_get_json)):
        ok, msg = await svc.test_proxmox_connection("h", 8006, "u@pam!t", "sec")
    # Auth still succeeds; the message flags the permission gap.
    assert ok is True
    assert "8.4.19" in msg
    assert "PVEAuditor" in msg


@pytest.mark.asyncio
async def test_token_has_permissions_treats_empty_as_no_perms() -> None:
    async def fake_get_json(client, path: str):
        return {}

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=fake_get_json)):
        assert await svc._token_has_permissions(object()) is False


@pytest.mark.asyncio
async def test_token_has_permissions_assumes_ok_on_error() -> None:
    async def boom(client, path: str):
        raise httpx.ConnectError("nope")

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=boom)):
        # Never block a valid import on a permissions-probe failure.
        assert await svc._token_has_permissions(object()) is True
