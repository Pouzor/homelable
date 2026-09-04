"""Rack grid geometry — a port of frontend/src/rack/layout.ts.

Only the placement half: `is_in_bounds`, `can_place`, `find_slot`, `free_units`.
The pixel maths (`uToY`, `portPosition`, …) is the renderer's business.

The backend re-checks fit, the column grid and overlap when the state is saved
(backend/app/schemas/racks.py), so this is here to *choose* a slot, not to police
one — a payload that slips through still gets a 422.
"""

from typing import Any

from .faceplates import RACK_COLUMNS

# A placement is a dict with u_start, u_height, col_start, col_span — the same
# snake_case shape the API speaks, so a mount row is its own placement.
Placement = dict[str, Any]


def _overlaps(a: Placement, b: Placement) -> bool:
    u_overlap = (
        a["u_start"] < b["u_start"] + b["u_height"]
        and b["u_start"] < a["u_start"] + a["u_height"]
    )
    col_overlap = (
        a["col_start"] < b["col_start"] + b["col_span"]
        and b["col_start"] < a["col_start"] + a["col_span"]
    )
    return u_overlap and col_overlap


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def is_in_bounds(rack: dict[str, Any], p: Placement) -> bool:
    """True when the placement fits inside the rack bounds."""
    return (
        p["u_start"] >= 1
        and p["u_height"] >= 1
        and p["u_start"] + p["u_height"] - 1 <= rack["u_height"]
        and p["col_start"] >= 0
        and p["col_span"] >= 1
        and p["col_start"] + p["col_span"] <= RACK_COLUMNS
    )


def can_place(
    rack: dict[str, Any],
    devices: list[dict[str, Any]],
    p: Placement,
    ignore_id: str | None = None,
) -> bool:
    """True when the placement fits and collides with nothing.

    `ignore_id` skips the mount being moved, so a no-op move stays valid.
    """
    if not is_in_bounds(rack, p):
        return False
    return not any(
        d["rack_id"] == rack["id"] and d.get("id") != ignore_id and _overlaps(p, d)
        for d in devices
    )


def find_slot(
    rack: dict[str, Any],
    devices: list[dict[str, Any]],
    desired: Placement,
    ignore_id: str | None = None,
) -> Placement | None:
    """Nearest valid placement for `desired`, searching the target U first and
    then walking outwards. None when the rack has no room at all."""
    max_u = rack["u_height"] - desired["u_height"] + 1
    if max_u < 1:
        return None

    col_start = clamp(desired["col_start"], 0, RACK_COLUMNS - desired["col_span"])
    target_u = clamp(desired["u_start"], 1, max_u)

    for offset in range(rack["u_height"]):
        candidates_u = [target_u] if offset == 0 else [target_u - offset, target_u + offset]
        for u in candidates_u:
            if u < 1 or u > max_u:
                continue
            candidate = {**desired, "u_start": u, "col_start": col_start}
            if can_place(rack, devices, candidate, ignore_id):
                return candidate
            # Same U may still have room on another column run.
            for c in range(RACK_COLUMNS - desired["col_span"] + 1):
                shifted = {**desired, "u_start": u, "col_start": c}
                if can_place(rack, devices, shifted, ignore_id):
                    return shifted
    return None


def free_units(rack: dict[str, Any], devices: list[dict[str, Any]]) -> int:
    """Free U count, counting a U as free only when every column is free."""
    free = 0
    for u in range(1, rack["u_height"] + 1):
        busy = any(
            d["rack_id"] == rack["id"] and u >= d["u_start"] and u < d["u_start"] + d["u_height"]
            for d in devices
        )
        if not busy:
            free += 1
    return free
