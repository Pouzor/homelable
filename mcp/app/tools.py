import json
from mcp.server import Server
from mcp.types import Tool, TextContent
from .backend_client import backend


NODE_TYPES = ["isp", "router", "switch", "server", "proxmox", "vm", "lxc", "nas", "iot", "ap", "generic"]

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


def _build_tools() -> list[Tool]:
    create_node_props = {
        "type": {"type": "string", "enum": NODE_TYPES},
        **_NODE_FIELDS,
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
                "type":   {"type": "string", "enum": ["ethernet", "wifi", "iot", "vlan", "virtual"], "default": "ethernet"},
                "label":  {"type": "string"},
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
            },
        }),
        Tool(name="hide_device", description="Hide a pending discovered device", inputSchema={
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        }),
        Tool(name="get_canvas", description="Get the full canvas: all nodes and edges in the homelab topology", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="list_nodes", description="List all nodes (devices) in the homelab", inputSchema={
            "type": "object",
            "properties": {},
        }),
        Tool(name="list_pending_devices", description="List devices discovered by scan but not yet approved or hidden", inputSchema={
            "type": "object",
            "properties": {},
        }),
    ]


TOOLS = _build_tools()


def register_tools(server: Server):

    @server.list_tools()
    async def list_tools():
        return TOOLS

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):
        result = await _dispatch(name, arguments)
        return [TextContent(type="text", text=json.dumps(result, indent=2))]


def _slim_canvas(raw: dict) -> dict:
    """Strip React Flow layout/style fields — keep only semantic data for AI use."""
    NODE_KEEP = {
        "id", "type", "label", "ip", "hostname", "mac", "os", "status", "services",
        "notes", "description", "properties", "cpu_count", "cpu_model", "ram_gb",
        "disk_gb", "parentId",
    }
    EDGE_KEEP = {"id", "source", "target", "type", "label"}

    def slim_node(n: dict) -> dict:
        data = n.get("data", {})
        out = {k: v for k, v in data.items() if k in NODE_KEEP and v not in (None, "", [])}
        out["id"] = n.get("id")
        out["node_type"] = n.get("type")
        return out

    def slim_edge(e: dict) -> dict:
        return {k: v for k, v in e.items() if k in EDGE_KEEP and v not in (None, "")}

    return {
        "nodes": [slim_node(n) for n in raw.get("nodes", [])],
        "edges": [slim_edge(e) for e in raw.get("edges", [])],
    }


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
        raw = await backend.get("/api/v1/canvas")
        return _slim_canvas(raw)

    if name == "list_nodes":
        return await backend.get("/api/v1/nodes")

    if name == "list_pending_devices":
        return await backend.get("/api/v1/scan/pending")

    raise ValueError(f"Unknown tool: {name}")
