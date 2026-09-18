"""The API's advertised version tracks the VERSION file.

Regression guard: `FastAPI(version=...)` used to be a hard-coded literal that
the release process never touched. It froze at 1.9.0 in April 2026, when the
VERSION file took over as the source of truth, and drifted for ten releases —
`/openapi.json` and the Swagger UI badge advertised 1.9.0 while the app shipped
3.4.x. Nothing pinned it, so nothing caught it.
"""

from pathlib import Path

from httpx import AsyncClient

from app.core.config import APP_VERSION
from app.main import app

VERSION_FILE = Path(__file__).parent.parent.parent / "VERSION"


def test_app_version_comes_from_the_version_file():
    assert app.version == APP_VERSION


def test_app_version_is_not_a_stale_literal():
    # The loader falls back to "unknown" when it cannot find the file; in a repo
    # checkout it always can, so an "unknown" here means the fallback silently
    # took over and the schema would advertise nothing useful.
    assert VERSION_FILE.read_text().strip() == APP_VERSION
    assert APP_VERSION != "unknown"


async def test_openapi_schema_advertises_the_current_version(client: AsyncClient):
    res = await client.get("/openapi.json")
    assert res.status_code == 200
    info = res.json()["info"]
    assert info["title"] == "Homelable API"
    # What the Swagger UI badge renders.
    assert info["version"] == VERSION_FILE.read_text().strip()
