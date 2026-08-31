import json
from urllib.parse import quote
from mcp.server import Server
from mcp.types import Tool, TextContent
from .backend_client import backend


# Kept in sync manually with frontend/src/types/index.ts NodeType (device types only —
# group/groupRect/text are canvas annotations created via dedicated UI actions, not create_node).
# Sync is enforced automatically by test_node_types_in_sync_with_frontend (mcp/tests/test_node_types_sync.py).
NODE_TYPES = [
    "isp", "router", "firewall", "switch", "server", "proxmox", "vm", "lxc", "nas", "kvm", "iot", "ap",
    "camera", "printer", "computer", "laptop", "mobile", "cpl", "docker_host", "docker_container",
    "generic", "zigbee_coordinator", "zigbee_router", "zigbee_enddevice",
    "zwave_coordinator", "zwave_router", "zwave_enddevice", "grid", "ups", "battery", "generator",
    "solar_panel", "inverter", "circuit_breaker", "contactor", "electrical_switch", "socket",
    "light", "meter", "transformer", "load",
]

# Kept in sync manually with frontend/src/types/index.ts EdgeType.
# Sync is enforced automatically by test_edge_types_in_sync_with_frontend (mcp/tests/test_edge_types_sync.py).
EDGE_TYPES = [
    "ethernet", "wifi", "iot", "vlan", "virtual", "cluster", "fibre", "electrical",
]

# Shared field schemas mirroring backend NodeBase / NodeUpdate (backend/app/schemas/nodes.py).
# create_node and update_node both expose these so the MCP is symmetric with what the
# backend already validates and stores. _dispatch forwards args verbatim, so any field
# advertised here is accepted by the backend.
_NODE_FIELDS = {
    "label":         {"type": "string"},
    "ip":            {"type": "string"},
    "hostname":      {"type": "string"},
    "mac":           {"type": "string", "description": "MAC address."},
    "os":            {"type": "string", "description": "Operating system / distribution."},
    "status":        {"type": "string", "enum": ["online", "offline", "unknown", "pending"]},
    "check_method":  {"type": "string", "description": "Status check method (ping, http, https, ssh, prometheus, tcp)."},
    "check_target":  {"type": "string", "description": "Target host/URL used by the status check."},
    "services":      {"type": "array", "items": {"type": "object"}, "description": "Running services detected or documented on the node."},
    "notes":         {"type": "string", "description": "Free-text notes / documentation for the node."},
    "pos_x":         {"type": "number", "description": "X position on the canvas. Omit on create to auto-place (root nodes only)."},
    "pos_y":         {"type": "number", "description": "Y position on the canvas. Omit on create to auto-place (root nodes only). For child nodes this is relative to the parent container."},
    "width":         {"type": "number", "description": "Width of the node card in pixels. Mainly useful for container nodes."},
    "height":        {"type": "number", "description": "Height of the node card in pixels. Mainly useful for container nodes."},
    "parent_id":     {"type": "string", "description": "ID of the parent node (e.g. Proxmox host for a VM/LXC). Pass null to detach."},
    "container_mode": {"type": "boolean", "description": "Render this node as a container/group that can hold children."},
    "custom_icon":   {"type": "string", "description": "Override icon name for the node."},
    "cpu_count":     {"type": "integer", "description": "Number of CPU cores/threads."},
    "cpu_model":     {"type": "string", "description": "CPU model name."},
    "ram_gb":        {"type": "number", "description": "RAM in gigabytes."},
    "disk_gb":       {"type": "number", "description": "Disk capacity in gigabytes."},
    "show_hardware": {"type": "boolean", "description": "Display hardware specs on the node card."},
    "properties":    {
        "type": "array",
        "description": "Arbitrary key/value metadata shown on the node.",
        "items": {
            "type": "object",
            "required": ["name", "value"],
            "properties": {
                "name":  {"type": "string"},
                "value": {"type": "string"},
            },
        },
    },
}

# Optional design/canvas selector. The backend attaches nodes/edges to the first
# design when design_id is omitted (see backend nodes.py / edges.py), so these
# tools stay backward compatible; pass design_id to target a specific canvas.
# Use list_designs to discover the available IDs.
_DESIGN_ID_FIELD = {
    "design_id": {"type": "string", "description": "Target design/canvas ID. Omit to use the default (first) canvas; call list_designs to discover IDs."},
}


def _build_tools() -> list[Tool]:
    create_node_props = {
        "type": {"type": "string", "enum": NODE_TYPES},
        **_NODE_FIELDS,
        **_DESIGN_ID_FIELD,
    }
    create_node_props["status"] = {**_NODE_FIELDS["status"], "default": "unknown"}

    update_node_props = {
        "id":   {"type": "string"},
        "type": {"type": "string", "enum": NODE_TYPES},
        **_NODE_FIELDS,
    }

    return [
        Tool(name="create_node", description="Add a new node to the homelab canvas", inputSchema={
            "type": "object",
            "required": ["type", "label"],
            "properties": create_node_props,
        }),
        Tool(name="update_node", description="Update an existing node", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": update_node_props,
        }),
        Tool(name="delete_node", description="Delete a node from the canvas", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        }),
        Tool(name="create_edge", description="Create a network link between two nodes", inputSchema={
            "type": "object",
            "required": ["source", "target"],
            "properties": {
                "source": {"type": "string"},
                "target": {"type": "string"},
                "type":   {"type": "string", "enum": EDGE_TYPES, "default": "ethernet"},
                "label":  {"type": "string"},
                **_DESIGN_ID_FIELD,
            },
        }),
        Tool(name="delete_edge", description="Delete a network link", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        }),
        Tool(name="trigger_scan", description="Trigger a network discovery scan", inputSchema={
            "type": "object",
            "properties": {
                "ranges": {"type": "array", "items": {"type": "string"}, "description": "CIDR ranges to scan (uses configured defaults if omitted)"},
            },
        }),
        Tool(name="approve_device", description="Approve a pending discovered device and create a node", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": {
                "id":    {"type": "string"},
                "type":  {"type": "string", "enum": NODE_TYPES, "default": "generic"},
                "label": {"type": "string"},
                **_DESIGN_ID_FIELD,
            },
        }),
        Tool(name="hide_device", description="Hide a pending discovered device", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        }),
        Tool(name="get_canvas", description="Get the full canvas: all nodes and edges in the homelab topology", inputSchema={
            "type": "object",
            "properties": {**_DESIGN_ID_FIELD},
        }),
        Tool(name="list_nodes", description="List all nodes (devices) in the homelab", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="list_node_summaries", description="List all nodes with only id/label/type/status — a lighter, lower-token alternative to list_nodes or get_canvas for when full node detail (ip, services, notes, hardware, properties, ...) isn't needed.", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="get_node", description="Get node(s) by id or by label. Provide exactly one of the two. Lookup by 'id' returns a single full node object. Lookup by 'label' is a case-insensitive substring match and returns a list of full node objects, since labels are not unique.", inputSchema={
            "type": "object",
            "properties": {
                "id":    {"type": "string", "description": "Node id. Returns a single node object."},
                "label": {"type": "string", "description": "Case-insensitive substring match on label. Returns a list of matching node objects."},
            },
        }),
        Tool(name="list_pending_devices", description="List devices discovered by scan but not yet approved or hidden", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="list_inventory", description="List the full device inventory (everything scanned except user-hidden devices): both pending devices awaiting triage and already-approved devices. Each row carries a 'status' field. Use the optional 'status' filter to narrow the result.", inputSchema={
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["all", "pending", "approved"], "default": "all", "description": "Filter inventory by status. 'all' returns pending + approved."},
            },
        }),
        Tool(name="list_hidden_devices", description="List devices the user has hidden from the inventory. Hidden devices are excluded from list_pending_devices and list_inventory; use restore_device to bring one back to pending.", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="restore_device", description="Restore (un-hide) a previously hidden device, returning it to pending status so it reappears in the triage list. Use this to undo a hide_device action.", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        }),
        Tool(name="list_designs", description="List all designs (canvases) with their IDs and node/group/text counts", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="create_design", description="Create a new design (canvas) and return it, including its id for use as design_id", inputSchema={
            "type": "object",
            "required": ["name"],
            "properties": {
                "name":        {"type": "string", "description": "Name of the new canvas."},
                "icon":        {"type": "string", "description": "Icon name for the canvas (default: dashboard)."},
                "design_type": {"type": "string", "description": "Design type (default: network)."},
            },
        }),
        Tool(name="delete_design", description="Delete a design (canvas) and all its nodes and edges. The last remaining design cannot be deleted.", inputSchema={
            "type": "object",
            "required": ["design_id"],
            "properties": {
                "design_id": {"type": "string", "description": "ID of the design to delete. Call list_designs to discover IDs."},
            },
        }),
    ]


TOOLS = _build_tools()


def register_tools(server: Server, *, read_only: bool = False):

    @server.list_tools()
    async def list_tools():
        return [] if read_only else TOOLS

    # Deliberately do not register a call_tool handler in read-only mode. This
    # makes a dedicated read-only MCP process safe even if a client bypasses
    # tool discovery and attempts to call a legacy canvas mutation tool.
    if not read_only:
        @server.call_tool()
        async def call_tool(name: str, arguments: dict):
            result = await _dispatch(name, arguments)
            return [TextContent(type="text", text=json.dumps(result, indent=2))]


def _slim_canvas(raw: dict) -> dict:
    """Strip layout/style fields — keep only semantic data for AI use.

    `GET /api/v1/canvas` reports a node flat (`NodeResponse`): the device facts
    sit beside `id` and `type`, not under a React Flow `data` key. A payload that
    does carry `data` — the shape the frontend store holds — is folded in too, so
    either form slims to the same thing.
    """
    NODE_KEEP = {
        "label", "ip", "hostname", "mac", "os", "status", "services",
        "notes", "description", "properties", "cpu_count", "cpu_model", "ram_gb",
        "disk_gb", "parent_id",
    }
    EDGE_KEEP = {"id", "source", "target", "type", "label"}

    def slim_node(n: dict) -> dict:
        fields = {**n, **n.get("data", {})}
        out = {k: v for k, v in fields.items() if k in NODE_KEEP and v not in (None, "", [])}
        out["id"] = n.get("id")
        # `type` on the wire is the node type (router, proxmox, ...); it is
        # reported under its own key so it cannot collide with a device fact.
        out["node_type"] = n.get("type")
        # Nesting is `parent_id` on the API and `parentId` in a React Flow payload.
        parent = out.pop("parent_id", None) or n.get("parentId")
        if parent:
            out["parent_id"] = parent
        return out

    def slim_edge(e: dict) -> dict:
        return {k: v for k, v in e.items() if k in EDGE_KEEP and v not in (None, "")}

    return {
        "nodes": [slim_node(n) for n in raw.get("nodes", [])],
        "edges": [slim_edge(e) for e in raw.get("edges", [])],
    }


def _slim_node_summary(n: dict) -> dict:
    """Only the fields needed to identify a node and reference it in later calls."""
    return {"id": n.get("id"), "label": n.get("label"), "type": n.get("type"), "status": n.get("status")}


async def _dispatch(name: str, args: dict) -> dict:
    if name == "create_node":
        return await backend.post("/api/v1/nodes", args)

    if name == "update_node":
        node_id = args.pop("id")
        return await backend.patch(f"/api/v1/nodes/{node_id}", args)

    if name == "delete_node":
        return await backend.delete(f"/api/v1/nodes/{args['id']}")

    if name == "create_edge":
        return await backend.post("/api/v1/edges", args)

    if name == "delete_edge":
        return await backend.delete(f"/api/v1/edges/{args['id']}")

    if name == "trigger_scan":
        body = {"ranges": args["ranges"]} if "ranges" in args else {}
        return await backend.post("/api/v1/scan/trigger", body)

    if name == "approve_device":
        device_id = args.pop("id")
        return await backend.post(f"/api/v1/scan/pending/{device_id}/approve", args)

    if name == "hide_device":
        return await backend.post(f"/api/v1/scan/pending/{args['id']}/hide", {})

    if name == "get_canvas":
        design_id = args.get("design_id")
        path = f"/api/v1/canvas?design_id={design_id}" if design_id else "/api/v1/canvas"
        raw = await backend.get(path)
        return _slim_canvas(raw)

    if name == "list_nodes":
        return await backend.get("/api/v1/nodes")

    if name == "list_node_summaries":
        nodes = await backend.get("/api/v1/nodes")
        return [_slim_node_summary(n) for n in nodes]

    if name == "get_node":
        node_id = args.get("id")
        label = args.get("label")
        if node_id:
            return await backend.get(f"/api/v1/nodes/{node_id}")
        if label:
            return await backend.get(f"/api/v1/nodes?label={quote(label)}")
        raise ValueError("get_node requires either 'id' or 'label'")

    if name == "list_pending_devices":
        # Backend /scan/pending returns the whole inventory: approved rows stay
        # listed so the frontend can show a canvas-presence badge. This tool
        # promises only devices "not yet approved or hidden", so filter to
        # actual pending rows (legacy rows without a status count as pending).
        devices = await backend.get("/api/v1/scan/pending")
        return [d for d in devices if d.get("status", "pending") == "pending"]

    if name == "list_inventory":
        # /scan/pending returns the whole inventory minus hidden rows (pending +
        # approved). Legacy rows without a status field count as pending.
        devices = await backend.get("/api/v1/scan/pending")
        wanted = args.get("status", "all")
        if wanted == "all":
            return devices
        return [d for d in devices if d.get("status", "pending") == wanted]

    if name == "list_hidden_devices":
        return await backend.get("/api/v1/scan/hidden")

    if name == "restore_device":
        return await backend.post(f"/api/v1/scan/pending/{args['id']}/restore", {})

    if name == "list_designs":
        return await backend.get("/api/v1/designs")

    if name == "create_design":
        return await backend.post("/api/v1/designs", args)

    if name == "delete_design":
        return await backend.delete(f"/api/v1/designs/{args['design_id']}")

    raise ValueError(f"Unknown tool: {name}")
