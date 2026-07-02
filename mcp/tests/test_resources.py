import pytest
from pydantic import AnyUrl
from unittest.mock import AsyncMock, patch
from app.resources import read_resource


@pytest.fixture
def mock_backend():
    with patch("app.resources.backend") as m:
        m.get = AsyncMock(return_value={"data": "ok"})
        yield m


@pytest.mark.anyio
async def test_read_canvas(mock_backend):
    result = await read_resource("homelable://canvas")
    mock_backend.get.assert_called_once_with("/api/v1/canvas")
    assert len(result) == 1


@pytest.mark.anyio
async def test_read_nodes(mock_backend):
    await read_resource("homelable://nodes")
    mock_backend.get.assert_called_once_with("/api/v1/nodes")


@pytest.mark.anyio
async def test_read_edges(mock_backend):
    await read_resource("homelable://edges")
    mock_backend.get.assert_called_once_with("/api/v1/edges")


@pytest.mark.anyio
async def test_read_single_node(mock_backend):
    await read_resource("homelable://nodes/abc123")
    mock_backend.get.assert_called_once_with("/api/v1/nodes/abc123")


@pytest.mark.anyio
async def test_read_scan_pending(mock_backend):
    await read_resource("homelable://scan/pending")
    mock_backend.get.assert_called_once_with("/api/v1/scan/pending")


@pytest.mark.anyio
async def test_read_unknown_uri(mock_backend):
    with pytest.raises(ValueError, match="Unknown resource URI"):
        await read_resource("homelable://unknown")


@pytest.mark.anyio
async def test_read_resource_accepts_anyurl(mock_backend):
    # Regression for #225: the MCP framework calls the handler with a pydantic
    # AnyUrl, not a str, which raised "'AnyUrl' object has no attribute
    # 'startswith'". The handler must coerce to str and still route correctly.
    await read_resource(AnyUrl("homelable://canvas"))
    mock_backend.get.assert_called_once_with("/api/v1/canvas")


@pytest.mark.anyio
async def test_read_edges_anyurl(mock_backend):
    await read_resource(AnyUrl("homelable://edges"))
    mock_backend.get.assert_called_once_with("/api/v1/edges")


@pytest.mark.anyio
async def test_read_single_node_anyurl(mock_backend):
    await read_resource(AnyUrl("homelable://nodes/abc123"))
    mock_backend.get.assert_called_once_with("/api/v1/nodes/abc123")
