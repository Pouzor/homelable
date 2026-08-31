import json
from mcp.server import Server
from mcp.server.lowlevel.helper_types import ReadResourceContents
from mcp.types import Resource, ResourceTemplate
from .backend_client import backend

RESOURCE_LIST = [
    Resource(uri="homelable://canvas",        name="Canvas",          description="Full canvas state (nodes + edges + viewport)", mimeType="application/json"),
    Resource(uri="homelable://nodes",          name="Nodes",           description="All nodes in the homelab", mimeType="application/json"),
    Resource(uri="homelable://edges",          name="Edges",           description="All network edges/links", mimeType="application/json"),
    Resource(uri="homelable://scan/pending",   name="Pending devices", description="Discovered devices awaiting approval", mimeType="application/json"),
    Resource(uri="homelable://scan/runs",      name="Scan history",    description="Recent scan run history", mimeType="application/json"),
]

ROUTES = {
    "homelable://canvas":       "/api/v1/canvas",
    "homelable://nodes":        "/api/v1/nodes",
    "homelable://edges":        "/api/v1/edges",
    "homelable://scan/pending": "/api/v1/scan/pending",
    "homelable://scan/runs":    "/api/v1/scan/runs",
}

# read_resource() also serves homelable://nodes/<id>, which is not in
# RESOURCE_LIST because it is a template, not a concrete URI. Without a
# list_resource_templates handler the SDK answers resources/templates/list with
# "Method not found" and the template stays invisible to every client.
RESOURCE_TEMPLATES = [
    ResourceTemplate(
        uriTemplate="homelable://nodes/{node_id}",
        name="Node",
        description="A single node by id",
        mimeType="application/json",
    ),
]


# The low-level Server.read_resource decorator expects str, bytes or an
# iterable of ReadResourceContents, and reads .content / .mime_type off each
# item. Returning mcp.types.TextContent instead fails at serialisation time with
# "'TextContent' object has no attribute 'content'" — the handler runs, so the
# error only surfaces to the client, never in the server log.
async def read_resource(uri: str) -> list[ReadResourceContents]:
    # The MCP framework hands us a pydantic AnyUrl, not a plain str, so string
    # ops like .startswith / dict lookups blow up with
    # "'AnyUrl' object has no attribute 'startswith'". Coerce to str first.
    uri = str(uri)
    if uri.startswith("homelable://nodes/") and uri != "homelable://nodes/":
        node_id = uri.split("/")[-1]
        data = await backend.get(f"/api/v1/nodes/{node_id}")
        return [_json_contents(data)]

    if uri not in ROUTES:
        raise ValueError(f"Unknown resource URI: {uri}")

    data = await backend.get(ROUTES[uri])
    return [_json_contents(data)]


def _json_contents(data) -> ReadResourceContents:
    return ReadResourceContents(
        content=json.dumps(data, indent=2),
        mime_type="application/json",
    )


def register_resources(server: Server):
    @server.list_resources()
    async def _list():
        return RESOURCE_LIST

    @server.list_resource_templates()
    async def _list_templates():
        return RESOURCE_TEMPLATES

    @server.read_resource()
    async def _read(uri: str):
        return await read_resource(uri)
