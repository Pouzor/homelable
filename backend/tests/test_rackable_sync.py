"""The rackable exclusion list is duplicated in the frontend — keep them equal.

`GET /api/v1/racks/inventory` filters on `_UNRACKABLE_TYPES`, while the Device
Inventory modal's "Rackable" filter (used as the rack picker's default) filters
on `UNRACKABLE_TYPES` in `frontend/src/utils/rackable.ts`. If the two drift, the
picker offers devices the rack side then refuses.
"""
import re
from pathlib import Path

from app.api.routes.racks import _UNRACKABLE_TYPES

FRONTEND_FILE = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "rackable.ts"
)


def _frontend_unrackable() -> set[str]:
    src = FRONTEND_FILE.read_text()
    match = re.search(r"export const UNRACKABLE_TYPES = new Set\(\[(.*?)\]\)", src, re.S)
    assert match, (
        "Could not locate UNRACKABLE_TYPES in frontend/src/utils/rackable.ts — "
        "update this parser if the file's shape changed."
    )
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_unrackable_types_in_sync_with_frontend():
    frontend = _frontend_unrackable()
    assert frontend == _UNRACKABLE_TYPES, (
        "racks.py _UNRACKABLE_TYPES is out of sync with frontend rackable.ts.\n"
        f"Missing from the backend: {sorted(frontend - _UNRACKABLE_TYPES)}\n"
        f"Missing from the frontend: {sorted(_UNRACKABLE_TYPES - frontend)}"
    )
