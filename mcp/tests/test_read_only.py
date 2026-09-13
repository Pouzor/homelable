import pytest
from unittest.mock import AsyncMock, patch

from app.main import create_mcp_server
from app.tools import register_tools


class CapturingServer:
    """Minimal decorator-compatible Server fake for capability registration."""

    def list_resources(self):
        def register(handler):
            self.list_resources_handler = handler
            return handler

        return register

    def read_resource(self):
        def register(handler):
            self.read_resource_handler = handler
            return handler

        return register

    def list_tools(self):
        def register(handler):
            self.list_tools_handler = handler
            return handler

        return register

    def call_tool(self):
        def register(handler):
            self.call_tool_handler = handler
            return handler

        return register


@pytest.mark.anyio
async def test_read_only_registration_lists_no_tools_and_has_no_tool_handler():
    server = CapturingServer()

    register_tools(server, read_only=True)

    assert await server.list_tools_handler() == []
    assert not hasattr(server, "call_tool_handler")


@pytest.mark.anyio
async def test_default_tool_registration_preserves_existing_tools():
    server = CapturingServer()

    register_tools(server)

    assert await server.list_tools_handler()
    assert hasattr(server, "call_tool_handler")


@pytest.mark.anyio
async def test_read_only_server_keeps_kubernetes_resource_readable():
    server = CapturingServer()
    with patch("app.main.Server", return_value=server):
        create_mcp_server(read_only=True)

    resources = await server.list_resources_handler()
    assert any(str(item.uri) == "homelable://kubernetes/topology" for item in resources)
    assert await server.list_tools_handler() == []

    with patch("app.resources.backend") as backend:
        backend.get = AsyncMock(return_value={"schemaVersion": 1, "objects": [], "relationships": []})
        result = await server.read_resource_handler("homelable://kubernetes/topology")

    backend.get.assert_called_once_with("/api/v1/kubernetes/topology")
    assert result[0].type == "text"
