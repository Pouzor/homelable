"""Faceplate catalog — a data-only port of frontend/src/rack/faceplates.ts.

The rack renderer draws a plate from an SVG element list; MCP never draws, so
only the parts a mount needs are copied here: the plate's footprint (`u_height`,
`col_span`) and the ports it seeds. Kept in sync manually, enforced by
mcp/tests/test_faceplates_sync.py.
"""

from math import ceil
from typing import Any

# 12-column horizontal grid, mirroring RACK_COLUMNS in frontend/src/types/rack.ts
# and backend/app/schemas/racks.py.
RACK_COLUMNS = 12

# Desktop NAS boxes stand ~3U in metal but the canvas compresses the vertical
# axis ~1.8x, so they are drawn 5U tall. See the NAS_U comment in faceplates.ts.
NAS_U = 5
# Bottom strip of a desktop NAS: the badge, the LED and the sockets sit on it.
NAS_BAND = 0.86


def bank(
    type: str,
    count: int,
    x: float,
    w: float,
    per_row: int | None = None,
    prefix: str = "P",
    start: int = 1,
) -> list[dict[str, Any]]:
    """Evenly spread `count` ports across a horizontal band.

    Same arithmetic as `bank()` in faceplates.ts:31 — rows are centred
    vertically, so a plate seeded here lands its ports where the renderer draws
    them and a cable endpoint is where the user sees the socket.
    """
    per_row = count if per_row is None else per_row
    rows = max(1, ceil(count / per_row))
    step_x = w / per_row

    ports = []
    for i in range(count):
        row = i // per_row
        col = i % per_row
        ports.append({
            "label": f"{prefix}{start + i}",
            "type": type,
            "x": x + step_x * (col + 0.5),
            "y": (row + 1) / (rows + 1),
        })
    return ports


def _nas_ports(ports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop a bank onto the NAS bottom strip — `bank` centres rows on the plate."""
    return [{**p, "y": NAS_BAND} for p in ports]


# Order matters: it is the catalog order the frontend picker shows, and the sync
# test compares the sequence.
FACEPLATES: list[dict[str, Any]] = [
    # --- Servers ------------------------------------------------------------
    {
        "id": "server-1u",
        "label": "Server 1U",
        "kind": "device",
        "group": "Servers",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": bank(type="rj45", count=2, x=0.79, w=0.16, prefix="eth"),
    },
    {
        "id": "server-1u-bays",
        "label": "Server 1U — 4 bays",
        "kind": "device",
        "group": "Servers",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": bank(type="rj45", count=2, x=0.79, w=0.16, prefix="eth"),
    },
    {
        "id": "server-2u-bays",
        "label": "Server 2U — 8 bays",
        "kind": "device",
        "group": "Servers",
        "u_height": 2,
        "col_span": RACK_COLUMNS,
        "ports": [
            *bank(type="rj45", count=4, x=0.78, w=0.13, per_row=2, prefix="eth"),
            *bank(type="sfp+", count=2, x=0.92, w=0.06, per_row=1, prefix="sfp"),
        ],
    },
    {
        "id": "server-4u-storage",
        "label": "Storage 4U — 12 bays",
        "kind": "device",
        "group": "Servers",
        "u_height": 4,
        "col_span": RACK_COLUMNS,
        "ports": bank(type="rj45", count=2, x=0.8, w=0.14, prefix="eth"),
    },
    {
        "id": "sff-half",
        "label": "SFF / mini PC (half width)",
        "kind": "device",
        "group": "Servers",
        "u_height": 1,
        "col_span": RACK_COLUMNS // 2,
        "ports": bank(type="rj45", count=1, x=0.82, w=0.12, prefix="eth"),
    },
    {
        "id": "mini-third",
        "label": "Mini node (third width)",
        "kind": "device",
        "group": "Servers",
        "u_height": 1,
        "col_span": RACK_COLUMNS // 3,
        "ports": bank(type="rj45", count=1, x=0.8, w=0.14, prefix="eth"),
    },

    # --- Network ------------------------------------------------------------
    {
        "id": "switch-8",
        "label": "Switch 8 ports",
        "kind": "device",
        "group": "Network",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [
            *bank(type="rj45", count=8, x=0.33, w=0.4, prefix=""),
            *bank(type="sfp", count=1, x=0.79, w=0.08, prefix="sfp"),
        ],
    },
    {
        "id": "switch-24",
        "label": "Switch 24 ports + 2 SFP",
        "kind": "device",
        "group": "Network",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [
            *bank(type="rj45", count=24, x=0.23, w=0.53, per_row=12, prefix=""),
            *bank(type="sfp+", count=2, x=0.8, w=0.12, prefix="sfp"),
        ],
    },
    {
        "id": "switch-48",
        "label": "Switch 48 ports + 4 SFP+",
        "kind": "device",
        "group": "Network",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [
            *bank(type="rj45", count=48, x=0.22, w=0.54, per_row=24, prefix=""),
            *bank(type="sfp+", count=4, x=0.79, w=0.14, per_row=2, prefix="sfp"),
        ],
    },
    {
        "id": "router-1u",
        "label": "Router / firewall 1U",
        "kind": "device",
        "group": "Network",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [
            *bank(type="rj45", count=6, x=0.35, w=0.38, prefix="lan"),
            *bank(type="sfp+", count=1, x=0.79, w=0.08, prefix="sfp"),
        ],
    },
    {
        "id": "patch-24",
        "label": "Patch panel 24",
        "kind": "device",
        "group": "Network",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": bank(type="rj45", count=24, x=0.21, w=0.76, per_row=24, prefix=""),
    },
    {
        "id": "patch-fiber-12",
        "label": "Fiber panel 12 (LC)",
        "kind": "device",
        "group": "Network",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": bank(type="sfp", count=12, x=0.21, w=0.58, prefix="lc"),
    },

    # --- Storage / power ----------------------------------------------------
    {
        "id": "nas-2u",
        "label": "NAS 2U — 8 bays",
        "kind": "device",
        "group": "Storage",
        "u_height": 2,
        "col_span": RACK_COLUMNS,
        "ports": [
            *bank(type="rj45", count=2, x=0.79, w=0.12, per_row=1, prefix="eth"),
            *bank(type="sfp+", count=1, x=0.93, w=0.05, prefix="sfp"),
        ],
    },
    {
        "id": "nas-desktop-2",
        "label": "Desktop NAS — 2 bays",
        "kind": "device",
        "group": "Storage",
        "u_height": NAS_U,
        # Two doors side by side is a slim tower — a sixth of the rack.
        "col_span": RACK_COLUMNS // 6,
        "ports": _nas_ports(bank(type="rj45", count=1, x=0.7, w=0.26, prefix="eth")),
    },
    {
        "id": "nas-desktop-4",
        "label": "Desktop NAS — 4 bays",
        "kind": "device",
        "group": "Storage",
        "u_height": NAS_U,
        "col_span": RACK_COLUMNS // 3,
        "ports": _nas_ports(bank(type="rj45", count=2, x=0.6, w=0.34, prefix="eth")),
    },
    {
        "id": "nas-desktop-5",
        "label": "Desktop NAS — 5 bays",
        "kind": "device",
        "group": "Storage",
        "u_height": NAS_U,
        "col_span": RACK_COLUMNS // 3,
        "ports": _nas_ports([
            *bank(type="rj45", count=2, x=0.58, w=0.24, prefix="eth"),
            *bank(type="sfp+", count=1, x=0.84, w=0.12, prefix="sfp"),
        ]),
    },
    {
        "id": "ups-2u",
        "label": "UPS 2U",
        "kind": "device",
        "group": "Power",
        "u_height": 2,
        "col_span": RACK_COLUMNS,
        # Outlets are artwork only — power cabling is out of v1.
        "ports": [],
    },
    {
        "id": "pdu-1u",
        "label": "PDU 1U — 8 outlets",
        "kind": "device",
        "group": "Power",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [],
    },

    # --- Accessories --------------------------------------------------------
    {
        "id": "blank-1u",
        "label": "Blank panel 1U",
        "kind": "accessory",
        "group": "Accessories",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [],
    },
    {
        "id": "shelf-1u",
        "label": "Shelf 1U",
        "kind": "accessory",
        "group": "Accessories",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [],
    },
    {
        "id": "cable-manager-1u",
        "label": "Cable manager 1U",
        "kind": "accessory",
        "group": "Accessories",
        "u_height": 1,
        "col_span": RACK_COLUMNS,
        "ports": [],
    },
]

_BY_ID = {f["id"]: f for f in FACEPLATES}

FACEPLATE_IDS = [f["id"] for f in FACEPLATES]


def get_faceplate(faceplate_id: str) -> dict[str, Any] | None:
    """The plate, or None. Unlike the frontend's `getFaceplate` this does not
    fall back to the first template: a tool given an unknown id must say so
    rather than silently mount the wrong hardware."""
    return _BY_ID.get(faceplate_id)


# Faceplate proposed when an inventory device is dropped into a rack, keyed on
# the device's free-form `suggested_type` (faceplates.ts:476).
FACEPLATE_BY_DEVICE_TYPE = {
    "server": "server-1u-bays",
    "proxmox": "server-2u-bays",
    "nas": "nas-2u",
    "switch": "switch-24",
    "router": "router-1u",
    "firewall": "router-1u",
    "ap": "sff-half",
    "computer": "sff-half",
    "docker_host": "server-1u",
    "ups": "ups-2u",
    "pdu": "pdu-1u",
    "patch_panel": "patch-24",
    "printer": "shelf-1u",
    "camera": "mini-third",
    "iot": "mini-third",
    "cpl": "mini-third",
}


def suggest_faceplate(device_type: str | None) -> str:
    """Plate for a device type; a plain 1U server for anything unknown."""
    return FACEPLATE_BY_DEVICE_TYPE.get(device_type or "", "server-1u")


# The other direction: what kind of hardware a plate represents. A device
# created from a rack has no discovery behind it, so the plate is the only thing
# that says what it is (faceplates.ts:513).
DEVICE_TYPE_BY_FACEPLATE = {
    "server-1u": "server",
    "server-1u-bays": "server",
    "server-2u-bays": "server",
    "server-4u-storage": "server",
    "sff-half": "computer",
    "mini-third": "computer",
    "switch-8": "switch",
    "switch-24": "switch",
    "switch-48": "switch",
    "router-1u": "router",
    "patch-24": "patch_panel",
    "patch-fiber-12": "patch_panel",
    "nas-2u": "nas",
    "nas-desktop-2": "nas",
    "nas-desktop-4": "nas",
    "nas-desktop-5": "nas",
    "ups-2u": "ups",
    "pdu-1u": "pdu",
}


def device_type_for_faceplate(faceplate_id: str) -> str | None:
    """None for accessories, which are rack furniture and never inventory rows."""
    return DEVICE_TYPE_BY_FACEPLATE.get(faceplate_id)
