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


# ── hardware comes out of `properties` first ────────────────────────────────

# What the Proxmox import and the scanner actually write.
_PROXMOX_PROPERTIES = [
    {"key": "VMID", "value": "108"},
    {"key": "Kind", "value": "LXC"},
    {"key": "CPU Cores", "value": "4"},
    {"key": "RAM", "value": "6.1 GB"},
    {"key": "Disk", "value": "50.0 GB"},
]


def _from_properties(**overrides):
    """A row as the importers leave it: hardware in properties, columns empty."""
    return _device(
        **{
            "properties": _PROXMOX_PROPERTIES,
            "cpu_count": None,
            "cpu_model": None,
            "ram_gb": None,
            "disk_gb": None,
            **overrides,
        }
    )


def test_hardware_block_reads_the_properties_when_the_columns_are_empty():
    """The regression: an empty hardware table beside a full properties one.

    `cpu_count` / `ram_gb` / `disk_gb` are barely written any more — the same
    facts arrive as properties — so the table printed three em dashes next to a
    properties table listing all three.
    """
    md = t.block_hardware(_from_properties())
    assert "| 4 cores | 6.1 GB | 50.0 GB |" in md
    assert "—" not in md


def test_hardware_block_takes_a_property_value_verbatim():
    # "6.1 GB" is already formatted; appending a unit would say "6.1 GB GB", and
    # guessing one onto a bare number would be inventing a fact.
    md = t.block_hardware(_from_properties(properties=[{"key": "RAM", "value": "12288 MB"}]))
    assert "| 12288 MB |" in md


def test_hardware_block_matches_property_keys_whatever_their_case():
    md = t.block_hardware(_from_properties(properties=[{"key": "ram", "value": "8 GB"}]))
    assert "8 GB" in md


def test_hardware_block_accepts_the_common_synonyms():
    md = t.block_hardware(
        _from_properties(
            properties=[
                {"key": "Processor", "value": "Xeon E3-1220"},
                {"key": "vCPU", "value": "8"},
                {"key": "Memory", "value": "64 GB"},
                {"key": "Storage", "value": "4 TB"},
            ]
        )
    )
    assert "| Xeon E3-1220 ×8 | 64 GB | 4 TB |" in md


def test_hardware_block_prefers_a_property_over_the_legacy_column():
    md = t.block_hardware(_device(properties=[{"key": "RAM", "value": "64 GB"}]))
    assert "64 GB" in md
    assert "20 GB" not in md


def test_hardware_block_still_falls_back_to_the_columns():
    # A row that predates the move, or one typed into the inventory modal.
    md = t.block_hardware(_device(properties=[]))
    assert "Intel Celeron J4125 ×4" in md
    assert "20 GB" in md


def test_hardware_block_is_empty_when_neither_source_has_anything():
    md = t.block_hardware(
        _device(properties=[], cpu_count=None, cpu_model=None, ram_gb=None, disk_gb=None)
    )
    assert "| — | — | — |" in md


def test_hardware_block_ignores_a_property_with_no_value():
    md = t.block_hardware(_from_properties(properties=[{"key": "RAM", "value": ""}]))
    assert "| — | — | — |" in md


def test_property_map_keeps_the_first_of_a_repeated_key():
    device = _device(properties=[{"key": "RAM", "value": "first"}, {"key": "RAM", "value": "second"}])
    assert t.property_map(device)["ram"] == "first"


# ── the snapshot follows what the tables print ──────────────────────────────


def test_the_snapshot_carries_the_properties():
    snapshot = t.facts_snapshot(_from_properties())
    assert snapshot["properties"]["RAM"] == "6.1 GB"


def test_editing_a_property_is_drift():
    before = t.facts_snapshot(_from_properties())
    after = t.facts_snapshot(
        _from_properties(properties=[*_PROXMOX_PROPERTIES[:3], {"key": "RAM", "value": "12 GB"}])
    )
    assert before != after


def test_the_snapshot_survives_its_json_round_trip():
    """It is stored as JSON and compared against a freshly computed one.

    A tuple or a set would come back a list and every document would read as
    drifted forever, so the shape has to be JSON-native on both sides.
    """
    import json

    snapshot = t.facts_snapshot(_from_properties())
    assert json.loads(json.dumps(snapshot)) == snapshot


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
    assert "tags: []" in md


def test_library_document_advertises_tags_too():
    assert "tags: []" in t.render_library_document(t.TEMPLATE_RUNBOOK, "Reboot the NAS")


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


def test_frontmatter_omits_empty_scalars_but_prints_an_empty_list():
    # `tags: []` is how a user learns tags exist at all, so an empty list stays.
    rendered = t.render_frontmatter({"a": 1, "b": None, "c": "", "d": [], "e": ["x", "y"]})
    assert rendered == "---\na: 1\nd: []\ne: [x, y]\n---"


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
