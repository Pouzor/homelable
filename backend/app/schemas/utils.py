import math
import re
from collections.abc import Mapping


def normalize_animated(v: object) -> str:
    """Normalize legacy bool/int animated values to string mode ('none'/'snake'/'flow')."""
    if v is True or v == 1 or v == '1':
        return 'snake'
    if v is False or v == 0 or v == '0' or v is None or v == 'none':
        return 'none'
    if v in ('snake', 'flow', 'basic'):
        return str(v)
    return 'none'


MARKER_SHAPES = {'none', 'arrow', 'arrow-open', 'circle', 'diamond', 'square'}


def normalize_marker(v: object) -> str:
    """Normalize an edge endpoint marker to a shape string.

    Legacy saves stored a boolean (True = filled arrow); coerce those and any
    unknown value to a valid MarkerShape ('none' when off/unknown).
    """
    if v is True or v == 1 or v == '1':
        return 'arrow'
    if v is False or v == 0 or v == '0' or v is None:
        return 'none'
    if isinstance(v, str) and v in MARKER_SHAPES:
        return v
    return 'none'


# ---------------------------------------------------------------------------
# Connection points (React Flow handles)
# ---------------------------------------------------------------------------
# Mirrors frontend/src/utils/handleUtils.ts — keep the two in step.
#
# Handle IDs:  slot 0      = the bare side name ('top' | 'bottom' | 'left' | 'right')
#              slot N >= 1 = '{side}-{N + 1}'  (e.g. 'bottom-2', 'left-3')
#
# Slot 0 keeps the bare name so edges saved before the multi-handle expansion
# stay valid. Invisible target handles carry a '-t' suffix on the frontend only;
# what is stored on an edge is always the source form.

SIDES = ('top', 'bottom', 'left', 'right')

MIN_HANDLES = 0
MAX_HANDLES = 64


def side_default(side: str) -> int:
    """Count a side falls back to when the node carries no explicit value.

    Top/bottom default to their historical single handle; left/right to none, so
    an existing diagram gains no side handles unless the user opts in.
    """
    return 1 if side in ('top', 'bottom') else 0


def handle_count_field(side: str) -> str:
    """The `nodes` column storing a side's handle count."""
    return f"{side}_handles"


def clamp_handles(side: str, n: object) -> int:
    """Clamp a raw count into 0..64.

    A non-numeric or non-finite value falls back to the side default, so a
    corrupt field still yields the historical count; an explicit 0 is honoured.
    """
    if isinstance(n, bool) or not isinstance(n, int | float):
        return side_default(side)
    if isinstance(n, float) and not math.isfinite(n):
        return side_default(side)
    return max(MIN_HANDLES, min(MAX_HANDLES, math.floor(n)))


def handle_id(side: str, idx: int) -> str:
    """The source handle ID at a given slot index for a side."""
    return side if idx == 0 else f"{side}-{idx + 1}"


def removed_handle_ids(side: str, old_count: int, new_count: int) -> set[str]:
    """The source handle IDs dropped when a side shrinks from old to new count."""
    return {handle_id(side, i) for i in range(new_count, old_count)}


# A side handle ID, in either the source form ('left', 'left-3') or the
# invisible target form the frontend renders alongside it ('left-t', 'left-3-t').
_SIDE_HANDLE_RE = re.compile(r'^(top|bottom|left|right)(?:-(\d+))?(?:-t)?$')


def parse_side_handle(handle: str) -> tuple[str, int] | None:
    """Split a side handle ID into (side, slot index), or None when it isn't one.

    A handle outside this vocabulary is left for its owner to interpret — the
    'cluster-*' IDs a specialized node renderer draws are not per-side handles
    and must not be validated against a side's count.

    The numbered form is 2-based, because slot 0 keeps the bare side name: an
    ID ending in '-0' or '-1' is therefore one the canvas never emits, and is
    reported as slot -1 so that no count can satisfy it.
    """
    m = _SIDE_HANDLE_RE.match(handle)
    if m is None:
        return None
    side, slot = m.group(1), m.group(2)
    if slot is None:
        return side, 0
    idx = int(slot) - 1
    return side, (idx if idx >= 1 else -1)


# ---------------------------------------------------------------------------
# Port labels
# ---------------------------------------------------------------------------
# The text printed next to a connection point in place of its 1..N number, so a
# node can carry the numbering of the real device (#495). Keyed by source handle
# ID. Mirrors normalizePortLabels / prunePortLabels in handleUtils.ts.

MAX_PORT_LABEL_LENGTH = 8


def normalize_port_labels(v: object) -> dict[str, str] | None:
    """Keep the well-formed labels: a source-form handle ID → trimmed, non-empty text.

    Text is cut to MAX_PORT_LABEL_LENGTH, the most the card has room for. A bad
    entry is dropped rather than rejected, like the handle-count clamp: it must
    not cost the user a whole canvas save. None when nothing is left.
    """
    if not isinstance(v, dict):
        return None
    out: dict[str, str] = {}
    for key, label in v.items():
        if not isinstance(key, str) or not isinstance(label, str):
            continue
        parsed = parse_side_handle(key)
        # The round trip rejects the '-t' target form and padded slots ('top-02').
        if parsed is None or not 0 <= parsed[1] < MAX_HANDLES or handle_id(*parsed) != key:
            continue
        text = label.strip()[:MAX_PORT_LABEL_LENGTH]
        if text:
            out[key] = text
    return out or None


def prune_port_labels(
    labels: dict[str, str] | None, counts: Mapping[str, int | None]
) -> dict[str, str] | None:
    """Drop the labels of connection points a side's count no longer reaches.

    A side with no count falls back to its default, as everywhere else.
    """
    if not labels:
        return None
    kept: dict[str, str] = {}
    for key, text in labels.items():
        parsed = parse_side_handle(key)
        if parsed is None:
            continue
        side, idx = parsed
        count = counts.get(side)
        if idx < (side_default(side) if count is None else count):
            kept[key] = text
    return kept or None
