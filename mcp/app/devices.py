"""Device Inventory write tools.

The inventory (`device_inventory`) is what a scan finds plus what the user
documents by hand. `tools.py` already reads and triages it; these are the write
routes behind the inventory UI — create, edit, delete, the bulk actions, the
per-device deep rescan and the scan configuration.
"""

from typing import Any

from mcp.types import Tool

from .backend_client import backend

# Fields shared by create and update, mirroring InventoryDeviceCreate /
# InventoryDeviceUpdate (backend/app/schemas/scan.py). `_dispatch` forwards args
# verbatim, so anything advertised here is what the backend already validates.
_DEVICE_FIELDS = {
    "ip": {"type": "string"},
    "mac": {"type": "string"},
    "os": {"type": "string"},
    "suggested_type": {"type": "string", "description": "What kind of hardware this is (server, switch, nas, ...). Drives the icon, the filters and the rack faceplate suggestion."},
    "model": {"type": "string"},
    "vendor": {"type": "string"},
    "friendly_name": {"type": "string", "description": "Display name, preferred over the hostname everywhere the device is listed."},
    "device_subtype": {"type": "string"},
    "label": {"type": "string"},
    "type": {"type": "string"},
    "notes": {"type": "string"},
    "services": {"type": "array", "items": {"type": "object"}, "description": "Services running on the device: [{port, protocol, service_name, category}]."},
    # Same shape as a node's: `key` is the identity the backend merges on.
    "properties": {"type": "array", "items": {"type": "object"}, "description": "Key/value metadata: [{key, value, icon, visible}]. `key` is required — keyless properties collapse into one."},
    "cpu_count": {"type": "integer"},
    "cpu_model": {"type": "string"},
    "ram_gb": {"type": "number"},
    "disk_gb": {"type": "number"},
    "show_hardware": {"type": "boolean"},
    "check_method": {"type": "string", "description": "Status check method (ping, http, https, ssh, prometheus, tcp)."},
    "check_target": {"type": "string"},
}

# The front panel the device wears in every rack. Editable from the inventory as
# well as from a rack canvas; sending `rack_faceplate_id` is what models a device.
_RACK_MODEL_FIELDS = {
    "rack_faceplate_id": {"type": "string", "description": "Faceplate the device wears in a rack. Call list_faceplates for ids."},
    "rack_u_height": {"type": "integer"},
    "rack_col_span": {"type": "integer"},
    "rack_color": {"type": "string"},
    "rack_ports": {"type": "array", "items": {"type": "object"}, "description": "Ports on the faceplate: [{id, label, type, x, y}]."},
}

DEVICE_TOOLS = [
    Tool(name="create_device", description="Add hardware to the Device Inventory by hand — a dumb switch, a patch panel, a machine no scan can reach. Merges into the existing entry when the ip or mac is already known.", inputSchema={
        "type": "object",
        "required": ["hostname"],
        "properties": {
            "hostname": {"type": "string", "description": "Host name, or any name when the device has none."},
            "discovery_source": {"type": "string", "enum": ["manual", "rack"], "default": "manual", "description": "'rack' marks a placeholder created for a rack plate; it can never be approved onto a logical canvas."},
            **_DEVICE_FIELDS,
        },
    }),
    Tool(name="update_device", description="Edit an inventory entry: the device facts and its rack faceplate. Only the fields sent are applied. Lifecycle (pending/approved/hidden) is owned by the approve/hide/restore tools.", inputSchema={
        "type": "object",
        "required": ["id"],
        "properties": {
            "id": {"type": "string"},
            "hostname": {"type": "string"},
            **_DEVICE_FIELDS,
            **_RACK_MODEL_FIELDS,
        },
    }),
    Tool(name="delete_device", description="Delete an inventory entry outright. A canvas node drawing it survives with its link cleared; use hide_device instead to keep the entry out of the way without losing it.", inputSchema={
        "type": "object",
        "required": ["id"],
        "properties": {"id": {"type": "string"}},
    }),
    Tool(name="bulk_approve_devices", description="Approve several discovered devices at once, creating a node for each on the target canvas. Devices created from a rack are skipped — they never go on a logical canvas.", inputSchema={
        "type": "object",
        "required": ["device_ids"],
        "properties": {
            "device_ids": {"type": "array", "items": {"type": "string"}},
            "design_id": {"type": "string", "description": "Canvas the nodes land on. Omit for the default (first) canvas."},
        },
    }),
    Tool(name="bulk_hide_devices", description="Hide several pending devices at once, taking them out of the inventory listing.", inputSchema={
        "type": "object",
        "required": ["device_ids"],
        "properties": {"device_ids": {"type": "array", "items": {"type": "string"}}},
    }),
    Tool(name="bulk_restore_devices", description="Un-hide several devices at once, returning them to pending.", inputSchema={
        "type": "object",
        "required": ["device_ids"],
        "properties": {"device_ids": {"type": "array", "items": {"type": "string"}}},
    }),
    Tool(name="rescan_device", description="Deep-rescan one known device to refresh its services. Sweeps every TCP port by default, which is slow; recorded as a scan run like any other.", inputSchema={
        "type": "object",
        "required": ["id"],
        "properties": {
            "id": {"type": "string"},
            "full_ports": {"type": "boolean", "default": True, "description": "Sweep all 65535 TCP ports."},
            "ports": {"type": "string", "description": "Narrow the sweep, e.g. '80,443' or '1-1024'. Wins over full_ports."},
            "http_probe_enabled": {"type": "boolean", "description": "Probe HTTP(S) services for banners and titles."},
            "verify_tls": {"type": "boolean"},
        },
    }),
    Tool(name="list_proxmox_children", description="Inventory entries for the VMs and containers a Proxmox host runs. Empty for anything that is not a host.", inputSchema={
        "type": "object",
        "required": ["id"],
        "properties": {"id": {"type": "string", "description": "Inventory id of the Proxmox host."}},
    }),
    Tool(name="get_scan_config", description="The persisted scan defaults: the ranges swept, and the HTTP probe settings.", inputSchema={
        "type": "object",
        "properties": {},
    }),
    Tool(name="update_scan_config", description="Replace the persisted scan defaults. `ranges` is the full list, not an addition.", inputSchema={
        "type": "object",
        "required": ["ranges"],
        "properties": {
            "ranges": {"type": "array", "items": {"type": "string"}, "description": "CIDR ranges to sweep, e.g. ['192.168.1.0/24']."},
            "http_ranges": {"type": "array", "items": {"type": "string"}, "description": "Port ranges probed for HTTP, e.g. ['80,443', '8000-8100']."},
            "http_probe_enabled": {"type": "boolean"},
            "verify_tls": {"type": "boolean"},
        },
    }),
]

DEVICE_TOOL_NAMES = {tool.name for tool in DEVICE_TOOLS}


async def dispatch_device(name: str, args: dict) -> Any:
    if name == "create_device":
        return await backend.post("/api/v1/scan/pending", args)

    if name == "update_device":
        body = {k: v for k, v in args.items() if k != "id"}
        return await backend.patch(f"/api/v1/scan/pending/{args['id']}", body)

    if name == "delete_device":
        return await backend.delete(f"/api/v1/scan/pending/{args['id']}")

    if name == "bulk_approve_devices":
        approval: dict[str, Any] = {"device_ids": args["device_ids"]}
        if args.get("design_id"):
            approval["design_id"] = args["design_id"]
        return await backend.post("/api/v1/scan/pending/bulk-approve", approval)

    if name == "bulk_hide_devices":
        return await backend.post("/api/v1/scan/pending/bulk-hide", {"device_ids": args["device_ids"]})

    if name == "bulk_restore_devices":
        return await backend.post("/api/v1/scan/pending/bulk-restore", {"device_ids": args["device_ids"]})

    if name == "rescan_device":
        options = {k: v for k, v in args.items() if k != "id"}
        return await backend.post(f"/api/v1/scan/pending/{args['id']}/rescan", options)

    if name == "list_proxmox_children":
        return await backend.get(f"/api/v1/scan/pending/{args['id']}/proxmox-children")

    if name == "get_scan_config":
        return await backend.get("/api/v1/scan/config")

    if name == "update_scan_config":
        return await backend.post("/api/v1/scan/config", args)

    raise ValueError(f"Unknown device tool: {name}")
