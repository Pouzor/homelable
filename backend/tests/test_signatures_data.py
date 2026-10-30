"""Integrity + matching tests against the real service_signatures.json."""
import re

import pytest

from app.services.fingerprint import _load, match_service, suggest_node_type

_NODE_TYPES = {
    "isp", "router", "switch", "server", "proxmox", "vm", "lxc",
    "nas", "kvm", "ai_server", "iot", "ap", "camera", "generic",
}


@pytest.fixture
def signatures():
    return _load()


def test_all_entries_well_formed(signatures):
    for sig in signatures:
        # port is an int or explicitly null (port-agnostic)
        assert sig.get("port") is None or isinstance(sig["port"], int)
        assert isinstance(sig["service_name"], str) and sig["service_name"]
        assert sig["suggested_node_type"] in _NODE_TYPES
        if sig.get("banner_regex"):
            re.compile(sig["banner_regex"])
        if sig.get("http_regex"):
            re.compile(sig["http_regex"])


def test_port_agnostic_entries_require_http_regex(signatures):
    for sig in signatures:
        if sig.get("port") is None:
            assert sig.get("http_regex"), f"port:null entry needs http_regex: {sig}"


def test_popular_apps_have_port_agnostic_signatures(signatures):
    names = {s["service_name"] for s in signatures if s.get("port") is None}
    for expected in {
        "Jellyfin", "Plex", "Home Assistant", "Portainer", "Pi-hole",
        "AdGuard Home", "Grafana", "Nextcloud", "Vaultwarden", "Sonarr",
    }:
        assert expected in names, f"missing port-agnostic signature for {expected}"


@pytest.mark.parametrize("title", ["PiKVM", "TinyPilot", "JetKVM", "NanoKVM"])
def test_ip_kvm_titles_suggest_kvm_node_type(title):
    sig = match_service(80, "tcp", banner=None, http_signals={"title": title, "headers": {}})
    assert sig is not None
    assert sig["suggested_node_type"] == "kvm"


@pytest.mark.parametrize(("title", "expected"), [
    ("Jellyfin", "Jellyfin"),
    ("Home Assistant", "Home Assistant"),
    ("Portainer", "Portainer"),
    ("Vaultwarden Web Vault", "Vaultwarden"),
    ("Pi-hole - Dashboard", "Pi-hole"),
    ("Audiobookshelf", "Audiobookshelf"),
])
def test_custom_port_identified_via_http_title(title, expected):
    # A service on a non-standard port, recognised purely by its HTML title.
    sig = match_service(58000, "tcp", banner=None, http_signals={"title": title, "headers": {}})
    assert sig is not None
    assert sig["service_name"] == expected


def test_custom_port_without_probe_is_unknown():
    # Same custom port, deep scan off → no signal → no port-agnostic match.
    assert match_service(58000, "tcp", banner=None, http_signals=None) is None


# ── Synology DSM ports (#582) ─────────────────────────────────────────────────

@pytest.mark.parametrize("port", [5000, 5001])
def test_bare_dsm_port_is_not_synology(port):
    # A PC running a local LLM (KoboldCpp) on 5001, or a Mac's AirPlay on 5000.
    sig = match_service(port, "tcp", banner=None, http_signals=None)
    assert sig is not None
    assert sig["suggested_node_type"] == "server"
    assert "Synology" not in sig["service_name"]


@pytest.mark.parametrize("port", [5000, 5001])
def test_bare_dsm_port_suggests_server_not_nas(port):
    assert suggest_node_type([{"port": port, "protocol": "tcp"}]) == "server"


def test_unrelated_http_title_on_5001_is_not_synology():
    sig = match_service(5001, "tcp", banner=None, http_signals={"title": "KoboldAI Lite", "headers": {}})
    assert sig is not None
    assert "Synology" not in sig["service_name"]


@pytest.mark.parametrize("port", [5000, 5001, 5006])
def test_dsm_banner_still_identifies_synology(port):
    sig = match_service(port, "tcp", banner="Synology DSM nginx", http_signals=None)
    assert sig is not None
    assert sig["suggested_node_type"] == "nas"
    assert suggest_node_type([{"port": port, "protocol": "tcp", "banner": "Synology DSM nginx"}]) == "nas"


@pytest.mark.parametrize("port", [5001, 5006])
def test_dsm_http_title_identifies_synology(port):
    sig = match_service(port, "tcp", banner=None, http_signals={"title": "DiskStation - Synology", "headers": {}})
    assert sig is not None
    assert sig["suggested_node_type"] == "nas"


# ── AI / LLM servers ──────────────────────────────────────────────────────────

def test_ollama_port_suggests_ai_server():
    sig = match_service(11434, "tcp", banner=None, http_signals=None)
    assert sig is not None
    assert sig["service_name"] == "Ollama"
    assert suggest_node_type([{"port": 11434, "protocol": "tcp"}]) == "ai_server"


def test_koboldcpp_on_5001_is_ai_server_once_confirmed():
    # The #582 host: KoboldCpp on 5001, identified by its UI title.
    port = {"port": 5001, "protocol": "tcp", "http_signals": {"title": "KoboldAI Lite", "headers": {}}}
    sig = match_service(5001, "tcp", banner=None, http_signals=port["http_signals"])
    assert sig is not None
    assert sig["service_name"] == "KoboldCpp"
    assert suggest_node_type([port]) == "ai_server"


@pytest.mark.parametrize(("title", "expected"), [
    ("Open WebUI", "Open WebUI"),
    ("Text generation web UI", "text-generation-webui"),
    ("ComfyUI", "ComfyUI"),
    ("Stable Diffusion", "Stable Diffusion WebUI"),
    ("AnythingLLM | Your personal LLM trained on anything", "AnythingLLM"),
    ("SillyTavern", "SillyTavern"),
])
def test_ai_ui_titles_suggest_ai_server(title, expected):
    sig = match_service(58000, "tcp", banner=None, http_signals={"title": title, "headers": {}})
    assert sig is not None
    assert sig["service_name"] == expected
    assert sig["suggested_node_type"] == "ai_server"


def test_ai_server_outranks_plain_server():
    # A PC with SSH + a web port + Ollama is an AI box, not a generic server.
    assert suggest_node_type([
        {"port": 22, "protocol": "tcp"},
        {"port": 80, "protocol": "tcp"},
        {"port": 11434, "protocol": "tcp"},
    ]) == "ai_server"
