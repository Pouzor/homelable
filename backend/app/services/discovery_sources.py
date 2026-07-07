"""Helpers for the multi-valued ``PendingDevice.discovery_sources`` set.

A device discovered by more than one path (e.g. an IP scan *and* a Proxmox
import) accumulates every source that has seen it, so it surfaces under each
matching inventory filter. Order is preserved (origin first) and duplicates are
dropped.
"""

from __future__ import annotations

from collections.abc import Iterable


def add_source(sources: Iterable[str] | None, source: str | None) -> list[str]:
    """Return ``sources`` with ``source`` appended if not already present."""
    out = [s for s in (sources or []) if s]
    if source and source not in out:
        out.append(source)
    return out
