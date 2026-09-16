import re
from pathlib import Path

from app.documents import DOC_KINDS

DOC_TREE_FILE = (
    Path(__file__).resolve().parents[2] / "backend" / "app" / "services" / "doc_tree.py"
)


def _backend_document_kinds() -> set[str]:
    src = DOC_TREE_FILE.read_text()
    match = re.search(r"DOCUMENT_KINDS = frozenset\(\{([^}]+)\}\)", src)
    assert match, (
        "Could not locate DOCUMENT_KINDS in backend/app/services/doc_tree.py — "
        "update this parser if the file's shape changed."
    )
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def test_doc_kinds_in_sync_with_the_backend():
    """A kind the MCP advertises but the backend rejects is a 422 the client cannot fix."""
    backend_kinds = _backend_document_kinds()
    mcp_kinds = set(DOC_KINDS)
    assert mcp_kinds == backend_kinds, (
        "mcp/app/documents.py DOC_KINDS is out of sync with backend DOCUMENT_KINDS.\n"
        f"Missing from DOC_KINDS: {sorted(backend_kinds - mcp_kinds)}\n"
        f"Extra in DOC_KINDS: {sorted(mcp_kinds - backend_kinds)}"
    )
