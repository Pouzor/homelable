"""Unit tests for MAC normalization (the cross-source dedup key)."""

from __future__ import annotations

from app.services.discovery_sources import add_source
from app.services.mac_utils import normalize_mac


def test_normalize_mac_lowercases_and_unifies_separators() -> None:
    assert normalize_mac("BC:24:11:AA:BB:CC") == "bc:24:11:aa:bb:cc"
    assert normalize_mac("bc-24-11-aa-bb-cc") == "bc:24:11:aa:bb:cc"
    assert normalize_mac("  BC:24:11:AA:BB:CC  ") == "bc:24:11:aa:bb:cc"


def test_normalize_mac_blank_is_none() -> None:
    assert normalize_mac(None) is None
    assert normalize_mac("") is None
    assert normalize_mac("   ") is None


def test_add_source_unions_without_duplicates() -> None:
    assert add_source(None, "arp") == ["arp"]
    assert add_source(["arp"], "proxmox") == ["arp", "proxmox"]
    assert add_source(["arp", "proxmox"], "proxmox") == ["arp", "proxmox"]
    assert add_source(["arp"], None) == ["arp"]
    # Drops falsy members already present.
    assert add_source(["arp", ""], "proxmox") == ["arp", "proxmox"]
