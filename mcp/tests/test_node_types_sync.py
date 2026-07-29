import re
from pathlib import Path

from app.tools import NODE_TYPES

FRONTEND_TYPES_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "types" / "index.ts"

# Canvas annotations, not devices — created via dedicated UI actions (grouping a
# selection, "Add Zone", "Add Text"), never through create_node/approve_device.
ANNOTATION_TYPES = {"group", "groupRect", "text"}


def _frontend_node_types() -> set[str]:
    src = FRONTEND_TYPES_FILE.read_text()
    match = re.search(r"export type NodeType =\n((?:\s*\|\s*'[^']+'\n)+)", src)
    assert match, (
        "Could not locate the NodeType union in frontend/src/types/index.ts — "
        "update this parser if the file's shape changed."
    )
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_node_types_in_sync_with_frontend():
    frontend_types = _frontend_node_types() - ANNOTATION_TYPES
    mcp_types = set(NODE_TYPES)
    assert mcp_types == frontend_types, (
        "mcp/app/tools.py NODE_TYPES is out of sync with frontend/src/types/index.ts NodeType.\n"
        f"Missing from NODE_TYPES: {sorted(frontend_types - mcp_types)}\n"
        f"Extra in NODE_TYPES (no longer a device type?): {sorted(mcp_types - frontend_types)}"
    )
