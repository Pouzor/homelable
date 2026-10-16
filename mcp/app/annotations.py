"""MCP tool annotations: readOnlyHint / destructiveHint / openWorldHint.

Clients use these hints to decide what an agent may call without asking:
read-only tools can run freely, destructive ones deserve a confirmation, and
open-world ones reach beyond Homelable's own database (a network scan). Every
tool must be classified here: tests/test_annotations.py fails CI for a tool that
is not, and until it is, annotation_for() serves it the most cautious hints
(and logs a warning) rather than stopping the server from starting.
"""
import logging

from mcp.types import Tool, ToolAnnotations

logger = logging.getLogger(__name__)

READ_ONLY = frozenset({
    "get_scan_config", "list_proxmox_children",
    "search_documentation", "list_documentation", "read_document",
    "list_document_revisions", "read_document_revision", "document_backlinks",
    "list_edges", "get_canvas", "list_nodes", "list_node_summaries", "get_node",
    "list_pending_devices", "list_inventory", "list_hidden_devices",
    "list_zones", "list_designs",
    "list_racks", "get_rack", "list_rack_inventory", "list_faceplates",
})

WRITE = frozenset({
    "create_device", "update_device", "bulk_approve_devices", "bulk_hide_devices",
    "bulk_restore_devices",
    "create_document", "update_document", "restore_document_revision",
    "create_node", "update_node", "create_edge", "update_edge",
    "approve_device", "hide_device", "restore_device",
    "create_zone", "add_to_zone", "remove_from_zone", "create_design",
    "create_rack", "update_rack", "mount_device", "mount_accessory", "move_device",
    "patch_cable",
})

DESTRUCTIVE = frozenset({
    "delete_device", "delete_node", "delete_edge", "delete_design", "delete_rack",
    "unmount_device", "unpatch_cable", "set_device_faceplate", "update_scan_config",
})

# Tools that make the backend touch the network (nmap), not just its database.
OPEN_WORLD = frozenset({"trigger_scan", "rescan_device"})


def annotation_for(name: str) -> ToolAnnotations:
    if name in READ_ONLY:
        return ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
    if name in WRITE:
        return ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
    if name in DESTRUCTIVE:
        return ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)
    if name in OPEN_WORLD:
        return ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True)
    logger.warning("MCP tool %r has no annotation class; serving it as destructive and open-world "
                   "until it is added to app/annotations.py", name)
    return ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=True)


def annotate(tools: list[Tool]) -> list[Tool]:
    return [tool.model_copy(update={"annotations": annotation_for(tool.name)}) for tool in tools]
