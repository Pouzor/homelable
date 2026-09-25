"""Unit tests for fetch_unifi_topology — hand-built fixtures, no live controller."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.services.unifi_service import fetch_unifi_topology

_CALL_KWARGS = dict(host="unifi.local", port=8443, site="default", username="admin", password="pw")

_EMPTY = {"lldp_edges": [], "client_uplinks": {}, "infra_macs": {}, "device_uplinks": {}, "stp_priorities": {}}


def _patch(login_return=None, devices=None, clients=None):
    if login_return is None:
        login_return = {"token": "x"}
    return (
        patch("app.services.unifi_service._login", new_callable=AsyncMock, return_value=login_return),
        patch("app.services.unifi_service._fetch_devices", new_callable=AsyncMock, return_value=devices or []),
        patch("app.services.unifi_service._fetch_clients", new_callable=AsyncMock, return_value=clients or []),
    )


# ---------------------------------------------------------------------------
# Login failure
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_login_failure_returns_empty() -> None:
    p_login, p_dev, p_cli = _patch(login_return={})
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result == _EMPTY


@pytest.mark.asyncio
async def test_login_none_returns_empty() -> None:
    p_login, p_dev, p_cli = _patch(login_return=None)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result == _EMPTY


# ---------------------------------------------------------------------------
# Exception handling
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_exception_during_fetch_returns_empty() -> None:
    p_login = patch("app.services.unifi_service._login", new_callable=AsyncMock, return_value={"token": "x"})
    p_dev = patch("app.services.unifi_service._fetch_devices", new_callable=AsyncMock, side_effect=RuntimeError("boom"))
    p_cli = patch("app.services.unifi_service._fetch_clients", new_callable=AsyncMock, return_value=[])
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result == _EMPTY


# ---------------------------------------------------------------------------
# infra_macs / _TYPE_MAP translation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_type_map_known_types() -> None:
    devices = [
        {"mac": "aa:bb:cc:dd:ee:01", "type": "ugw", "name": "gw"},
        {"mac": "aa:bb:cc:dd:ee:02", "type": "usw", "name": "sw"},
        {"mac": "aa:bb:cc:dd:ee:03", "type": "uap", "name": "ap"},
        {"mac": "aa:bb:cc:dd:ee:04", "type": "udm", "name": "dm"},
    ]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    im = result["infra_macs"]
    assert im["aa:bb:cc:dd:ee:01"]["type"] == "router"
    assert im["aa:bb:cc:dd:ee:02"]["type"] == "switch"
    assert im["aa:bb:cc:dd:ee:03"]["type"] == "ap"
    assert im["aa:bb:cc:dd:ee:04"]["type"] == "router"


@pytest.mark.asyncio
async def test_type_map_unknown_type_falls_back_to_device() -> None:
    devices = [{"mac": "aa:00:00:00:00:01", "type": "unknown_device_xyz", "name": "x"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["infra_macs"]["aa:00:00:00:00:01"]["type"] == "device"


@pytest.mark.asyncio
async def test_infra_macs_uses_hostname_fallback_when_no_name() -> None:
    devices = [{"mac": "aa:00:00:00:00:02", "type": "uap", "hostname": "ap-hostname"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["infra_macs"]["aa:00:00:00:00:02"]["name"] == "ap-hostname"


@pytest.mark.asyncio
async def test_infra_macs_uses_mac_when_no_name_or_hostname() -> None:
    mac = "aa:00:00:00:00:03"
    devices = [{"mac": mac, "type": "uap"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["infra_macs"][mac]["name"] == mac


# ---------------------------------------------------------------------------
# LLDP edges
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_lldp_edge_added_via_chassis_id() -> None:
    dev_mac = "aa:11:00:00:00:01"
    neighbor_mac = "aa:11:00:00:00:02"
    devices = [
        {"mac": dev_mac, "type": "usw", "name": "sw1",
         "lldp_table": [{"chassis_id": neighbor_mac}]},
        {"mac": neighbor_mac, "type": "usw", "name": "sw2"},
    ]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert (dev_mac, neighbor_mac) in result["lldp_edges"]


@pytest.mark.asyncio
async def test_lldp_edge_added_via_lldp_chassis_id_fallback() -> None:
    dev_mac = "aa:22:00:00:00:01"
    neighbor_mac = "aa:22:00:00:00:02"
    devices = [
        {"mac": dev_mac, "type": "usw", "name": "sw1",
         "lldp_table": [{"lldp_chassis_id": neighbor_mac}]},
    ]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert (dev_mac, neighbor_mac) in result["lldp_edges"]


@pytest.mark.asyncio
async def test_lldp_self_loop_skipped() -> None:
    mac = "aa:33:00:00:00:01"
    devices = [
        {"mac": mac, "type": "usw", "name": "sw",
         "lldp_table": [{"chassis_id": mac}]},
    ]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["lldp_edges"] == []


@pytest.mark.asyncio
async def test_missing_lldp_table_produces_no_edges() -> None:
    devices = [{"mac": "aa:44:00:00:00:01", "type": "uap", "name": "ap"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["lldp_edges"] == []


@pytest.mark.asyncio
async def test_empty_lldp_table_produces_no_edges() -> None:
    devices = [{"mac": "aa:55:00:00:00:01", "type": "uap", "name": "ap", "lldp_table": []}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["lldp_edges"] == []


# ---------------------------------------------------------------------------
# Uplink extraction
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_uplink_mac_primary() -> None:
    dev = "bb:00:00:00:00:01"
    up = "bb:00:00:00:00:02"
    devices = [{"mac": dev, "type": "usw", "name": "sw", "uplink": {"mac": up}}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["device_uplinks"][dev] == up


@pytest.mark.asyncio
async def test_uplink_mac_fallback_to_uplink_mac_key() -> None:
    dev = "bb:11:00:00:00:01"
    up = "bb:11:00:00:00:02"
    devices = [{"mac": dev, "type": "usw", "name": "sw", "uplink": {"uplink_mac": up}}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["device_uplinks"][dev] == up


@pytest.mark.asyncio
async def test_uplink_self_loop_skipped() -> None:
    mac = "bb:22:00:00:00:01"
    devices = [{"mac": mac, "type": "usw", "name": "sw", "uplink": {"mac": mac}}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert mac not in result["device_uplinks"]


@pytest.mark.asyncio
async def test_missing_uplink_not_added() -> None:
    devices = [{"mac": "bb:33:00:00:00:01", "type": "uap", "name": "ap"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["device_uplinks"] == {}


# ---------------------------------------------------------------------------
# STP priority
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stp_priority_top_level() -> None:
    mac = "cc:00:00:00:00:01"
    devices = [{"mac": mac, "type": "usw-8", "name": "sw", "stp_priority": 32768}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["stp_priorities"][mac] == 32768


@pytest.mark.asyncio
async def test_stp_priority_nested_config_fallback() -> None:
    mac = "cc:11:00:00:00:01"
    devices = [{"mac": mac, "type": "usw-pro", "name": "sw", "config": {"stp_priority": 4096}}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["stp_priorities"][mac] == 4096


@pytest.mark.asyncio
async def test_stp_priority_string_coerced_to_int() -> None:
    mac = "cc:22:00:00:00:01"
    devices = [{"mac": mac, "type": "usw-flex", "name": "sw", "stp_priority": "8192"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["stp_priorities"][mac] == 8192


@pytest.mark.asyncio
async def test_stp_priority_non_numeric_suppressed() -> None:
    mac = "cc:33:00:00:00:01"
    devices = [{"mac": mac, "type": "usw-lite", "name": "sw", "stp_priority": "notanumber"}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert mac not in result["stp_priorities"]


@pytest.mark.asyncio
async def test_stp_priority_ignored_for_non_usw_type() -> None:
    mac = "cc:44:00:00:00:01"
    devices = [{"mac": mac, "type": "uap", "name": "ap", "stp_priority": 32768}]
    p_login, p_dev, p_cli = _patch(devices=devices)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["stp_priorities"] == {}


# ---------------------------------------------------------------------------
# Client uplinks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_client_uplink_ap_mac() -> None:
    clients = [{"mac": "dd:00:00:00:00:01", "ap_mac": "aa:11:00:00:00:03"}]
    p_login, p_dev, p_cli = _patch(clients=clients)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["client_uplinks"]["dd:00:00:00:00:01"] == "aa:11:00:00:00:03"


@pytest.mark.asyncio
async def test_client_uplink_sw_mac_fallback() -> None:
    clients = [{"mac": "dd:11:00:00:00:01", "sw_mac": "aa:22:00:00:00:03"}]
    p_login, p_dev, p_cli = _patch(clients=clients)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["client_uplinks"]["dd:11:00:00:00:01"] == "aa:22:00:00:00:03"


@pytest.mark.asyncio
async def test_client_ap_mac_takes_precedence_over_sw_mac() -> None:
    clients = [{"mac": "dd:22:00:00:00:01", "ap_mac": "ee:00:00:00:00:01", "sw_mac": "ee:00:00:00:00:02"}]
    p_login, p_dev, p_cli = _patch(clients=clients)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["client_uplinks"]["dd:22:00:00:00:01"] == "ee:00:00:00:00:01"


@pytest.mark.asyncio
async def test_client_without_uplink_mac_skipped() -> None:
    clients = [{"mac": "dd:33:00:00:00:01", "hostname": "laptop"}]
    p_login, p_dev, p_cli = _patch(clients=clients)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["client_uplinks"] == {}


@pytest.mark.asyncio
async def test_client_without_mac_skipped() -> None:
    clients = [{"hostname": "no-mac-client", "ap_mac": "ee:11:00:00:00:01"}]
    p_login, p_dev, p_cli = _patch(clients=clients)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)
    assert result["client_uplinks"] == {}


# ---------------------------------------------------------------------------
# Full integration fixture (coherent device + client set)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_full_topology_fixture() -> None:
    """Coherent fixture: 1 router, 2 switches, 1 AP, 1 client; verify all five outputs."""
    gw = "ff:00:00:00:00:01"
    sw1 = "ff:00:00:00:00:02"
    sw2 = "ff:00:00:00:00:03"
    ap = "ff:00:00:00:00:04"
    cli = "ff:00:00:00:00:05"

    devices = [
        {"mac": gw, "type": "ugw", "name": "gw"},
        {
            "mac": sw1, "type": "usw", "name": "core-switch",
            "lldp_table": [{"chassis_id": gw}],
            "uplink": {"mac": gw},
            "stp_priority": 4096,
        },
        {
            "mac": sw2, "type": "usw", "name": "edge-switch",
            "lldp_table": [{"chassis_id": sw1}],
            "uplink": {"mac": sw1},
            "stp_priority": 32768,
        },
        {
            "mac": ap, "type": "uap", "name": "ap-living",
            "uplink": {"mac": sw2},
        },
    ]
    clients = [{"mac": cli, "ap_mac": ap}]

    p_login, p_dev, p_cli = _patch(devices=devices, clients=clients)
    with p_login, p_dev, p_cli:
        result = await fetch_unifi_topology(**_CALL_KWARGS)

    # infra_macs
    assert result["infra_macs"][gw]["type"] == "router"
    assert result["infra_macs"][sw1]["type"] == "switch"
    assert result["infra_macs"][ap]["type"] == "ap"

    # lldp_edges
    assert (sw1, gw) in result["lldp_edges"]
    assert (sw2, sw1) in result["lldp_edges"]

    # device_uplinks
    assert result["device_uplinks"][sw1] == gw
    assert result["device_uplinks"][sw2] == sw1
    assert result["device_uplinks"][ap] == sw2

    # stp_priorities
    assert result["stp_priorities"][sw1] == 4096
    assert result["stp_priorities"][sw2] == 32768
    assert gw not in result["stp_priorities"]  # ugw type, not usw

    # client_uplinks
    assert result["client_uplinks"][cli] == ap
