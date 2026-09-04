"""app/rack_layout.py is a port of frontend/src/rack/layout.ts.

The cases are the frontend's own (frontend/src/rack/__tests__/layout.test.ts,
`occupancy` / `findSlot` / `freeUnits`), transcribed so the two implementations
answer the same questions the same way. A tool that picks a slot the canvas
would refuse mounts hardware where the user cannot see or drag it.
"""

from app.faceplates import RACK_COLUMNS
from app.rack_layout import can_place, find_slot, free_units, is_in_bounds


def make_rack(**patch):
    return {"id": "r1", "name": "Rack", "u_height": 10, **patch}


def make_device(**patch):
    return {
        "id": "d1",
        "rack_id": "r1",
        "label": "dev",
        "u_start": 1,
        "u_height": 1,
        "col_start": 0,
        "col_span": RACK_COLUMNS,
        **patch,
    }


def placement(u_start, u_height=1, col_start=0, col_span=RACK_COLUMNS):
    return {
        "u_start": u_start,
        "u_height": u_height,
        "col_start": col_start,
        "col_span": col_span,
    }


# --- occupancy --------------------------------------------------------------
def test_rejects_placements_outside_the_rack():
    rack = make_rack()
    assert is_in_bounds(rack, placement(0)) is False
    assert is_in_bounds(rack, placement(10, u_height=2)) is False
    assert is_in_bounds(rack, placement(1, col_start=6)) is False
    assert is_in_bounds(rack, placement(9, u_height=2)) is True


def test_detects_a_full_width_collision():
    rack = make_rack()
    devices = [make_device(u_start=3)]
    assert can_place(rack, devices, placement(3)) is False


def test_two_half_width_devices_share_one_u():
    rack = make_rack()
    devices = [make_device(u_start=3, col_start=0, col_span=6)]
    assert can_place(rack, devices, placement(3, col_start=6, col_span=6)) is True
    assert can_place(rack, devices, placement(3, col_start=4, col_span=6)) is False


def test_three_third_width_devices_share_one_u():
    rack = make_rack()
    devices = [
        make_device(id="a", u_start=2, col_start=0, col_span=4),
        make_device(id="b", u_start=2, col_start=4, col_span=4),
    ]
    assert can_place(rack, devices, placement(2, col_start=8, col_span=4)) is True


def test_catches_a_multi_u_overlap_from_either_direction():
    rack = make_rack()
    devices = [make_device(u_start=4, u_height=3)]  # U4..U6
    assert can_place(rack, devices, placement(6, u_height=2)) is False
    assert can_place(rack, devices, placement(2, u_height=3)) is False
    assert can_place(rack, devices, placement(7, u_height=2)) is True


def test_ignores_the_device_being_moved():
    rack = make_rack()
    devices = [make_device(id="d1", u_start=5)]
    assert can_place(rack, devices, placement(5)) is False
    assert can_place(rack, devices, placement(5), "d1") is True


def test_ignores_devices_mounted_in_another_rack():
    rack = make_rack()
    devices = [make_device(rack_id="other", u_start=5)]
    assert can_place(rack, devices, placement(5)) is True


# --- find_slot --------------------------------------------------------------
def test_keeps_the_requested_u_when_it_is_free():
    slot = find_slot(make_rack(), [], placement(4, u_height=2))
    assert slot == placement(4, u_height=2)


def test_slides_to_a_free_u_when_the_target_is_taken():
    devices = [make_device(u_start=4)]
    slot = find_slot(make_rack(), devices, placement(4))
    assert slot is not None
    assert slot["u_start"] != 4


def test_uses_free_columns_on_the_target_u_before_moving_away():
    devices = [make_device(u_start=4, col_start=0, col_span=6)]
    slot = find_slot(make_rack(), devices, placement(4, col_start=7, col_span=6))
    assert slot == placement(4, col_start=6, col_span=6)


def test_clamps_a_request_that_would_overflow_the_top():
    slot = find_slot(make_rack(), [], placement(10, u_height=3))
    assert slot is not None
    assert slot["u_start"] == 8


def test_none_when_the_device_is_taller_than_the_rack():
    assert find_slot(make_rack(u_height=2), [], placement(1, u_height=4)) is None


def test_none_when_the_rack_is_full():
    rack = make_rack(u_height=2)
    devices = [make_device(id="a", u_start=1), make_device(id="b", u_start=2)]
    assert find_slot(rack, devices, placement(1)) is None


# --- free_units -------------------------------------------------------------
def test_counts_a_partially_filled_u_as_busy():
    rack = make_rack(u_height=4)
    devices = [make_device(u_start=2, col_start=0, col_span=6)]
    assert free_units(rack, devices) == 3


def test_counts_multi_u_devices_once_per_occupied_u():
    rack = make_rack(u_height=4)
    devices = [make_device(u_start=1, u_height=3)]
    assert free_units(rack, devices) == 1
