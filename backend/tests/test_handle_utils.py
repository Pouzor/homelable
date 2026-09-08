"""Unit tests for the per-side connection-point vocabulary.

Mirrors frontend/src/utils/handleUtils.ts — the two must agree, or the server
stores handles the canvas cannot draw.
"""

import pytest

from app.schemas.utils import (
    MAX_HANDLES,
    clamp_handles,
    handle_count_field,
    handle_id,
    parse_side_handle,
    removed_handle_ids,
    side_default,
)


@pytest.mark.parametrize(("side", "expected"), [("top", 1), ("bottom", 1), ("left", 0), ("right", 0)])
def test_side_default(side: str, expected: int) -> None:
    assert side_default(side) == expected


def test_handle_count_field() -> None:
    assert handle_count_field("left") == "left_handles"


@pytest.mark.parametrize(("raw", "expected"), [(0, 0), (3, 3), (64, 64), (65, 64), (5000, MAX_HANDLES), (-1, 0)])
def test_clamp_handles_bounds(raw: int, expected: int) -> None:
    assert clamp_handles("bottom", raw) == expected


@pytest.mark.parametrize("raw", [None, "4", float("nan"), float("inf"), True])
def test_clamp_handles_falls_back_to_the_side_default(raw: object) -> None:
    # A missing or corrupt count still yields the historical number, per side.
    assert clamp_handles("bottom", raw) == 1
    assert clamp_handles("left", raw) == 0


def test_clamp_handles_truncates_a_fraction() -> None:
    assert clamp_handles("bottom", 3.9) == 3


def test_handle_id_keeps_the_bare_side_name_for_slot_zero() -> None:
    # Slot 0 stays 'bottom' so edges saved before the multi-handle expansion
    # keep resolving.
    assert handle_id("bottom", 0) == "bottom"
    assert handle_id("bottom", 1) == "bottom-2"
    assert handle_id("left", 3) == "left-4"


def test_removed_handle_ids() -> None:
    assert removed_handle_ids("bottom", 4, 2) == {"bottom-3", "bottom-4"}
    assert removed_handle_ids("bottom", 2, 2) == set()
    assert removed_handle_ids("bottom", 1, 4) == set()


@pytest.mark.parametrize(
    ("handle", "expected"),
    [
        ("top", ("top", 0)),
        ("bottom-2", ("bottom", 1)),
        ("left-4", ("left", 3)),
        # The invisible target twin resolves to the same slot as its source.
        ("right-t", ("right", 0)),
        ("bottom-3-t", ("bottom", 2)),
    ],
)
def test_parse_side_handle(handle: str, expected: tuple[str, int]) -> None:
    assert parse_side_handle(handle) == expected


@pytest.mark.parametrize("handle", ["cluster-right", "", "middle", "top-left", "bottom-x"])
def test_parse_side_handle_ignores_a_foreign_namespace(handle: str) -> None:
    # Not a per-side handle: whoever owns it interprets it, not the side counts.
    assert parse_side_handle(handle) is None


@pytest.mark.parametrize("handle", ["bottom-0", "bottom-1"])
def test_parse_side_handle_reports_an_impossible_slot(handle: str) -> None:
    # The numbered form is 2-based, so these are IDs the canvas never emits;
    # slot -1 means no count can satisfy them.
    assert parse_side_handle(handle) == ("bottom", -1)
