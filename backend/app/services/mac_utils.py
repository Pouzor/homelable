"""MAC-address normalization, shared by the scan + Proxmox persist paths.

Different discovery sources emit MACs in different casing/separators (ARP is
lowercase ``bc:24:11:..``, Proxmox config is often uppercase ``BC:24:11:..``).
Canonicalizing on write *and* on compare lets cross-source dedup match a device
by MAC with a plain ``==`` — the join key for merging an IP-scanned row with a
Proxmox-imported one.
"""

from __future__ import annotations


def normalize_mac(mac: str | None) -> str | None:
    """Canonical MAC: lowercase, ``-`` → ``:``, stripped. Blank/None → None."""
    if not mac:
        return None
    normalized = mac.strip().lower().replace("-", ":")
    return normalized or None
