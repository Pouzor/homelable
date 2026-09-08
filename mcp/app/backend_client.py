import json

import httpx

from .config import settings


class BackendError(RuntimeError):
    """A non-2xx answer from the backend, carrying the reason it gave.

    httpx's own error text stops at the status line and the URL, so FastAPI's
    `{"detail": ...}` — the half that says what to do about it — never reached
    the calling client. A rejected connection point, a duplicate device, a
    missing design: all of them arrived as a bare '422 Unprocessable Content'.
    """

    def __init__(self, method: str, path: str, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        suffix = f": {detail}" if detail else ""
        super().__init__(f"{method} {path} failed with {status_code}{suffix}")


# Enough for a FastAPI detail — a structured one included — without pasting a
# whole HTML error page into the client's context.
_MAX_DETAIL = 500


def _detail_of(resp: httpx.Response) -> str:
    """The backend's explanation for a failed response, as a single string.

    `detail` is a string for most errors and an object for the structured ones
    (the approve-duplicate prompt); anything else falls back to the raw body.
    """
    try:
        payload = resp.json()
    except ValueError:
        text = resp.text.strip()
    else:
        detail = payload.get("detail") if isinstance(payload, dict) else None
        if detail is None:
            text = json.dumps(payload)
        else:
            text = detail if isinstance(detail, str) else json.dumps(detail)
    return text[:_MAX_DETAIL]


class BackendClient:
    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    async def start(self):
        self._client = httpx.AsyncClient(
            base_url=settings.backend_url,
            headers={"X-MCP-Service-Key": settings.mcp_service_key},
            timeout=30.0,
        )

    async def stop(self):
        if self._client:
            await self._client.aclose()

    async def request(self, method: str, path: str, **kwargs) -> dict:
        resp = await self._client.request(method, path, **kwargs)
        if resp.is_error:
            raise BackendError(method, path, resp.status_code, _detail_of(resp))
        if resp.status_code == 204:
            return {}
        return resp.json()

    async def get(self, path: str) -> dict | list:
        return await self.request("GET", path)

    async def post(self, path: str, body: dict) -> dict:
        return await self.request("POST", path, json=body)

    async def patch(self, path: str, body: dict) -> dict:
        return await self.request("PATCH", path, json=body)

    async def delete(self, path: str) -> dict:
        return await self.request("DELETE", path)


backend = BackendClient()
