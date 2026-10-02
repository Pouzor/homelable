"""The three-way reconcile behind "Update from device".

Baseline (the generated body recorded at the last sync) / current (the body the
user has now) / new (freshly generated from the live device). The contract:

* user-only edits are preserved, identical changes never conflict;
* untouched facts where the device moved are applied without asking;
* a fact both sides changed is a conflict the user resolves (keep / device /
  custom), and the resolution is what lands in the merged body;
* the generated sections are reconciled whole; user sections never move a
  character;
* a missing baseline is conservative: never a silent overwrite.
"""

from datetime import date
from types import SimpleNamespace

import yaml

from app.services import doc_template as t
from app.services.doc_reconcile import (
    AUTO,
    CUSTOM,
    DEVICE,
    KEEP,
    SAME,
    Resolution,
    preview_id,
    reconcile,
)


# What the template reads off a row.
def _device(**overrides):
    base = dict(
        id="dev-1",
        label="homelabcluster",
        friendly_name=None,
        hostname="homelabcluster.example.lan",
        ip="192.168.10.20",
        mac="00:11:32:aa:bb:cc",
        ieee_address=None,
        os="Debian 12",
        vendor="Intel",
        model="N100",
        type="server",
        suggested_type=None,
        services=[
            {"port": 443, "protocol": "tcp", "service_name": "https", "category": "management"},
            {"port": 22, "protocol": "tcp", "service_name": "ssh"},
        ],
        properties=[{"key": "Serial", "value": "ABC123", "icon": None, "visible": True}],
        cpu_count=4,
        cpu_model="N100",
        ram_gb=16.0,
        disk_gb=2000.0,
        check_method="ping",
        check_target="-",
        discovery_source="arp",
        discovery_sources=["arp"],
        discovered_at=None,
        notes="",
        rack=None,
        zone_label="Homelab",
        connections=["switch-01"],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _body(device, *, today=None) -> str:
    return t.render_device_document(device, today=today or date(2026, 3, 4))


def _run(current_dev, device, *, baseline=None, snapshot=None, resolutions=None):
    """Reconcile the document generated for current_dev against the live device."""
    if baseline is None:
        baseline = _body(current_dev)
    if snapshot is None:
        snapshot = t.facts_snapshot(current_dev)
    return reconcile(
        current=_body(current_dev),
        new=_body(device),
        baseline_body=baseline,
        snapshot=snapshot,
        resolutions=resolutions,
    )


def _by_id(changes):
    return {c.id: c for c in changes}


def _after(body, marker):
    """Everything from the marker line to the end."""
    start = body.find(marker)
    return body[start:] if start >= 0 else ""


# ── no change ───────────────────────────────────────────────────────────────


def test_stable_device_is_a_noop():
    result = _run(_device(), _device())
    assert all(c.status == SAME for c in result.changes)
    assert result.conflicts == []
    assert result.summary == []
    assert result.proposed_body == _body(_device())


# ── safe auto-updates ───────────────────────────────────────────────────────


def test_untouched_ip_is_applied_automatically():
    result = _run(_device(), _device(ip="192.168.10.25"))
    by_id = _by_id(result.changes)

    assert by_id["device-info.IP"].status == AUTO
    ip = by_id["device-info.IP"]
    assert "IP address updated to 192.168.10.25" in result.summary
    assert ip.previous == "192.168.10.20"

    assert by_id["device-info.Hostname"].status == SAME
    assert by_id["device-info.Hostname"].documented == "homelabcluster.example.lan"
    assert not result.conflicts

    assert "| IP | 192.168.10.25 |" in result.proposed_body
    # The service URL follows the IP, and is applied just as silently.
    assert "https://192.168.10.25" in result.proposed_body
    # User-owned sections come through byte for byte.
    assert _after(result.proposed_body, "## Configuration") == _after(_body(_device()), "## Configuration")


def test_device_info_ip_update_preserves_table_layout_and_empty_cells():
    """A device-only update must not re-render its user's table."""
    baseline = _body(_device())
    current = (
        baseline.replace("| | |\n|---|---|", "| Field | Value |\n|:------|-----:|")
        .replace("| IP | 192.168.10.20 |", "| IP     | 192.168.10.20     |")
        .replace("| OS | Debian 12 |", "| OS | |")
        .replace("| Status check | `ping` → `-` |", "| Status check | `ping` → `-` |\n\n_table note_")
    )
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )

    expected = current.replace("192.168.10.20", "192.168.10.25", 1)
    assert _after(result.proposed_body, "## Device Information").split("### Hardware", 1)[0] == (
        _after(expected, "## Device Information").split("### Hardware", 1)[0]
    )
    assert "| Field | Value |\n|:------|-----:|" in result.proposed_body
    assert "| OS | |" in result.proposed_body


def test_deleted_os_row_stays_absent_until_device_restore_is_approved():
    baseline = _body(_device())
    current = baseline.replace("| OS | Debian 12 |\n", "")

    unchanged = reconcile(
        current, baseline, baseline_body=baseline, snapshot=t.facts_snapshot(_device())
    )
    assert _by_id(unchanged.changes)["device-info.OS"].status == SAME
    assert unchanged.proposed_body == current

    changed = reconcile(
        current,
        _body(_device(os="Debian 13")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert _by_id(changed.changes)["device-info.OS"].status == "conflict"
    assert changed.proposed_body == current

    restored = reconcile(
        current,
        _body(_device(os="Debian 13")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="device-info.OS", choice=DEVICE)],
    )
    assert "| OS | Debian 13 |" in restored.proposed_body


def test_user_edit_is_kept_when_device_unchanged():
    current = _body(_device()).replace("| OS | Debian 12 |", "| OS | Debian 12 (tuned) |")
    snapshot = t.facts_snapshot(_device())
    result = reconcile(current, _body(_device()), baseline_body=_body(_device()), snapshot=snapshot)
    by_id = _by_id(result.changes)

    assert by_id["device-info.OS"].status == SAME
    assert "Debian 12 (tuned)" in result.proposed_body
    assert not result.conflicts


def test_identical_change_never_conflicts():
    # The user wrote the device's *new* value before the sync.
    current = _body(_device()).replace("| IP | 192.168.10.20 |", "| IP | 192.168.10.25 |")
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device()), snapshot=t.facts_snapshot(_device()))
    assert result.conflicts == []
    assert _by_id(result.changes)["device-info.IP"].status == SAME
    assert "| IP | 192.168.10.25 |" in result.proposed_body
    assert _after(result.proposed_body, "## Configuration") == _after(current, "## Configuration")


# ── conflicts and resolutions ───────────────────────────────────────────────


def test_both_sides_changed_is_a_conflict():
    current = _body(_device()).replace("| IP | 192.168.10.20 |", "| IP | 10.0.0.9 |")
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device()), snapshot=t.facts_snapshot(_device()))
    by_id = _by_id(result.changes)
    assert by_id["device-info.IP"].status == "conflict"
    assert [c.id for c in result.conflicts] == ["device-info.IP"]
    # Undecided conflicts keep the user's text in the draft.
    assert "| IP | 10.0.0.9 |" in result.proposed_body


def test_keep_resolution_keeps_user_text():
    current = _body(_device()).replace("| IP | 192.168.10.20 |", "| IP | 10.0.0.9 |")
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device()), snapshot=t.facts_snapshot(_device()), resolutions=[Resolution(id="device-info.IP", choice=KEEP)])
    assert "| IP | 10.0.0.9 |" in result.proposed_body
    assert "IP address kept as written" in result.summary
    assert result.unresolved == []


def test_device_resolution_takes_device_value():
    current = _body(_device()).replace("| IP | 192.168.10.20 |", "| IP | 10.0.0.9 |")
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device()), snapshot=t.facts_snapshot(_device()), resolutions=[Resolution(id="device-info.IP", choice=DEVICE)])
    assert "| IP | 192.168.10.25 |" in result.proposed_body


def test_escaped_pipe_ip_row_keeps_its_shape_for_device_and_custom_resolution():
    baseline = _body(_device())
    current = baseline.replace(
        "| IP | 192.168.10.20 |", "| IP   | nas.example \\| backup  |"
    )
    new = _body(_device(ip="192.168.10.25"))

    device = reconcile(
        current,
        new,
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="device-info.IP", choice=DEVICE)],
    )
    assert "| IP   | 192.168.10.25  |" in device.proposed_body

    custom = reconcile(
        current,
        new,
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="device-info.IP", choice=CUSTOM, custom="manual | route")],
    )
    assert "| IP   | manual \\| route  |" in custom.proposed_body


def test_custom_resolution_uses_user_text_and_escapes_it():
    current = _body(_device()).replace("| IP | 192.168.10.20 |", "| IP | 10.0.0.9 |")
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device()), snapshot=t.facts_snapshot(_device()), resolutions=[Resolution(id="device-info.IP", choice=CUSTOM, custom="10.0.0.9 (jump host)")])
    assert "| IP | 10.0.0.9 (jump host) |" in result.proposed_body
    assert "IP address set from your text" in result.summary


# ── the regression scenario from the issue ──────────────────────────────────


def test_hostname_change_suppresses_repeat_ip_notice():
    """Device hostname lands *once*; the untouched IP is not re-asked."""
    snapshot = t.facts_snapshot(_device(ip="192.168.10.20", hostname="old.example.lan"))
    baseline = _body(_device(ip="192.168.10.20", hostname="old.example.lan"))
    current = baseline  # generated at that time, untouched since
    result = reconcile(current, _body(_device(ip="192.168.10.25", hostname="homelabcluster.example.lan")), baseline_body=baseline, snapshot=snapshot)
    by_id = _by_id(result.changes)

    assert by_id["device-info.Hostname"].status == AUTO
    assert by_id["device-info.IP"].status == AUTO  # safe: never touched
    assert [c.id for c in result.conflicts] == []


def test_keeping_a_new_ip_acknowledges_it_once_and_warns_again_on_next_change():
    """A KEEP records the *device's* value as baseline, so the next device change
    asks again — acknowledgement is not permanent blindness."""
    # The doc carries a deliberate user value, so a device IP move is a conflict.
    current = _body(_device(ip="192.168.10.20")).replace("| IP | 192.168.10.20 |", "| IP | 192.168.10.20 (primary) |")
    baseline = _body(_device(ip="192.168.10.20"))
    snapshot = t.facts_snapshot(_device(ip="192.168.10.20"))

    # Device moved to .25, the user keeps their own entry.
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="device-info.IP", choice=KEEP)])
    assert result.unresolved == []
    merged = result.proposed_body
    assert "| IP | 192.168.10.20 (primary) |" in merged

    # Nothing changed since: no repeat warning.
    steady = reconcile(merged, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device(ip="192.168.10.25")), snapshot=t.facts_snapshot(_device(ip="192.168.10.25")))
    assert steady.conflicts == []
    assert "| IP | 192.168.10.20 (primary) |" in steady.proposed_body

    # The device moves again → the kept value is in question once more.
    later = reconcile(merged, _body(_device(ip="192.168.10.30")), baseline_body=_body(_device(ip="192.168.10.25")), snapshot=t.facts_snapshot(_device(ip="192.168.10.25")))
    assert [c.id for c in later.conflicts] == ["device-info.IP"]


# ── whole sections ──────────────────────────────────────────────────────────


def test_untouched_hardware_section_is_replaced_wholesale():
    result = _run(_device(), _device(cpu_model="N200"))
    by_id = _by_id(result.changes)
    assert by_id["section.Hardware"].status == AUTO
    assert "N200" in result.proposed_body
    assert _after(result.proposed_body, "## Configuration") == _after(_body(_device()), "## Configuration")


def test_section_conflict_resolves_three_ways():
    current = _body(_device()).replace(
        "| CPU | RAM | Disk |",
        "| CPU | RAM | Disk |\n|---|---|---|\n| manual | row | here |",
    )
    baseline = _body(_device())
    snapshot = t.facts_snapshot(_device())
    new = _body(_device(cpu_model="N200"))

    keep = reconcile(current, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="section.Hardware", choice=KEEP)])
    assert "| manual | row | here |" in keep.proposed_body

    take = reconcile(current, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="section.Hardware", choice=DEVICE)])
    assert "| manual | row | here |" not in take.proposed_body
    assert "N200" in take.proposed_body

    custom = reconcile(current, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="section.Hardware", choice=CUSTOM, custom="| A | B | C |")])
    assert "| A | B | C |" in custom.proposed_body


def test_custom_section_text_never_collides_with_internal_actions():
    baseline = _body(_device())
    current = baseline.replace("| CPU | RAM | Disk |", "manual hardware notes")
    new = _body(_device(cpu_model="N200"))

    for custom in ("remove", "skip"):
        result = reconcile(
            current,
            new,
            baseline_body=baseline,
            snapshot=t.facts_snapshot(_device()),
            resolutions=[Resolution(id="section.Hardware", choice=CUSTOM, custom=custom)],
        )
        section = _after(result.proposed_body, "### Hardware").split("### Properties", 1)[0]
        assert custom in section
        assert "N200" not in section

    empty = reconcile(
        current,
        new,
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="section.Hardware", choice=CUSTOM, custom="")],
    )
    section = _after(empty.proposed_body, "### Hardware").split("### Properties", 1)[0]
    assert section.strip() == "### Hardware"


def test_user_sections_never_touched():
    current = _body(_device())
    edited = current.replace("## Notes", "## Notes\n\n_Every byte here is the user's._")
    result = reconcile(
        edited,
        _body(_device(ip="192.168.10.25", cpu_model="N200")),
        baseline_body=current,
        snapshot=t.facts_snapshot(_device()),
    )
    tail = _after(edited, "## Notes")
    assert _after(result.proposed_body, "## Notes") == tail
    assert "## Operations" in result.proposed_body and "### Backup" in result.proposed_body


def test_unknown_baseline_never_recreates_deleted_device_info_table():
    """Legacy documents need an explicit review before restoring a missing table."""
    generated = _body(_device())
    start = generated.index("## Device Information")
    end = generated.index("### Hardware")
    current = generated[:start] + generated[end:]

    preview = reconcile(current, generated, baseline_body=None, snapshot=None)
    table_change = _by_id(preview.changes)["device-info"]
    assert table_change.status == "conflict"
    assert preview.unresolved == [table_change]
    assert "## Device Information" not in preview.proposed_body

    reviewed = reconcile(
        current,
        generated,
        baseline_body=None,
        snapshot=None,
        resolutions=[Resolution(id="device-info", choice=DEVICE)],
    )
    assert "## Device Information" in reviewed.proposed_body


# ── ambiguous duplicates ────────────────────────────────────────────────


def test_duplicate_ip_row_no_device_change_preserves_both():
    baseline = _body(_device())
    current = baseline.replace(
        "| IP | 192.168.10.20 |",
        "| IP | 192.168.10.20 |\n| IP | manual-secondary |",
    )
    result = reconcile(
        current,
        _body(_device()),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert result.conflicts == []
    assert result.proposed_body.count("| IP |") == 2
    assert "| IP | 192.168.10.20 |" in result.proposed_body
    assert "| IP | manual-secondary |" in result.proposed_body


def test_duplicate_ip_row_prepended_no_device_change_preserves_both():
    baseline = _body(_device())
    current = baseline.replace(
        "| IP | 192.168.10.20 |",
        "| IP | manual-first |\n| IP | 192.168.10.20 |",
    )
    result = reconcile(
        current,
        _body(_device()),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert result.conflicts == []
    assert result.proposed_body.count("| IP |") == 2
    assert "| IP | manual-first |" in result.proposed_body
    assert "| IP | 192.168.10.20 |" in result.proposed_body


def test_duplicate_ip_row_device_change_surfaces_conflict():
    baseline = _body(_device())
    current = baseline.replace(
        "| IP | 192.168.10.20 |",
        "| IP | 192.168.10.20 |\n| IP | manual-secondary |",
    )
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert "device-info.IP" in [c.id for c in result.conflicts]
    # Neither row is touched silently; both are preserved verbatim.
    info_rows = [line for line in result.proposed_body.splitlines() if line.startswith("| IP |")]
    assert info_rows == ["| IP | 192.168.10.20 |", "| IP | manual-secondary |"]


def test_duplicate_ip_row_device_resolution_updates_first_only():
    baseline = _body(_device())
    current = baseline.replace(
        "| IP | 192.168.10.20 |",
        "| IP | 192.168.10.20 |\n| IP | manual-secondary |",
    )
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="device-info.IP", choice=DEVICE)],
    )
    rows = [line for line in result.proposed_body.splitlines() if line.startswith("| IP |")]
    assert rows == ["| IP | 192.168.10.25 |", "| IP | manual-secondary |"]


def test_duplicate_hardware_no_device_change_preserves_both():
    baseline = _body(_device())
    current = baseline + "\n### Hardware\n\nMANUAL DISK RECOVERY PROCEDURE\n"
    result = reconcile(
        current,
        _body(_device()),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert result.conflicts == []
    assert result.proposed_body.count("### Hardware") == 2
    assert "MANUAL DISK RECOVERY PROCEDURE" in result.proposed_body


def test_duplicate_hardware_prepended_no_device_change_preserves_both():
    baseline = _body(_device())
    hw_offset = baseline.index("### Hardware")
    current = (
        baseline[:hw_offset]
        + "### Hardware\n\nMANUAL DISK RECOVERY PROCEDURE\n\n"
        + baseline[hw_offset:]
    )
    result = reconcile(
        current,
        _body(_device()),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert result.conflicts == []
    assert result.proposed_body.count("### Hardware") == 2
    assert "MANUAL DISK RECOVERY PROCEDURE" in result.proposed_body


def test_duplicate_hardware_device_change_surfaces_conflict():
    baseline = _body(_device())
    current = baseline + "\n### Hardware\n\nMANUAL DISK RECOVERY PROCEDURE\n"
    result = reconcile(
        current,
        _body(_device(cpu_model="N200")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert "section.Hardware" in [c.id for c in result.conflicts]
    # No auto-edit to the guessed-first block; both are preserved untouched.
    assert "MANUAL DISK RECOVERY PROCEDURE" in result.proposed_body
    assert "N200" not in result.proposed_body


def test_duplicate_hardware_resolution_updates_generated_block_only():
    baseline = _body(_device())
    current = baseline + "\n### Hardware\n\nMANUAL DISK RECOVERY PROCEDURE\n"
    result = reconcile(
        current,
        _body(_device(cpu_model="N200")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="section.Hardware", choice=DEVICE)],
    )
    assert result.proposed_body.count("### Hardware") == 2
    assert "N200" in result.proposed_body
    assert "MANUAL DISK RECOVERY PROCEDURE" in result.proposed_body


def test_duplicate_hardware_custom_resolution_updates_generated_block_only():
    baseline = _body(_device())
    current = baseline + "\n### Hardware\n\nMANUAL DISK RECOVERY PROCEDURE\n"
    result = reconcile(
        current,
        _body(_device(cpu_model="N200")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="section.Hardware", choice=CUSTOM, custom="| A | B | C |")],
    )
    assert result.proposed_body.count("### Hardware") == 2
    assert "| A | B | C |" in result.proposed_body
    assert "MANUAL DISK RECOVERY PROCEDURE" in result.proposed_body


def test_duplicate_hardware_prepended_device_change_surfaces_conflict():
    baseline = _body(_device())
    hw_offset = baseline.index("### Hardware")
    current = (
        baseline[:hw_offset]
        + "### Hardware\n\nMANUAL DISK RECOVERY PROCEDURE\n\n"
        + baseline[hw_offset:]
    )
    result = reconcile(
        current,
        _body(_device(cpu_model="N200")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert "section.Hardware" in [c.id for c in result.conflicts]
    assert "N200" not in result.proposed_body
    assert "MANUAL DISK RECOVERY PROCEDURE" in result.proposed_body


def _duplicate_device_info(current, manual_os=None):
    """Duplicate the whole generated Device Information block in the body.

    The copy goes BEFORE the original; ``manual_os`` marks it as the user's own
    table so a fix that edits the guessed-first copy on its own is testable.
    """
    heading = "## Device Information"
    start = current.index(heading)
    end = current.index("### Hardware")
    info_block = current[start:end]
    if manual_os is not None:
        info_block = info_block.replace("| OS | Debian 12 |", f"| OS | {manual_os} |")
    return current[:start] + info_block + info_block + current[end:]


def test_duplicate_device_info_heading_ip_change_surfaces_conflict():
    baseline = _body(_device())
    current = _duplicate_device_info(baseline)
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert "device-info.IP" in [c.id for c in result.conflicts]
    # No silent auto-edit of the guessed-first table; both keep their value.
    assert result.proposed_body.count("## Device Information") == 2
    assert result.proposed_body.count("| IP | 192.168.10.20 |") == 2
    assert "| IP | 192.168.10.25 |" not in result.proposed_body


def test_duplicate_device_info_heading_ip_resolution_updates_first_only():
    baseline = _body(_device())
    current = _duplicate_device_info(baseline)
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
        resolutions=[Resolution(id="device-info.IP", choice=KEEP)],
    )
    assert result.proposed_body.count("## Device Information") == 2
    assert result.proposed_body.count("| IP | 192.168.10.20 |") == 2


def test_duplicate_device_info_prepended_ip_change_surfaces_conflict():
    baseline = _body(_device())
    current = _duplicate_device_info(baseline, manual_os="Debian 12 (manual)")
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device()),
    )
    assert "device-info.IP" in [c.id for c in result.conflicts]
    assert result.proposed_body.count("## Device Information") == 2
    # The user-owned copy is the first one; it must not be silently edited.
    assert "| OS | Debian 12 (manual) |" in result.proposed_body
    assert "| IP | 192.168.10.25 |" not in result.proposed_body


# ── device name ─────────────────────────────────────────────────────────


def test_device_name_auto_and_conflict():
    baseline = _body(_device(label="nas-01"))
    snapshot = t.facts_snapshot(_device(label="nas-01"))
    new = _body(_device(label="nas-02"))
    current = baseline

    auto = reconcile(current, new, baseline_body=baseline, snapshot=snapshot)
    assert _by_id(auto.changes)["name"].status == AUTO
    assert 'title: "nas-02"' in auto.proposed_body
    assert "# nas-02\n" in auto.proposed_body

    renamed = current.replace("# nas-01", "# my-nas")
    conflict = reconcile(renamed, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="name", choice=KEEP)])
    assert _by_id(conflict.changes)["name"].status == "conflict"
    assert "# my-nas" in conflict.proposed_body and "# nas-02" not in conflict.proposed_body


def test_ordinary_rename_follows_in_h1_and_title():
    baseline = _body(_device(label="nas-01"))
    result = reconcile(
        baseline,
        _body(_device(label="nas-02")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device(label="nas-01")),
    )
    by_id = _by_id(result.changes)
    assert by_id["name"].status == AUTO
    assert by_id["title"].status == AUTO
    assert 'title: "nas-02"' in result.proposed_body
    assert "# nas-02\n" in result.proposed_body


def test_independently_edited_title_survives_device_rename():
    """Finding 3: a manual frontmatter title must not be copied from the H1
    decision; the untouched H1 may follow the device while the manual title
    stays, surfaced as an explicit title conflict."""
    baseline = _body(_device(label="homelabcluster"))
    current = baseline.replace("title: homelabcluster", "title: Recovery Runbook")
    result = reconcile(
        current,
        _body(_device(label="new-name")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device(label="homelabcluster")),
    )
    by_id = _by_id(result.changes)
    # The untouched H1 follows the rename, the manual title does not.
    assert by_id["name"].status == AUTO
    assert by_id["title"].status == "conflict"
    assert "title" in [c.id for c in result.conflicts]
    assert "title: Recovery Runbook" in result.proposed_body
    assert "title: new-name" not in result.proposed_body
    assert "# new-name\n" in result.proposed_body


def test_title_conflict_resolves_keep_and_device():
    baseline = _body(_device(label="homelabcluster"))
    current = baseline.replace("title: homelabcluster", "title: Recovery Runbook")
    new = _body(_device(label="new-name"))
    snapshot = t.facts_snapshot(_device(label="homelabcluster"))

    keep = reconcile(current, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="title", choice=KEEP)])
    assert "title: Recovery Runbook" in keep.proposed_body

    take = reconcile(current, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="title", choice=DEVICE)])
    assert 'title: "new-name"' in take.proposed_body


def test_custom_title_with_yaml_syntax_is_serialized_semantically():
    baseline = _body(_device(label="homelabcluster"))
    current = baseline.replace(
        "title: homelabcluster", "title: Recovery Runbook\ncustom_frontmatter: 'keep: exact'"
    )
    new = _body(_device(label="new-name"))

    for title in ("Recovery: primary", "Recovery #1"):
        result = reconcile(
            current,
            new,
            baseline_body=baseline,
            snapshot=t.facts_snapshot(_device(label="homelabcluster")),
            resolutions=[Resolution(id="title", choice=CUSTOM, custom=title)],
        )
        frontmatter = result.proposed_body.split("---", 2)[1]
        assert yaml.safe_load(frontmatter)["title"] == title
        assert "custom_frontmatter: 'keep: exact'" in frontmatter


def test_title_scalar_replacement_removes_continuation_and_keep_preserves_frontmatter():
    baseline = _body(_device(label="homelabcluster"))
    current = baseline.replace(
        "title: homelabcluster",
        "title: |\n  Recovery Runbook\ncustom_frontmatter: 'keep: exact'",
    )
    new = _body(_device(label="new-name"))
    snapshot = t.facts_snapshot(_device(label="homelabcluster"))

    device = reconcile(
        current,
        new,
        baseline_body=baseline,
        snapshot=snapshot,
        resolutions=[Resolution(id="title", choice=DEVICE)],
    )
    frontmatter = device.proposed_body.split("---", 2)[1]
    assert yaml.safe_load(frontmatter)["title"] == "new-name"
    assert "Recovery Runbook" not in frontmatter
    assert "custom_frontmatter: 'keep: exact'" in frontmatter

    kept = reconcile(
        current,
        new,
        baseline_body=baseline,
        snapshot=snapshot,
        resolutions=[Resolution(id="title", choice=KEEP)],
    )
    assert kept.proposed_body.split("---", 2)[1] == current.split("---", 2)[1]


def test_title_replacement_removes_multiline_quoted_scalar():
    baseline = _body(_device(label="homelabcluster"))
    current = baseline.replace(
        "title: homelabcluster",
        'title: "Recovery\n  Runbook"\ncustom_frontmatter: \'keep: exact\'',
    )
    result = reconcile(
        current,
        _body(_device(label="new-name")),
        baseline_body=baseline,
        snapshot=t.facts_snapshot(_device(label="homelabcluster")),
        resolutions=[Resolution(id="title", choice=DEVICE)],
    )
    frontmatter = result.proposed_body.split("---", 2)[1]
    assert yaml.safe_load(frontmatter)["title"] == "new-name"
    assert "Recovery" not in frontmatter and "Runbook" not in frontmatter
    assert "custom_frontmatter: 'keep: exact'" in frontmatter


def test_new_properties_section_is_added_before_user_sections():
    plain = _device(properties=[])
    result = _run(plain, _device(properties=[{"key": "Serial", "value": "ABC123"}]))
    assert _by_id(result.changes)["section.Properties"].status == AUTO
    lines = result.proposed_body.splitlines()
    props_index = lines.index("### Properties")
    config_index = lines.index("## Configuration")
    assert props_index < config_index
    assert "| Serial | ABC123 |" in result.proposed_body


def test_unknown_history_never_recreates_deleted_generated_sections():
    generated = _body(_device())
    sections = (
        ("Hardware", "### Hardware", "### Properties"),
        ("Properties", "### Properties", "## Services"),
        ("Services", "## Services", "## Network"),
        ("Network", "## Network", "## Configuration"),
    )

    for name, heading, next_heading in sections:
        start = generated.index(heading)
        end = generated.index(next_heading, start)
        current = generated[:start] + generated[end:]
        result = reconcile(current, generated, baseline_body=None, snapshot=None)

        assert _by_id(result.changes)[f"section.{name}"].status == "conflict"
        assert heading not in result.proposed_body


def test_complete_baseline_can_add_a_new_generated_section():
    generated = _body(_device())
    start = generated.index("### Properties")
    end = generated.index("## Services", start)
    baseline = generated[:start] + generated[end:]
    result = reconcile(baseline, generated, baseline_body=baseline, snapshot=None)

    assert _by_id(result.changes)["section.Properties"].status == AUTO
    assert "### Properties" in result.proposed_body


def test_snapshot_proves_a_new_properties_section_can_be_added():
    generated = _body(_device())
    start = generated.index("### Properties")
    end = generated.index("## Services", start)
    current = generated[:start] + generated[end:]
    result = reconcile(
        current,
        generated,
        baseline_body=None,
        snapshot=t.facts_snapshot(_device(properties=[])),
    )

    assert _by_id(result.changes)["section.Properties"].status == AUTO
    assert "### Properties" in result.proposed_body


def test_snapshot_does_not_restore_deleted_services_without_a_baseline():
    generated = _body(_device())
    start = generated.index("## Services")
    end = generated.index("## Network", start)
    current = generated[:start] + generated[end:]
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=None,
        snapshot=t.facts_snapshot(_device()),
    )

    assert _by_id(result.changes)["section.Services"].status == "conflict"
    assert "## Services" not in result.proposed_body


def test_snapshot_does_not_restore_deleted_network_without_a_baseline():
    generated = _body(_device())
    start = generated.index("## Network")
    end = generated.index("## Configuration", start)
    current = generated[:start] + generated[end:]
    result = reconcile(
        current,
        _body(_device(ip="192.168.10.25")),
        baseline_body=None,
        snapshot=t.facts_snapshot(_device()),
    )

    assert _by_id(result.changes)["section.Network"].status == "conflict"
    assert "## Network" not in result.proposed_body


def test_untouched_removed_properties_are_dropped_automatically():
    # The complete baseline proves the section was device-owned and untouched.
    baseline = _body(_device())
    current = _body(_device())
    new = _body(_device(properties=[]))
    result = reconcile(current, new, baseline_body=baseline, snapshot=t.facts_snapshot(_device()))
    assert _by_id(result.changes)["section.Properties"].status == AUTO
    assert "### Properties" not in result.proposed_body


def test_edited_removed_properties_require_a_decision():
    baseline = _body(_device())
    current = baseline.replace("| Serial | ABC123 |", "| Serial | manual recovery token |")
    new = _body(_device(properties=[]))
    result = reconcile(current, new, baseline_body=baseline, snapshot=t.facts_snapshot(_device()))

    assert _by_id(result.changes)["section.Properties"].status == "conflict"
    assert "### Properties" in result.proposed_body
    assert "manual recovery token" in result.proposed_body


# ── conservatism and fingerprints ───────────────────────────────────────────


def test_missing_baseline_is_conservative_never_silent():
    """No baseline and no snapshot: a changed device still surfaces conflicts."""
    current = _body(_device())
    result = reconcile(current, _body(_device(ip="192.168.10.25")), baseline_body=None, snapshot=None)
    by_id = _by_id(result.changes)
    assert by_id["device-info.IP"].status == "conflict"
    # A stable device without a baseline is still quiet.
    stable = reconcile(current, _body(_device()), baseline_body=None, snapshot=None)
    assert stable.conflicts == []
    assert stable.proposed_body == current


def test_preview_id_binds_body_facts_and_timestamp():
    a = preview_id("2026-03-04T10:00:00Z", {"ip": "192.168.10.20"}, "# body")
    assert a == preview_id("2026-03-04T10:00:00Z", {"ip": "192.168.10.20"}, "# body")
    assert a != preview_id("2026-03-04T10:00:01Z", {"ip": "192.168.10.20"}, "# body")
    assert a != preview_id("2026-03-04T10:00:00Z", {"ip": "192.168.10.25"}, "# body")
    assert a != preview_id("2026-03-04T10:00:00Z", {"ip": "192.168.10.20"}, "# other")


def test_preview_id_binds_baseline_and_live_device():
    base = preview_id("2026-03-04T10:00:00Z", {"ip": "192.168.10.20"}, "# body")
    baseline = preview_id(
        "2026-03-04T10:00:00Z", {"ip": "192.168.10.20"}, "# body", baseline_body="# generated"
    )
    live = preview_id(
        "2026-03-04T10:00:00Z",
        {"ip": "192.168.10.20"},
        "# body",
        baseline_body="# generated",
        live={"facts": {"ip": "192.168.10.30"}, "context": {"zone_label": "lan"}, "generated": "# …"},
    )
    assert base != baseline
    assert baseline != live
    # A device that moved on between preview and apply changes the id.
    assert live != preview_id(
        "2026-03-04T10:00:00Z",
        {"ip": "192.168.10.20"},
        "# body",
        baseline_body="# generated",
        live={"facts": {"ip": "192.168.10.40"}, "context": {"zone_label": "lan"}, "generated": "# …"},
    )
    # A rendered-only change — same facts and context, different generated body.
    assert live != preview_id(
        "2026-03-04T10:00:00Z",
        {"ip": "192.168.10.20"},
        "# body",
        baseline_body="# generated",
        live={
            "facts": {"ip": "192.168.10.30"},
            "context": {"zone_label": "lan"},
            "generated": "# changed rendering",
        },
    )
    # Same device, context and generated body keep it stable.
    assert live == preview_id(
        "2026-03-04T10:00:00Z",
        {"ip": "192.168.10.20"},
        "# body",
        baseline_body="# generated",
        live={"facts": {"ip": "192.168.10.30"}, "context": {"zone_label": "lan"}, "generated": "# …"},
    )


def test_document_drift_clears_after_apply_style_refresh():
    """After applying, regenerating the document from the *new* snapshot stays quiet."""
    baseline = _body(_device())
    snapshot = t.facts_snapshot(_device())
    result = reconcile(baseline, _body(_device(ip="192.168.10.25")), baseline_body=baseline, snapshot=snapshot)
    merged = result.proposed_body
    # What a successful sync records: merged body + generated body + new facts.
    refreshed = reconcile(merged, _body(_device(ip="192.168.10.25")), baseline_body=_body(_device(ip="192.168.10.25")), snapshot=t.facts_snapshot(_device(ip="192.168.10.25")))
    assert refreshed.conflicts == []
    assert refreshed.proposed_body == merged
