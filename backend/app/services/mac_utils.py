"""MAC-address normalization, shared by the scan + Proxmox persist paths.

Different discovery sources emit MACs in different casing/separators (ARP is
lowercase ``bc:24:11:..``, Proxmox config is often uppercase ``BC:24:11:..``).
Canonicalizing on write *and* on compare lets cross-source dedup match a device
by MAC with a plain ``==`` — the join key for merging an IP-scanned row with a
Proxmox-imported one.

Octets are zero-padded too: macOS ``arp -a`` drops leading zeros
(``2:c4:b5:83:1a:71``) where Proxmox reports ``02:c4:b5:83:1a:71``, and left
as they were the two never compared equal.
"""

from __future__ import annotations

import re

_OCTET = re.compile(r"[0-9a-f]{1,2}")


def normalize_mac(mac: str | None) -> str | None:
    """Canonical MAC: lowercase, ``-`` → ``:``, stripped, octets zero-padded.

    Blank/None → None. Anything that is not six colon-separated hex octets is
    returned lowercased but otherwise as given, rather than guessed at.
    """
    if not mac:
        return None
    normalized = mac.strip().lower().replace("-", ":")
    octets = normalized.split(":")
    if len(octets) == 6 and all(_OCTET.fullmatch(o) for o in octets):
        return ":".join(o.zfill(2) for o in octets)
    return normalized or None
