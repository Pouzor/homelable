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


def test_device_name_auto_and_conflict():
    baseline = _body(_device(label="nas-01"))
    snapshot = t.facts_snapshot(_device(label="nas-01"))
    new = _body(_device(label="nas-02"))
    current = baseline

    auto = reconcile(current, new, baseline_body=baseline, snapshot=snapshot)
    assert _by_id(auto.changes)["name"].status == AUTO
    assert "title: nas-02" in auto.proposed_body
    assert "# nas-02\n" in auto.proposed_body

    renamed = current.replace("# nas-01", "# my-nas")
    conflict = reconcile(renamed, new, baseline_body=baseline, snapshot=snapshot, resolutions=[Resolution(id="name", choice=KEEP)])
    assert _by_id(conflict.changes)["name"].status == "conflict"
    assert "# my-nas" in conflict.proposed_body and "# nas-02" not in conflict.proposed_body


def test_new_properties_section_is_added_before_user_sections():
    plain = _device(properties=[])
    result = _run(plain, _device(properties=[{"key": "Serial", "value": "ABC123"}]))
    assert _by_id(result.changes)["section.Properties"].status == AUTO
    lines = result.proposed_body.splitlines()
    props_index = lines.index("### Properties")
    config_index = lines.index("## Configuration")
    assert props_index < config_index
    assert "| Serial | ABC123 |" in result.proposed_body


def test_removed_properties_need_a_decision_and_can_be_dropped():
    # Device still carries them in the snapshot; the live row dropped its props.
    baseline = _body(_device())
    current = _body(_device())
    new = _body(_device(properties=[]))
    result = reconcile(current, new, baseline_body=baseline, snapshot=t.facts_snapshot(_device()))
    assert _by_id(result.changes)["section.Properties"].status == "conflict"
    # Undecided → draft keeps the section.
    assert "### Properties" in result.proposed_body
    dropped = reconcile(current, new, baseline_body=baseline, snapshot=t.facts_snapshot(_device()), resolutions=[Resolution(id="section.Properties", choice=DEVICE)])
    assert "### Properties" not in dropped.proposed_body


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