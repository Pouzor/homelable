import re
from pathlib import Path

from app.documents import DOC_TEMPLATES

DOC_TEMPLATE_FILE = (
    Path(__file__).resolve().parents[2] / "backend" / "app" / "services" / "doc_template.py"
)


def _backend_template_ids() -> set[str]:
    """Every TEMPLATE_* constant — TEMPLATE_IDS is the device one plus the library ones."""
    src = DOC_TEMPLATE_FILE.read_text()
    ids = set(re.findall(r'^TEMPLATE_[A-Z]+ = "([^"]+)"', src, re.MULTILINE))
    assert ids, (
        "Could not locate the TEMPLATE_* constants in backend/app/services/doc_template.py — "
        "update this parser if the file's shape changed."
    )
    return ids


def test_doc_templates_in_sync_with_the_backend():
    """template_id is validated server-side: an advertised one that is gone is a 422."""
    backend_templates = _backend_template_ids()
    mcp_templates = set(DOC_TEMPLATES)
    assert mcp_templates == backend_templates, (
        "mcp/app/documents.py DOC_TEMPLATES is out of sync with backend TEMPLATE_IDS.\n"
        f"Missing from DOC_TEMPLATES: {sorted(backend_templates - mcp_templates)}\n"
        f"Extra in DOC_TEMPLATES: {sorted(mcp_templates - backend_templates)}"
    )
