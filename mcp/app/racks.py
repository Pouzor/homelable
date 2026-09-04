"""Rack canvas tools.

The rack canvas is a design whose `design_type` is `rack`: racks, the gear
mounted in them, and port-to-port cables. Its persistence is one full-state
endpoint — `POST /api/v1/racks/save` upserts what it is sent and prunes the rest
— so every write here is load, mutate, save the whole thing back.

Two consequences worth knowing:

* The save is last-writer-wins with no versioning. A write made while the user
  has the rack canvas open with unsaved changes loses one side's work. The
  load/save window is a single dispatch, so it is small, not zero.
* A mount's plate, colour and ports belong to the *inventory row*, not to the
  mount: `/racks/save` writes them through to `device_inventory` itself
  (backend/app/api/routes/racks.py:360), so nothing here has to patch the
  inventory to make a faceplate change stick.
"""

import uuid
from typing import Any, cast
from urllib.parse import quote

from mcp.types import Tool

from .backend_client import backend
from .faceplates import (
    FACEPLATES,
    RACK_COLUMNS,
    get_faceplate,
    suggest_faceplate,
)
from .rack_layout import can_place, find_slot, free_units

# Capacity the UI allows. The backend accepts 1..100; the rack canvas stops at
# 48, and a rack this side of that bound is one the user can still edit by hand.
MIN_RACK_U = 1
MAX_RACK_U = 48

DEFAULT_RACK_STYLE = {
    "frame": "#1c2129",
    "rail": "#39424f",
    "interior": "#0d1117",
    "showNumbers": True,
    "enclosed": False,
}

# Cable type implied by the port a patch starts from, and the sheath colour that
# goes with it (frontend/src/rack/rackDefaults.ts).
PORT_CABLE_TYPE = {"rj45": "ethernet", "sfp": "fiber", "sfp+": "fiber"}
CABLE_COLORS = {"ethernet": "#39d353", "fiber": "#f0a500"}

WIDTH_STANDARDS = ["19", "10"]
NUMBERINGS = ["bottom-up", "top-down"]

_DESIGN_ID = {
    "design_id": {"type": "string", "description": "Rack design id. Use list_designs to find one (design_type 'rack')."},
}


# --- State round-trip -------------------------------------------------------
# GET returns rows carrying `design_id`; the save schemas do not have that field
# (it is top-level on the request), so echoing a row back verbatim is a 422.
def _savable(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k != "design_id"}


async def _load_state(design_id: str) -> dict[str, Any]:
    return cast(dict[str, Any], await backend.get(f"/api/v1/racks?design_id={quote(design_id)}"))


async def _save_state(design_id: str, state: dict[str, Any]) -> dict[str, Any]:
    return await backend.post("/api/v1/racks/save", {
        "design_id": design_id,
        "racks": [_savable(r) for r in state["racks"]],
        "devices": [_savable(d) for d in state["devices"]],
        "cables": [_savable(c) for c in state["cables"]],
        # Pan/zoom shares the design's CanvasState row and is overwritten on
        # every save: not echoing what the load returned resets the user's view.
        "viewport": state.get("viewport") or {},
    })


def _rack_or_raise(state: dict[str, Any], rack_id: str) -> dict[str, Any]:
    for rack in state["racks"]:
        if rack["id"] == rack_id:
            return rack
    known = ", ".join(f"{r['id']} ({r['name']})" for r in state["racks"]) or "none"
    raise ValueError(f"Unknown rack {rack_id}. Racks on this design: {known}")


def _mount_or_raise(state: dict[str, Any], mount_id: str) -> dict[str, Any]:
    for device in state["devices"]:
        if device["id"] == mount_id:
            return device
    raise ValueError(f"Unknown mount {mount_id}. Call get_rack to list the mounts.")


def _placement(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row[k] for k in ("u_start", "u_height", "col_start", "col_span")}


# --- Slimming ---------------------------------------------------------------
def _slim_rack(rack: dict[str, Any], devices: list[dict[str, Any]]) -> dict[str, Any]:
    mounted = [d for d in devices if d["rack_id"] == rack["id"]]
    return {
        "id": rack["id"],
        "name": rack["name"],
        "u_height": rack["u_height"],
        "width_standard": rack["width_standard"],
        "numbering": rack["numbering"],
        "location": rack.get("location"),
        "mount_count": len(mounted),
        "free_u": free_units(rack, devices),
    }


def _slim_mount(device: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": device["id"],
        "label": device["label"],
        "u_start": device["u_start"],
        "u_height": device["u_height"],
        "col_start": device["col_start"],
        "col_span": device["col_span"],
        "faceplate_id": device["faceplate_id"],
        "status": device.get("status"),
        "device_id": device.get("device_id"),
        "node_id": device.get("node_id"),
        "ports": [
            {"id": p.get("id"), "label": p.get("label"), "type": p.get("type")}
            for p in device.get("ports") or []
            if isinstance(p, dict)
        ],
    }


def _slim_cable(cable: dict[str, Any], by_mount: dict[str, dict[str, Any]]) -> dict[str, Any]:
    def endpoint(mount_id: str, port_id: str) -> dict[str, Any]:
        mount = by_mount.get(mount_id) or {}
        port = next(
            (p for p in mount.get("ports") or [] if isinstance(p, dict) and p.get("id") == port_id),
            {},
        )
        return {
            "mount_id": mount_id,
            "device": mount.get("label"),
            "port_id": port_id,
            "port": port.get("label"),
        }

    return {
        "id": cable["id"],
        "type": cable["type"],
        "color": cable.get("color"),
        "label": cable.get("label"),
        "from": endpoint(cable["from_device_id"], cable["from_port_id"]),
        "to": endpoint(cable["to_device_id"], cable["to_port_id"]),
    }


def _slim_inventory_item(item: dict[str, Any]) -> dict[str, Any]:
    out = {
        "id": item["id"],
        "label": item["label"],
        "suggested_type": item.get("suggested_type"),
        "ip": item.get("ip"),
        "status": item.get("status"),
        "discovery_source": item.get("discovery_source"),
        "racked": item.get("racked", False),
        # Already wearing a front panel: mount_device reuses it as-is.
        "modelled": bool(item.get("rack_faceplate_id")),
    }
    if item.get("rack_faceplate_id"):
        out["faceplate_id"] = item["rack_faceplate_id"]
    if item.get("node_id"):
        out["node_id"] = item["node_id"]
    return out


# --- Ports ------------------------------------------------------------------
def _seed_ports(plate: dict[str, Any]) -> list[dict[str, Any]]:
    """Template ports with fresh ids — the ids are the device's, and a cable is
    the only thing that ever refers to one."""
    return [{**port, "id": str(uuid.uuid4())} for port in plate["ports"]]


def _resolve_port(mount: dict[str, Any], ref: str) -> dict[str, Any]:
    """A port named by id, or case-insensitively by label (`eth1`, `P12`)."""
    ports = [p for p in mount.get("ports") or [] if isinstance(p, dict)]
    for port in ports:
        if port.get("id") == ref:
            return port
    matches = [p for p in ports if str(p.get("label", "")).lower() == ref.lower()]
    if len(matches) == 1:
        return matches[0]
    labels = ", ".join(str(p.get("label")) for p in ports) or "none"
    if len(matches) > 1:
        raise ValueError(f"Port '{ref}' is ambiguous on {mount['label']}. Use the port id.")
    raise ValueError(f"Unknown port '{ref}' on {mount['label']}. Ports: {labels}")


def _cable_on_port(state: dict[str, Any], mount_id: str, port_id: str) -> dict[str, Any] | None:
    for cable in state["cables"]:
        if (cable["from_device_id"] == mount_id and cable["from_port_id"] == port_id) or (
            cable["to_device_id"] == mount_id and cable["to_port_id"] == port_id
        ):
            return cable
    return None


# --- Tools ------------------------------------------------------------------
_GEOMETRY_FIELDS = {
    "u_start": {"type": "integer", "description": "1-based U, counted from the bottom rail. Omit to take the first free slot."},
    "col_start": {"type": "integer", "description": f"Left column, 0..{RACK_COLUMNS - 1}. Default 0."},
    "col_span": {"type": "integer", "description": f"Width in columns of the {RACK_COLUMNS}-column grid (full 12, half 6, third 4, quarter 3). Default: the faceplate's."},
    "u_height": {"type": "integer", "description": "Height in U. Default: the faceplate's."},
}

RACK_TOOLS = [
    Tool(name="list_racks", description="List the racks on a rack design with their capacity, mount count and free U.", inputSchema={
        "type": "object",
        "required": ["design_id"],
        "properties": {**_DESIGN_ID},
    }),
    Tool(name="get_rack", description="Full contents of a rack design: every rack, the gear mounted in it with its ports, and the cables patched between them.", inputSchema={
        "type": "object",
        "required": ["design_id"],
        "properties": {
            **_DESIGN_ID,
            "rack_id": {"type": "string", "description": "Narrow to one rack. Omit for every rack on the design."},
        },
    }),
    Tool(name="list_rack_inventory", description="Device Inventory entries that can be racked on this design, each flagged with whether it is already mounted and whether it already has a faceplate.", inputSchema={
        "type": "object",
        "required": ["design_id"],
        "properties": {**_DESIGN_ID},
    }),
    Tool(name="list_faceplates", description="The faceplate catalog: plate id, what it represents, its height in U and its width in columns. Pick an id from here rather than guessing one.", inputSchema={
        "type": "object",
        "properties": {},
    }),
    Tool(name="create_rack", description="Add an empty rack to a rack design.", inputSchema={
        "type": "object",
        "required": ["design_id", "name"],
        "properties": {
            **_DESIGN_ID,
            "name": {"type": "string"},
            "u_height": {"type": "integer", "description": f"Capacity in U, {MIN_RACK_U}..{MAX_RACK_U}. Default 24."},
            "width_standard": {"type": "string", "enum": WIDTH_STANDARDS, "description": "Rack width in inches. Default 19."},
            "numbering": {"type": "string", "enum": NUMBERINGS, "description": "Which way the printed U labels run. Default bottom-up."},
            "location": {"type": "string", "description": "Where the rack physically is (room, site)."},
            "pos_x": {"type": "number", "description": "Canvas position. Default: to the right of the last rack."},
            "pos_y": {"type": "number"},
        },
    }),
    Tool(name="update_rack", description="Rename, resize, relocate or move a rack. A shrink relocates the mounts it would push above the top rail, and is refused when one has nowhere to go.", inputSchema={
        "type": "object",
        "required": ["design_id", "rack_id"],
        "properties": {
            **_DESIGN_ID,
            "rack_id": {"type": "string"},
            "name": {"type": "string"},
            "u_height": {"type": "integer", "description": f"New capacity in U, clamped to {MIN_RACK_U}..{MAX_RACK_U}."},
            "width_standard": {"type": "string", "enum": WIDTH_STANDARDS},
            "numbering": {"type": "string", "enum": NUMBERINGS},
            "location": {"type": "string"},
            "pos_x": {"type": "number"},
            "pos_y": {"type": "number"},
        },
    }),
    Tool(name="delete_rack", description="Delete a rack, the gear mounted in it and the cables patched to that gear. The Device Inventory is untouched.", inputSchema={
        "type": "object",
        "required": ["design_id", "rack_id"],
        "properties": {**_DESIGN_ID, "rack_id": {"type": "string"}},
    }),
    Tool(name="mount_device", description="Mount a Device Inventory entry in a rack. The faceplate defaults to the one the device already wears, else the one its type suggests; the slot defaults to the lowest that fits.", inputSchema={
        "type": "object",
        "required": ["design_id", "rack_id", "inventory_device_id"],
        "properties": {
            **_DESIGN_ID,
            "rack_id": {"type": "string"},
            "inventory_device_id": {"type": "string", "description": "Inventory entry to mount. Call list_rack_inventory for ids."},
            "faceplate_id": {"type": "string", "description": "Override the faceplate. Call list_faceplates for ids."},
            "label": {"type": "string", "description": "Override the plate's printed name. Defaults to the inventory label."},
            **_GEOMETRY_FIELDS,
        },
    }),
    Tool(name="mount_accessory", description="Mount rack furniture that has no inventory entry behind it: a blank panel, a shelf, a cable manager.", inputSchema={
        "type": "object",
        "required": ["design_id", "rack_id", "faceplate_id"],
        "properties": {
            **_DESIGN_ID,
            "rack_id": {"type": "string"},
            "faceplate_id": {"type": "string", "description": "Call list_faceplates; the 'Accessories' group is what belongs here."},
            "label": {"type": "string", "description": "Printed name. Defaults to the faceplate's."},
            **_GEOMETRY_FIELDS,
        },
    }),
    Tool(name="unmount_device", description="Take gear out of a rack, along with the cables patched to it. The Device Inventory entry survives.", inputSchema={
        "type": "object",
        "required": ["design_id", "mount_id"],
        "properties": {**_DESIGN_ID, "mount_id": {"type": "string", "description": "Mount id from get_rack — not the inventory device id."}},
    }),
    Tool(name="move_device", description="Move a mount to another slot, or to another rack on the same design. Refused when the target is occupied or out of bounds.", inputSchema={
        "type": "object",
        "required": ["design_id", "mount_id"],
        "properties": {
            **_DESIGN_ID,
            "mount_id": {"type": "string"},
            "rack_id": {"type": "string", "description": "Move to this rack. Omit to stay in the current one."},
            "u_start": {"type": "integer", "description": "1-based U, counted from the bottom rail."},
            "col_start": {"type": "integer", "description": f"Left column, 0..{RACK_COLUMNS - 1}."},
        },
    }),
    Tool(name="set_device_faceplate", description="Give a mount a different faceplate. Reseeds its ports (dropping the cables patched to the old ones) and relocates the mount when the new plate no longer fits where it sits.", inputSchema={
        "type": "object",
        "required": ["design_id", "mount_id", "faceplate_id"],
        "properties": {
            **_DESIGN_ID,
            "mount_id": {"type": "string"},
            "faceplate_id": {"type": "string"},
        },
    }),
    Tool(name="patch_cable", description="Patch a cable between two ports. Ports are named by label (eth1, P12) or by id. One cable per port; the cable type follows the port it starts from.", inputSchema={
        "type": "object",
        "required": ["design_id", "from_mount_id", "from_port", "to_mount_id", "to_port"],
        "properties": {
            **_DESIGN_ID,
            "from_mount_id": {"type": "string"},
            "from_port": {"type": "string", "description": "Port label or id on the source mount."},
            "to_mount_id": {"type": "string"},
            "to_port": {"type": "string", "description": "Port label or id on the target mount."},
            "color": {"type": "string", "description": "Sheath colour, e.g. '#39d353'. Defaults to the type's."},
            "label": {"type": "string", "description": "Cable label, e.g. a patch reference."},
            "label_visible": {"type": "boolean", "description": "Print the label on the run. Default false."},
        },
    }),
    Tool(name="unpatch_cable", description="Remove a patched cable.", inputSchema={
        "type": "object",
        "required": ["design_id", "cable_id"],
        "properties": {**_DESIGN_ID, "cable_id": {"type": "string"}},
    }),
]

RACK_TOOL_NAMES = {tool.name for tool in RACK_TOOLS}


async def dispatch_rack(name: str, args: dict) -> Any:
    design_id: str = args.get("design_id") or ""

    # --- Reads --------------------------------------------------------------
    if name == "list_faceplates":
        return [
            {
                "id": plate["id"],
                "label": plate["label"],
                "group": plate["group"],
                "kind": plate["kind"],
                "u_height": plate["u_height"],
                "col_span": plate["col_span"],
                "port_count": len(plate["ports"]),
            }
            for plate in FACEPLATES
        ]

    if name == "list_racks":
        state = await _load_state(design_id)
        return [_slim_rack(r, state["devices"]) for r in state["racks"]]

    if name == "get_rack":
        state = await _load_state(design_id)
        rack_id = args.get("rack_id")
        racks = [r for r in state["racks"] if rack_id is None or r["id"] == rack_id]
        if rack_id is not None and not racks:
            _rack_or_raise(state, rack_id)
        wanted = {r["id"] for r in racks}
        mounts = [d for d in state["devices"] if d["rack_id"] in wanted]
        by_mount = {d["id"]: d for d in state["devices"]}
        mount_ids = {d["id"] for d in mounts}
        return {
            "racks": [
                {
                    **_slim_rack(rack, state["devices"]),
                    "devices": [_slim_mount(d) for d in mounts if d["rack_id"] == rack["id"]],
                }
                for rack in racks
            ],
            "cables": [
                _slim_cable(c, by_mount)
                for c in state["cables"]
                if c["from_device_id"] in mount_ids or c["to_device_id"] in mount_ids
            ],
        }

    if name == "list_rack_inventory":
        data = cast(dict[str, Any], await backend.get(f"/api/v1/racks/inventory?design_id={quote(design_id)}"))
        return [_slim_inventory_item(item) for item in data.get("items", [])]

    # --- Writes -------------------------------------------------------------
    if name == "create_rack":
        state = await _load_state(design_id)
        u_height = _clamp_u(args.get("u_height", 24))
        # Lay a new rack out to the right of the last one, as the canvas does.
        count = len(state["racks"])
        rack = {
            "id": str(uuid.uuid4()),
            "name": args["name"],
            "u_height": u_height,
            "width_standard": args.get("width_standard", "19"),
            "numbering": args.get("numbering", "bottom-up"),
            "location": args.get("location"),
            "style": dict(DEFAULT_RACK_STYLE),
            "pos_x": args.get("pos_x", 80 + count * 620),
            "pos_y": args.get("pos_y", 60),
        }
        state["racks"].append(rack)
        await _save_state(design_id, state)
        return {"rack_id": rack["id"], "name": rack["name"], "u_height": u_height}

    if name == "update_rack":
        state = await _load_state(design_id)
        rack = _rack_or_raise(state, args["rack_id"])
        previous_height = rack["u_height"]

        for field in ("name", "width_standard", "numbering", "location", "pos_x", "pos_y"):
            if field in args:
                rack[field] = args[field]
        if "u_height" in args:
            rack["u_height"] = _clamp_u(args["u_height"])

        if rack["u_height"] < previous_height:
            _relocate_after_shrink(state, rack)

        await _save_state(design_id, state)
        return {"rack_id": rack["id"], "name": rack["name"], "u_height": rack["u_height"]}

    if name == "delete_rack":
        state = await _load_state(design_id)
        rack = _rack_or_raise(state, args["rack_id"])
        dropped = {d["id"] for d in state["devices"] if d["rack_id"] == rack["id"]}
        state["racks"] = [r for r in state["racks"] if r["id"] != rack["id"]]
        state["devices"] = [d for d in state["devices"] if d["id"] not in dropped]
        cables_before = len(state["cables"])
        state["cables"] = [
            c
            for c in state["cables"]
            if c["from_device_id"] not in dropped and c["to_device_id"] not in dropped
        ]
        await _save_state(design_id, state)
        return {
            "deleted": rack["id"],
            "unmounted": len(dropped),
            "cables_removed": cables_before - len(state["cables"]),
        }

    if name == "mount_device":
        return await _mount_device(design_id, args)

    if name == "mount_accessory":
        state = await _load_state(design_id)
        rack = _rack_or_raise(state, args["rack_id"])
        plate = _plate_or_raise(args["faceplate_id"])
        slot = _slot_or_raise(rack, state["devices"], args, plate)
        mount = {
            "id": str(uuid.uuid4()),
            "rack_id": rack["id"],
            "device_id": None,
            "node_id": None,
            "label": args.get("label") or plate["label"],
            "faceplate_id": plate["id"],
            "color": None,
            "status": "unknown",
            "port_visibility": "auto",
            "ports": _seed_ports(plate),
            **slot,
        }
        state["devices"].append(mount)
        await _save_state(design_id, state)
        return {"mount_id": mount["id"], "rack_id": rack["id"], "faceplate_id": plate["id"], **slot}

    if name == "unmount_device":
        state = await _load_state(design_id)
        mount = _mount_or_raise(state, args["mount_id"])
        state["devices"] = [d for d in state["devices"] if d["id"] != mount["id"]]
        cables_before = len(state["cables"])
        state["cables"] = [
            c
            for c in state["cables"]
            if c["from_device_id"] != mount["id"] and c["to_device_id"] != mount["id"]
        ]
        await _save_state(design_id, state)
        return {
            "unmounted": mount["id"],
            "label": mount["label"],
            "cables_removed": cables_before - len(state["cables"]),
            "inventory_device_id": mount.get("device_id"),
        }

    if name == "move_device":
        state = await _load_state(design_id)
        mount = _mount_or_raise(state, args["mount_id"])
        rack = _rack_or_raise(state, args.get("rack_id") or mount["rack_id"])
        target = {
            **_placement(mount),
            **({"u_start": args["u_start"]} if "u_start" in args else {}),
            **({"col_start": args["col_start"]} if "col_start" in args else {}),
        }
        if not can_place(rack, state["devices"], {**target, "rack_id": rack["id"]}, mount["id"]):
            raise ValueError(
                f"{mount['label']} does not fit at U {target['u_start']}, column "
                f"{target['col_start']} in {rack['name']}: out of bounds or occupied. "
                "Call get_rack to see what is there."
            )
        mount["rack_id"] = rack["id"]
        mount.update(target)
        await _save_state(design_id, state)
        return {"mount_id": mount["id"], "rack_id": rack["id"], **target}

    if name == "set_device_faceplate":
        state = await _load_state(design_id)
        mount = _mount_or_raise(state, args["mount_id"])
        rack = _rack_or_raise(state, mount["rack_id"])
        plate = _plate_or_raise(args["faceplate_id"])

        desired = {
            "u_start": mount["u_start"],
            "u_height": plate["u_height"],
            "col_start": mount["col_start"],
            "col_span": plate["col_span"],
        }
        placed = find_slot(rack, state["devices"], desired, mount["id"])
        if placed is None:
            raise ValueError(
                f"{rack['name']} has no free slot for a {plate['u_height']}U x "
                f"{plate['col_span']}-column plate. Free some room or pick a smaller faceplate."
            )
        mount["faceplate_id"] = plate["id"]
        mount["ports"] = _seed_ports(plate)
        mount.update(placed)

        # Cables point at port ids that no longer exist on this mount.
        cables_before = len(state["cables"])
        state["cables"] = [
            c
            for c in state["cables"]
            if c["from_device_id"] != mount["id"] and c["to_device_id"] != mount["id"]
        ]
        await _save_state(design_id, state)
        return {
            "mount_id": mount["id"],
            "faceplate_id": plate["id"],
            "cables_removed": cables_before - len(state["cables"]),
            **placed,
        }

    if name == "patch_cable":
        state = await _load_state(design_id)
        source = _mount_or_raise(state, args["from_mount_id"])
        target = _mount_or_raise(state, args["to_mount_id"])
        from_port = _resolve_port(source, args["from_port"])
        to_port = _resolve_port(target, args["to_port"])
        if source["id"] == target["id"] and from_port["id"] == to_port["id"]:
            raise ValueError("A cable cannot patch a port to itself.")

        for mount, port in ((source, from_port), (target, to_port)):
            existing = _cable_on_port(state, mount["id"], port["id"])
            if existing is not None:
                raise ValueError(
                    f"{mount['label']} port {port['label']} is already patched "
                    f"(cable {existing['id']}). Unpatch it first."
                )

        cable_type = PORT_CABLE_TYPE.get(str(from_port.get("type")), "ethernet")
        cable = {
            "id": str(uuid.uuid4()),
            "from_device_id": source["id"],
            "from_port_id": from_port["id"],
            "to_device_id": target["id"],
            "to_port_id": to_port["id"],
            "type": cable_type,
            "color": args.get("color") or CABLE_COLORS[cable_type],
            "label": args.get("label"),
            "label_visible": args.get("label_visible", False),
            "properties": [],
        }
        state["cables"].append(cable)
        await _save_state(design_id, state)
        return {
            "cable_id": cable["id"],
            "type": cable_type,
            "from": f"{source['label']} {from_port['label']}",
            "to": f"{target['label']} {to_port['label']}",
        }

    if name == "unpatch_cable":
        state = await _load_state(design_id)
        cable_id = args["cable_id"]
        if not any(c["id"] == cable_id for c in state["cables"]):
            raise ValueError(f"Unknown cable {cable_id}. Call get_rack to list the cables.")
        state["cables"] = [c for c in state["cables"] if c["id"] != cable_id]
        await _save_state(design_id, state)
        return {"unpatched": cable_id}

    raise ValueError(f"Unknown rack tool: {name}")


def _clamp_u(value: Any) -> int:
    """The rack canvas' own capacity bounds. The backend takes up to 100 U, but a
    rack outside 1..48 is one the UI's own controls cannot edit back."""
    return max(MIN_RACK_U, min(MAX_RACK_U, int(value)))


def _plate_or_raise(faceplate_id: str) -> dict[str, Any]:
    plate = get_faceplate(faceplate_id)
    if plate is None:
        raise ValueError(f"Unknown faceplate '{faceplate_id}'. Call list_faceplates for the catalog.")
    return plate


def _slot_or_raise(
    rack: dict[str, Any],
    devices: list[dict[str, Any]],
    args: dict[str, Any],
    plate: dict[str, Any],
    u_height: int | None = None,
    col_span: int | None = None,
) -> dict[str, Any]:
    desired = {
        "u_start": args.get("u_start", 1),
        "u_height": args.get("u_height") or u_height or plate["u_height"],
        "col_start": args.get("col_start", 0),
        "col_span": args.get("col_span") or col_span or plate["col_span"],
    }
    slot = find_slot(rack, devices, desired)
    if slot is None:
        raise ValueError(
            f"{rack['name']} has no free slot for a {desired['u_height']}U x "
            f"{desired['col_span']}-column plate ({free_units(rack, devices)}U free)."
        )
    return slot


def _relocate_after_shrink(state: dict[str, Any], rack: dict[str, Any]) -> None:
    """Move the mounts a shrink pushed above the top rail down into the rack.

    Placed one at a time against the layout decided so far, so two relocated
    mounts cannot be handed the same slot. Refuses the whole edit when one has
    nowhere to go, rather than dropping a mount off the rack — the rule the
    canvas applies (frontend/src/rack/store.ts:492).
    """
    mounted = [d for d in state["devices"] if d["rack_id"] == rack["id"]]
    pushed_out = [d for d in mounted if d["u_start"] + d["u_height"] - 1 > rack["u_height"]]
    if not pushed_out:
        return

    pushed_ids = {d["id"] for d in pushed_out}
    settled = [d for d in mounted if d["id"] not in pushed_ids]
    for device in pushed_out:
        slot = find_slot(
            rack, settled, {**_placement(device), "u_start": rack["u_height"]}, device["id"]
        )
        if slot is None:
            raise ValueError(
                f"Cannot shrink {rack['name']} to {rack['u_height']}U: {device['label']} "
                "would sit above the top rail and there is no free slot left for it."
            )
        device.update(slot)
        settled.append(device)


async def _mount_device(design_id: str, args: dict[str, Any]) -> dict[str, Any]:
    state = await _load_state(design_id)
    rack = _rack_or_raise(state, args["rack_id"])

    inventory = cast(
        dict[str, Any], await backend.get(f"/api/v1/racks/inventory?design_id={quote(design_id)}")
    )
    item = next(
        (i for i in inventory.get("items", []) if i["id"] == args["inventory_device_id"]), None
    )
    if item is None:
        raise ValueError(
            f"Unknown inventory device {args['inventory_device_id']}, or its type cannot be "
            "racked. Call list_rack_inventory for what is available."
        )
    if item.get("racked"):
        raise ValueError(
            f"{item['label']} is already mounted on this design. Use move_device to "
            "relocate it, or unmount_device first."
        )

    # The inventory row owns the front panel: a device racked before keeps the
    # plate it wears, and only a never-racked one falls back to its type's.
    plate_id = args.get("faceplate_id") or item.get("rack_faceplate_id") or suggest_faceplate(
        item.get("suggested_type")
    )
    plate = _plate_or_raise(plate_id)
    # The stored size and ports only apply to the plate they were measured on.
    modelled = item.get("rack_faceplate_id") == plate["id"]

    slot = _slot_or_raise(
        rack,
        state["devices"],
        args,
        plate,
        u_height=item.get("rack_u_height") if modelled else None,
        col_span=item.get("rack_col_span") if modelled else None,
    )
    ports = (
        [dict(p) for p in item.get("rack_ports") or []]
        if modelled
        else _seed_ports(plate)
    )

    mount = {
        "id": str(uuid.uuid4()),
        "rack_id": rack["id"],
        "device_id": item["id"],
        "node_id": item.get("node_id"),
        "label": args.get("label") or item["label"],
        "faceplate_id": plate["id"],
        "color": item.get("rack_color") if modelled else None,
        "status": item.get("status", "unknown"),
        "port_visibility": "auto",
        "ports": ports,
        **slot,
    }
    state["devices"].append(mount)
    await _save_state(design_id, state)
    return {
        "mount_id": mount["id"],
        "rack_id": rack["id"],
        "label": mount["label"],
        "faceplate_id": plate["id"],
        "ports": len(ports),
        **slot,
    }
