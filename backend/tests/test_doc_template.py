"""The generated skeleton. Written once, then owned by the user — so what it
emits on day one is the whole contract."""

from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.services import doc_template as t


def _device(**overrides):
    base = dict(
        id="dev-1",
        label="nas-01",
        friendly_name=None,
        hostname="nas-01.lan",
        ip="192.168.1.20",
        mac="00:11:32:aa:bb:cc",
        ieee_address=None,
        os="DSM 7.2",
        vendor="Synology",
        model="DS920+",
        type="nas",
        suggested_type=None,
        services=[
            {"port": 5000, "protocol": "tcp", "service_name": "Synology DSM", "category": "management"},
            {"port": 445, "protocol": "tcp", "service_name": "SMB"},
        ],
        properties=[{"key": "serial", "value": "20C0PDN", "icon": None, "visible": True}],
        cpu_count=4,
        cpu_model="Intel Celeron J4125",
        ram_gb=20.0,
        disk_gb=32000.0,
        check_method="http",
        check_target="http://192.168.1.20:5000",
        discovery_source="arp",
        discovery_sources=["arp", "mdns"],
        discovered_at=datetime(2026, 3, 4, tzinfo=timezone.utc),
        notes="",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# ── cells and names ─────────────────────────────────────────────────────────


def test_cell_escapes_pipes_and_collapses_newlines():
    assert t.cell("a|b") == r"a\|b"
    assert t.cell("one\ntwo") == "one two"
    assert t.cell(None) == "—"
    assert t.cell("") == "—"


def test_cell_escapes_backslash_before_pipe():
    # Backslash first, or the escape of the pipe would itself be escaped.
    assert t.cell(r"a\|b") == r"a\\\|b"


def test_device_name_falls_back_through_label_hostname_ip():
    assert t.device_name(_device()) == "nas-01"
    assert t.device_name(_device(label=None)) == "nas-01.lan"
    assert t.device_name(_device(label=None, hostname=None)) == "192.168.1.20"
    assert t.device_name(_device(label=None, hostname=None, ip=None)) == "device"


def test_device_type_prefers_curated_over_guessed():
    assert t.device_type(_device(type="nas", suggested_type="server")) == "nas"
    assert t.device_type(_device(type=None, suggested_type="server")) == "server"


# ── blocks ──────────────────────────────────────────────────────────────────


def test_device_info_block_reads_every_address():
    md = t.block_device_info(_device())
    assert "| Hostname | nas-01.lan |" in md
    assert "| IP | 192.168.1.20 |" in md
    assert "| Vendor / Model | Synology / DS920+ |" in md
    assert "`http` → `http://192.168.1.20:5000`" in md
    assert "(arp, mdns)" in md


def test_device_info_block_prints_dashes_for_missing_facts():
    md = t.block_device_info(_device(hostname=None, mac=None, os=None, vendor=None, model=None))
    assert "| Hostname | — |" in md
    assert "| Vendor / Model | — |" in md


def test_hardware_block_joins_cpu_model_and_count():
    assert "Intel Celeron J4125 ×4" in t.block_hardware(_device())
    assert "20 GB" in t.block_hardware(_device())


def test_hardware_block_handles_a_count_without_a_model():
    assert "4 cores" in t.block_hardware(_device(cpu_model=None))


def test_services_block_writes_one_section_per_service():
    md = t.block_services(_device())
    assert "### Synology DSM — `5000/tcp`" in md
    assert "### SMB — `445/tcp`" in md
    assert "**Category** — management" in md
    # Prompts, not values — the user fills these in.
    assert md.count("**Purpose**") == 2


def test_services_block_says_so_when_nothing_was_fingerprinted():
    assert "No service" in t.block_services(_device(services=[]))


def test_services_block_never_invents_a_url_for_a_non_http_port():
    md = t.block_services(_device(services=[{"port": 445, "protocol": "tcp", "service_name": "SMB"}]))
    assert "**URL**" not in md


def test_services_block_builds_an_http_url_from_the_device_ip():
    assert "<http://192.168.1.20:5000>" in t.block_services(_device())


def test_properties_block_is_empty_when_the_device_has_none():
    assert t.block_properties(_device(properties=[])) == ""
    assert "| serial | 20C0PDN |" in t.block_properties(_device())


def test_rack_block_prints_the_span_of_units():
    md = t.block_rack(_device(), rack={"name": "Rack-A", "u_start": 12, "u_height": 3, "col_span": 12})
    assert md == "Rack **Rack-A**, U12–U14, full width."


def test_rack_block_collapses_a_single_unit():
    md = t.block_rack(_device(), rack={"name": "Rack-A", "u_start": 7, "u_height": 1, "col_span": 6})
    assert "U7," in md and "–" not in md
    assert "6/12 wide" in md


def test_rack_block_is_empty_when_the_device_is_neither_racked_nor_zoned():
    assert t.block_rack(_device()) == ""
    assert t.block_rack(_device(), zone_label="Garage") == "Zone **Garage**."


def test_network_block_guesses_the_slash_24_and_lists_peers():
    md = t.block_network(_device(), connections=["switch-core", "router"])
    assert "192.168.1.0/24" in md
    assert "`switch-core`, `router`" in md


def test_network_block_takes_the_first_ip_of_a_multi_ip_device():
    assert "10.0.0.0/24" in t.block_network(_device(ip="10.0.0.5, 192.168.1.20"))


def test_network_block_survives_a_device_with_no_ip():
    assert "**Subnet / VLAN** — _…_" in t.block_network(_device(ip=None))


def test_render_block_rejects_an_unknown_name():
    try:
        t.render_block("nope", _device())
    except ValueError as exc:
        assert "Unknown block" in str(exc)
    else:
        raise AssertionError("expected ValueError")


# ── the whole document ──────────────────────────────────────────────────────


def test_device_document_carries_every_section():
    md = t.render_device_document(_device(), today=date(2026, 9, 5))
    for heading in (
        "## Device Information",
        "### Hardware",
        "## Services",
        "## Network",
        "## Configuration",
        "## Operations",
        "## Troubleshooting",
        "## Dependencies",
        "## Changelog",
        "## Notes",
    ):
        assert heading in md, heading


def test_device_document_opens_with_versioned_frontmatter():
    md = t.render_device_document(_device(), today=date(2026, 9, 5))
    assert md.startswith("---\n")
    assert f"homelable: {t.FRONTMATTER_VERSION}" in md
    assert "device: dev-1" in md
    assert "created: 2026-09-05" in md
    assert "review_every: 6m" in md


def test_device_document_appends_old_notes_verbatim_with_provenance():
    notes = "Runs the backups.\n\n  Indented line kept as typed | with a pipe."
    md = t.render_device_document(_device(notes=notes), today=date(2026, 9, 5))
    assert "<!-- Migrated verbatim from this device's Notes field on 2026-09-05. -->" in md
    assert notes.strip() in md


def test_device_document_prompts_when_there_were_no_notes():
    md = t.render_device_document(_device(notes=""))
    assert "Migrated verbatim" not in md
    assert "_Anything worth remembering about this device._" in md


def test_device_document_drops_the_location_section_when_there_is_no_place():
    assert "### Physical location" not in t.render_device_document(_device())
    md = t.render_device_document(_device(), zone_label="Garage")
    assert "### Physical location" in md


def test_device_document_drops_the_properties_section_when_there_are_none():
    assert "### Properties" not in t.render_device_document(_device(properties=[]))


def test_device_document_of_a_bare_device_still_renders():
    bare = SimpleNamespace(id="d", label=None, notes=None)
    md = t.render_device_document(bare)
    assert "# device" in md
    assert "## Services" in md


# ── library templates ───────────────────────────────────────────────────────


def test_runbook_template_has_its_headings():
    md = t.render_library_document(t.TEMPLATE_RUNBOOK, "Reboot the NAS", today=date(2026, 9, 5))
    assert "# Reboot the NAS" in md
    assert "## Rollback" in md
    assert "template: runbook" in md


def test_blank_template_is_just_a_title():
    md = t.render_library_document(t.TEMPLATE_BLANK, "Scratch")
    assert "# Scratch" in md
    assert "##" not in md


def test_unknown_template_falls_back_to_blank_rather_than_failing():
    md = t.render_library_document("does-not-exist", "Scratch")
    assert "# Scratch" in md


def test_frontmatter_omits_empty_values():
    rendered = t.render_frontmatter({"a": 1, "b": None, "c": "", "d": [], "e": ["x", "y"]})
    assert rendered == "---\na: 1\ne: [x, y]\n---"


# ── the drift snapshot ──────────────────────────────────────────────────────


def test_facts_snapshot_keys_services_by_port_protocol_name():
    snapshot = t.facts_snapshot(_device())
    assert snapshot["services"] == ["445|tcp|smb", "5000|tcp|synology dsm"]


def test_facts_snapshot_is_stable_when_services_are_reordered():
    a = t.facts_snapshot(_device())
    b = t.facts_snapshot(_device(services=list(reversed(_device().services))))
    assert a == b


def test_facts_snapshot_changes_when_the_ip_moves():
    assert t.facts_snapshot(_device()) != t.facts_snapshot(_device(ip="192.168.1.21"))
