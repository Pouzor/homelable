import re
from pathlib import Path

from app.tools import EDGE_TYPES

FRONTEND_TYPES_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "types" / "index.ts"


def _frontend_edge_types() -> set[str]:
    src = FRONTEND_TYPES_FILE.read_text()
    match = re.search(r"export type EdgeType =([^\n]+)", src)
    assert match, (
        "Could not locate the EdgeType union in frontend/src/types/index.ts — "
        "update this parser if the file's shape changed."
    )
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_edge_types_in_sync_with_frontend():
    frontend_types = _frontend_edge_types()
    mcp_types = set(EDGE_TYPES)
    assert mcp_types == frontend_types, (
        "mcp/app/tools.py EDGE_TYPES is out of sync with frontend/src/types/index.ts EdgeType.\n"
        f"Missing from EDGE_TYPES: {sorted(frontend_types - mcp_types)}\n"
        f"Extra in EDGE_TYPES (no longer an edge type?): {sorted(mcp_types - frontend_types)}"
    )
