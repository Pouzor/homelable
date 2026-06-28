import json
from mcp.server import Server
from mcp.types import Resource, TextContent
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


async def read_resource(uri: str) -> list[TextContent]:
    # The MCP framework hands us a pydantic AnyUrl, not a plain str, so string
    # ops like .startswith / dict lookups blow up with
    # "'AnyUrl' object has no attribute 'startswith'". Coerce to str first.
    uri = str(uri)
    if uri.startswith("homelable://nodes/") and uri != "homelable://nodes/":
        node_id = uri.split("/")[-1]
        data = await backend.get(f"/api/v1/nodes/{node_id}")
        return [TextContent(type="text", text=json.dumps(data, indent=2))]

    if uri not in ROUTES:
        raise ValueError(f"Unknown resource URI: {uri}")

    data = await backend.get(ROUTES[uri])
    return [TextContent(type="text", text=json.dumps(data, indent=2))]


def register_resources(server: Server):
    @server.list_resources()
    async def _list():
        return RESOURCE_LIST

    @server.read_resource()
    async def _read(uri: str):
        return await read_resource(uri)
