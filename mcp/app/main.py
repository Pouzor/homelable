from contextlib import asynccontextmanager
from fastapi import FastAPI
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.routing import Mount

from .auth import ApiKeyMiddleware
from .backend_client import backend
from .resources import register_resources
from .tools import register_tools


mcp_server = Server("homelable")
register_resources(mcp_server)
register_tools(mcp_server)

session_manager = StreamableHTTPSessionManager(
    app=mcp_server,
    json_response=False,
    stateless=True,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await backend.start()
    async with session_manager.run():
        yield
    await backend.stop()


# Mount the session manager as an ASGI sub-app instead of wrapping it in a
# FastAPI @app.api_route handler. Wrapping it in a route handler causes
# FastAPI to send http.response.start after the session manager has already
# started the response, raising `RuntimeError: Unexpected ASGI message
# 'http.response.start' sent, after response already completed` on every
# POST /mcp — which makes the server unreachable from any MCP client.
app = FastAPI(
    title="Homelable MCP",
    lifespan=lifespan,
    routes=[Mount("/mcp", app=session_manager.handle_request)],
)
app.add_middleware(ApiKeyMiddleware)


@app.get("/health")
async def health():
    return {"status": "ok"}
