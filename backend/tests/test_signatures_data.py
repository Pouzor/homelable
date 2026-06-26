"""Integrity + matching tests against the real service_signatures.json."""
import re

import pytest

from app.services.fingerprint import _load, match_service

_NODE_TYPES = {
    "isp", "router", "switch", "server", "proxmox", "vm", "lxc",
    "nas", "iot", "ap", "camera", "generic",
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
