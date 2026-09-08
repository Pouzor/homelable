"""The backend's own explanation must survive the trip to the MCP client.

httpx's error text stops at the status line, so a rejected call used to reach the
caller as a bare "Client error '422 Unprocessable Content'" — the reason, which is
the only part that says what to do next, was dropped.
"""

import httpx
import pytest

from app.backend_client import BackendClient, BackendError


def _client_answering(response: httpx.Response) -> BackendClient:
    backend = BackendClient()
    backend._client = httpx.AsyncClient(
        base_url="http://backend",
        transport=httpx.MockTransport(lambda _request: response),
    )
    return backend


@pytest.mark.anyio
async def test_a_string_detail_reaches_the_caller():
    detail = "source_handle 'right-2' does not exist: node n1 has 0 connection point(s) on its right side."
    backend = _client_answering(httpx.Response(422, json={"detail": detail}))

    with pytest.raises(BackendError) as exc:
        await backend.post("/api/v1/edges", {})

    assert detail in str(exc.value)
    assert "422" in str(exc.value)
    assert exc.value.status_code == 422
    assert exc.value.detail == detail


@pytest.mark.anyio
async def test_a_structured_detail_is_serialized():
    # The approve-duplicate prompt answers with an object, not a string.
    backend = _client_answering(httpx.Response(409, json={"detail": {"code": "duplicate", "node_id": "n1"}}))

    with pytest.raises(BackendError) as exc:
        await backend.post("/api/v1/scan/pending/d1/approve", {})

    assert "duplicate" in str(exc.value)
    assert "n1" in str(exc.value)


@pytest.mark.anyio
async def test_a_non_json_body_falls_back_to_its_text():
    backend = _client_answering(httpx.Response(500, text="Internal Server Error"))

    with pytest.raises(BackendError) as exc:
        await backend.get("/api/v1/nodes")

    assert "Internal Server Error" in str(exc.value)


@pytest.mark.anyio
async def test_the_method_and_path_are_named():
    backend = _client_answering(httpx.Response(404, json={"detail": "Edge not found"}))

    with pytest.raises(BackendError) as exc:
        await backend.patch("/api/v1/edges/e1", {})

    assert "PATCH" in str(exc.value)
    assert "/api/v1/edges/e1" in str(exc.value)


@pytest.mark.anyio
async def test_a_long_detail_is_truncated():
    # An HTML error page must not land whole in the client's context.
    backend = _client_answering(httpx.Response(500, text="x" * 5000))

    with pytest.raises(BackendError) as exc:
        await backend.get("/api/v1/nodes")

    assert len(exc.value.detail) == 500


@pytest.mark.anyio
async def test_a_204_still_returns_an_empty_dict():
    backend = _client_answering(httpx.Response(204))

    assert await backend.delete("/api/v1/edges/e1") == {}


@pytest.mark.anyio
async def test_a_success_is_returned_unchanged():
    backend = _client_answering(httpx.Response(200, json={"id": "e1"}))

    assert await backend.get("/api/v1/edges/e1") == {"id": "e1"}
