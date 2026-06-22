from unittest.mock import patch

import pytest

from app.services.fingerprint import (
    fingerprint_ports,
    match_port,
    suggest_node_type,
    suggest_type_from_mac,
)

MOCK_SIGNATURES = [
    {"port": 80, "protocol": "tcp", "banner_regex": None, "service_name": "HTTP", "icon": "🌐", "category": "web", "suggested_node_type": "server"},
    {"port": 443, "protocol": "tcp", "banner_regex": None, "service_name": "HTTPS", "icon": "🔒", "category": "web", "suggested_node_type": "server"},
    {"port": 22, "protocol": "tcp", "banner_regex": None, "service_name": "SSH", "icon": "🖥", "category": "remote", "suggested_node_type": None},
    {"port": 8006, "protocol": "tcp", "banner_regex": "proxmox", "service_name": "Proxmox API", "icon": "🔧", "category": "web", "suggested_node_type": "proxmox"},
    {"port": 8006, "protocol": "tcp", "banner_regex": None, "service_name": "Web UI", "icon": "🌐", "category": "web", "suggested_node_type": "server"},
]


@pytest.fixture(autouse=True)
def mock_signatures():
    with patch("app.services.fingerprint._load", return_value=MOCK_SIGNATURES):
        yield


# ── match_port ────────────────────────────────────────────────────────────────

def test_match_port_known_port():
    result = match_port(80, "tcp")
    assert result is not None
    assert result["service_name"] == "HTTP"


def test_match_port_unknown_port():
    result = match_port(9999, "tcp")
    assert result is None


def test_match_port_wrong_protocol():
    result = match_port(80, "udp")
    assert result is None


def test_match_port_with_banner_match():
    result = match_port(8006, "tcp", banner="proxmox virtual environment")
    assert result is not None
    assert result["service_name"] == "Proxmox API"


def test_match_port_with_banner_no_match_falls_through_to_next():
    # banner doesn't match proxmox regex → skips first sig, matches second (no banner_regex)
    result = match_port(8006, "tcp", banner="something else")
    assert result is not None
    assert result["service_name"] == "Web UI"


def test_match_port_no_banner_skips_banner_regex_sigs():
    # no banner → banner_regex sigs are skipped, falls through to generic fallback
    result = match_port(8006, "tcp", banner=None)
    assert result is not None
    assert result["service_name"] == "Web UI"


# ── fingerprint_ports ─────────────────────────────────────────────────────────

def test_fingerprint_ports_known_ports():
    results = fingerprint_ports([{"port": 80, "protocol": "tcp"}, {"port": 443, "protocol": "tcp"}])
    assert len(results) == 2
    assert results[0]["service_name"] == "HTTP"
    assert results[1]["service_name"] == "HTTPS"
    assert results[0]["port"] == 80
    assert results[0]["category"] == "web"


def test_fingerprint_ports_unknown_port():
    results = fingerprint_ports([{"port": 9999, "protocol": "tcp"}])
    assert len(results) == 1
    assert results[0]["service_name"] == "TCP/9999"
    assert results[0]["icon"] is None
    assert results[0]["category"] is None


def test_fingerprint_ports_mixed():
    results = fingerprint_ports([{"port": 22, "protocol": "tcp"}, {"port": 9999, "protocol": "tcp"}])
    assert results[0]["service_name"] == "SSH"
    assert results[1]["service_name"] == "TCP/9999"


def test_fingerprint_ports_empty():
    assert fingerprint_ports([]) == []


def test_fingerprint_ports_defaults_protocol_to_tcp():
    results = fingerprint_ports([{"port": 80}])
    assert results[0]["service_name"] == "HTTP"


# ── suggest_node_type ─────────────────────────────────────────────────────────

def test_suggest_node_type_returns_proxmox_from_port():
    result = suggest_node_type([{"port": 8006, "protocol": "tcp"}])
    assert result == "proxmox"


def test_suggest_node_type_returns_server_from_http():
    result = suggest_node_type([{"port": 80, "protocol": "tcp"}])
    assert result == "server"


def test_suggest_node_type_no_match_returns_generic():
    result = suggest_node_type([{"port": 9999, "protocol": "tcp"}])
    assert result == "generic"


def test_suggest_node_type_empty_returns_generic():
    assert suggest_node_type([]) == "generic"


def test_suggest_node_type_priority_proxmox_over_server():
    # both proxmox and server ports open → proxmox wins (higher priority)
    result = suggest_node_type([{"port": 80, "protocol": "tcp"}, {"port": 8006, "protocol": "tcp"}])
    assert result == "proxmox"


def test_suggest_node_type_camera_from_rtsp_port():
    # RTSP port 554 → camera (via _PORT_TYPE_HINTS)
    result = suggest_node_type([{"port": 554, "protocol": "tcp"}])
    assert result == "camera"


def test_suggest_node_type_camera_from_signature():
    # patch _load to return a camera sig so we test the sig path too
    with patch("app.services.fingerprint._load", return_value=[
        {"port": 554, "protocol": "tcp", "banner_regex": None, "service_name": "RTSP", "icon": "camera", "category": "camera", "suggested_node_type": "camera"}
    ]):
        result = suggest_node_type([{"port": 554, "protocol": "tcp"}])
        assert result == "camera"


# ── IoT detection ─────────────────────────────────────────────────────────────

def test_suggest_node_type_iot_from_mqtt_port():
    result = suggest_node_type([{"port": 1883, "protocol": "tcp"}])
    assert result == "iot"


def test_suggest_node_type_iot_from_coap_port():
    result = suggest_node_type([{"port": 5683, "protocol": "tcp"}])
    assert result == "iot"


def test_suggest_node_type_iot_from_esphome_port():
    result = suggest_node_type([{"port": 6052, "protocol": "tcp"}])
    assert result == "iot"


def test_suggest_node_type_shelly_mac_overrides_http_port():
    # Shelly exposes port 80 (would suggest "server") but MAC identifies it as IoT
    result = suggest_node_type([{"port": 80, "protocol": "tcp"}], mac="34:94:54:aa:bb:cc")
    assert result == "iot"


def test_suggest_node_type_espressif_mac_returns_iot():
    result = suggest_node_type([], mac="a0:20:a6:11:22:33")
    assert result == "iot"


def test_suggest_node_type_tuya_mac_returns_iot():
    result = suggest_node_type([{"port": 80, "protocol": "tcp"}], mac="d8:f1:5b:aa:bb:cc")
    assert result == "iot"


def test_suggest_node_type_iot_wins_over_server_when_mqtt_present():
    # MQTT port + HTTP port → iot wins (iot is higher priority than server now)
    result = suggest_node_type([
        {"port": 80, "protocol": "tcp"},
        {"port": 1883, "protocol": "tcp"},
    ])
    assert result == "iot"


# ── OUI vendor detection ──────────────────────────────────────────────────────

def test_suggest_type_from_mac_mikrotik_returns_router():
    # The motivating case: MikroTik MAC should be recognized as a router
    assert suggest_type_from_mac("4c:5e:0c:11:22:33") == "router"
    assert suggest_type_from_mac("b8:69:f4:aa:bb:cc") == "router"


def test_suggest_type_from_mac_ubiquiti_returns_ap():
    # Ubiquiti makes routers, switches, APs, cameras — most homelab gear is UniFi APs,
    # so OUI defaults to "ap". Port hints can still upgrade to "router" if BGP/VPN open.
    assert suggest_type_from_mac("24:a4:3c:11:22:33") == "ap"
    assert suggest_type_from_mac("fc:ec:da:aa:bb:cc") == "ap"


def test_suggest_type_from_mac_synology_returns_nas():
    assert suggest_type_from_mac("00:11:32:11:22:33") == "nas"


def test_suggest_type_from_mac_qnap_returns_nas():
    assert suggest_type_from_mac("24:5e:be:aa:bb:cc") == "nas"


def test_suggest_type_from_mac_hikvision_returns_camera():
    assert suggest_type_from_mac("28:57:be:11:22:33") == "camera"


def test_suggest_type_from_mac_dahua_returns_camera():
    assert suggest_type_from_mac("3c:ef:8c:aa:bb:cc") == "camera"


def test_suggest_type_from_mac_cisco_returns_switch():
    assert suggest_type_from_mac("b8:38:61:11:22:33") == "switch"


def test_suggest_type_from_mac_raspberry_pi_returns_server():
    assert suggest_type_from_mac("b8:27:eb:11:22:33") == "server"


def test_suggest_type_from_mac_handles_uppercase():
    # MACs may arrive in any case; lookup must be case-insensitive
    assert suggest_type_from_mac("4C:5E:0C:11:22:33") == "router"


def test_suggest_type_from_mac_unknown_oui_returns_none():
    assert suggest_type_from_mac("00:00:01:11:22:33") is None


def test_suggest_node_type_mikrotik_mac_returns_router_no_ports():
    # MikroTik device with no scanned ports should still be classified as router via MAC
    assert suggest_node_type([], mac="4c:5e:0c:11:22:33") == "router"


def test_suggest_node_type_synology_mac_with_http_returns_nas():
    # NAS priority beats server, so a Synology MAC + open HTTP → nas
    result = suggest_node_type(
        [{"port": 80, "protocol": "tcp"}],
        mac="00:11:32:11:22:33",
    )
    assert result == "nas"


def test_suggest_node_type_ubiquiti_mac_with_bgp_upgrades_to_router():
    # Ubiquiti OUI suggests "ap", but BGP port hint upgrades to "router" (higher priority)
    result = suggest_node_type(
        [{"port": 179, "protocol": "tcp"}],
        mac="24:a4:3c:11:22:33",
    )
    assert result == "router"
