"""The Python faceplate catalog is a hand copy of the frontend one.

A plate added, resized or reported here drifts silently otherwise: a mount would
be seeded with the wrong footprint or the wrong ports, and the renderer would
draw something else than the tool said it mounted. This parses faceplates.ts and
compares, the way test_node_types_sync.py does for NODE_TYPES.
"""

import re
from pathlib import Path

import pytest

from app.faceplates import (
    DEVICE_TYPE_BY_FACEPLATE,
    FACEPLATE_BY_DEVICE_TYPE,
    FACEPLATES,
    NAS_BAND,
    bank,
)

FRONTEND_FACEPLATES = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "rack" / "faceplates.ts"
)

# Constants faceplates.ts writes its dimensions in terms of.
_CONSTANTS = {"RACK_COLUMNS": 12, "NAS_U": 5}


def _number(expression: str) -> int:
    """`RACK_COLUMNS / 6` and friends, resolved to the int the TS produces.

    A literal, a named constant, or a constant divided by a literal — the only
    three shapes the catalog uses. Parsed rather than evaluated.
    """
    resolved = expression.strip().rstrip(",")
    match = re.fullmatch(r"(\w+)(?:\s*/\s*(\d+))?", resolved)
    assert match, f"Unparsable dimension {expression!r} in faceplates.ts"
    term, divisor = match.group(1), match.group(2)
    value = _CONSTANTS[term] if term in _CONSTANTS else int(term)
    return value // int(divisor) if divisor else value


def _entries() -> list[str]:
    source = FRONTEND_FACEPLATES.read_text()
    start = source.index("export const FACEPLATES")
    end = source.index("\n]\n", start)
    body = source[start:end]
    # Every catalog entry is an object opened at two-space indentation.
    entries = body.split("\n  {\n")[1:]
    assert entries, (
        "Could not split the FACEPLATES array in frontend/src/rack/faceplates.ts — "
        "update this parser if the file's shape changed."
    )
    return entries


def _bank_calls(ports_source: str) -> list[dict]:
    """Every `bank({...})` in a plate's `ports:` value, as Python kwargs."""
    calls = []
    for raw in re.findall(r"bank\(\{([^}]*)\}\)", ports_source):
        kwargs: dict = {}
        for key, quoted, number in re.findall(r"(\w+):\s*(?:'([^']*)'|([\d.]+))", raw):
            kwargs[key] = quoted if number == "" else float(number)
        calls.append({
            "type": kwargs["type"],
            "count": int(kwargs["count"]),
            "x": kwargs["x"],
            "w": kwargs["w"],
            "per_row": int(kwargs["perRow"]) if "perRow" in kwargs else None,
            "prefix": kwargs.get("prefix", "P"),
            "start": int(kwargs.get("start", 1)),
        })
    return calls


def _parse(entry: str) -> dict:
    plate = {
        "id": re.search(r"id: '([^']+)'", entry).group(1),
        "label": re.search(r"label: '([^']+)'", entry).group(1),
        "kind": re.search(r"kind: '([^']+)'", entry).group(1),
        "group": re.search(r"group: '([^']+)'", entry).group(1),
        "u_height": _number(re.search(r"uHeight: ([^,\n]+)", entry).group(1)),
        "col_span": _number(re.search(r"colSpan: ([^,\n]+)", entry).group(1)),
    }
    # `ports:` is the last key of every entry, so everything after it is the
    # port declaration — and nothing from `elements:` (which has `count:` of its
    # own, for outlets) can leak in.
    ports_source = entry[entry.index("ports:"):]
    ports: list[dict] = []
    for call in _bank_calls(ports_source):
        ports.extend(bank(**call))
    if "nasPorts(" in ports_source:
        ports = [{**p, "y": NAS_BAND} for p in ports]
    plate["ports"] = ports
    return plate


def test_faceplates_in_sync_with_frontend():
    frontend = [_parse(entry) for entry in _entries()]
    frontend_ids = [p["id"] for p in frontend]
    catalog_ids = [p["id"] for p in FACEPLATES]

    assert catalog_ids == frontend_ids, (
        "mcp/app/faceplates.py FACEPLATES is out of sync with "
        "frontend/src/rack/faceplates.ts.\n"
        f"Missing: {[i for i in frontend_ids if i not in catalog_ids]}\n"
        f"Extra: {[i for i in catalog_ids if i not in frontend_ids]}\n"
        "(order matters — it is the order the picker shows)"
    )

    by_id = {p["id"]: p for p in FACEPLATES}
    for expected in frontend:
        plate = by_id[expected["id"]]
        for field in ("label", "kind", "group", "u_height", "col_span"):
            assert plate[field] == expected[field], (
                f"Faceplate '{expected['id']}' {field}: catalog has {plate[field]!r}, "
                f"faceplates.ts has {expected[field]!r}"
            )
        assert len(plate["ports"]) == len(expected["ports"]), (
            f"Faceplate '{expected['id']}' has {len(plate['ports'])} ports, "
            f"faceplates.ts declares {len(expected['ports'])}"
        )
        for port, want in zip(plate["ports"], expected["ports"]):
            assert port["label"] == want["label"] and port["type"] == want["type"], (
                f"Faceplate '{expected['id']}' port {port['label']}/{port['type']} "
                f"does not match {want['label']}/{want['type']}"
            )
            assert port["x"] == pytest.approx(want["x"]), f"{expected['id']} {port['label']} x"
            assert port["y"] == pytest.approx(want["y"]), f"{expected['id']} {port['label']} y"


def _ts_record(name: str) -> dict[str, str]:
    source = FRONTEND_FACEPLATES.read_text()
    match = re.search(rf"const {name}: Record<string, string> = \{{(.*?)\n\}}", source, re.S)
    assert match, f"Could not locate {name} in frontend/src/rack/faceplates.ts"
    return dict(re.findall(r"'?([\w-]+)'?:\s*'([^']+)'", match.group(1)))


def test_faceplate_suggestion_maps_in_sync():
    assert FACEPLATE_BY_DEVICE_TYPE == _ts_record("FACEPLATE_BY_DEVICE_TYPE"), (
        "mcp/app/faceplates.py FACEPLATE_BY_DEVICE_TYPE is out of sync with faceplates.ts"
    )
    assert DEVICE_TYPE_BY_FACEPLATE == _ts_record("DEVICE_TYPE_BY_FACEPLATE"), (
        "mcp/app/faceplates.py DEVICE_TYPE_BY_FACEPLATE is out of sync with faceplates.ts"
    )


def test_every_faceplate_is_reachable_by_id():
    """A plate the catalog lists but `get_faceplate` cannot return would make
    every tool that names it fail."""
    from app.faceplates import get_faceplate

    for plate in FACEPLATES:
        assert get_faceplate(plate["id"]) is plate
    assert get_faceplate("no-such-plate") is None
