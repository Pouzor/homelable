"""Unit tests for the bounded section editing service.

These test the pure service layer — no HTTP, no database, no session fixtures.
The API tests live in test_documents.py alongside the rest of the documents API.
"""

import pytest

from app.services.doc_sections import (
    SectionError,
    apply_edit,
    excerpt,
    outline,
    parse_sections,
    proposal_id,
)

BODY = """\
---
title: nas-01
---

# nas-01

> _One line: what this device is for._

## Services

_No service has been fingerprinted on this device yet._

## Operations

### Start / stop

_…_

### Backup

_…_

### Update procedure

```sh
echo update
```

<!-- template marker -->

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| x | y | z |
"""

FLAT = "# A\n\nHello\n\n# B\n\nWorld\n"


# ── parse_sections ──────────────────────────────────────────────────────────


def test_parse_sections_returns_all_headings():
    secs = parse_sections(BODY)
    headings = [s.heading for s in secs]
    assert headings == [
        "nas-01",
        "Services",
        "Operations",
        "Start / stop",
        "Backup",
        "Update procedure",
        "Troubleshooting",
    ]


def test_parse_sections_indices_are_stable():
    secs = parse_sections(BODY)
    for i, s in enumerate(secs):
        assert s.index == i


def test_parse_sections_assigns_parent_child():
    secs = parse_sections(BODY)
    assert secs[0].parent_index is None  # # nas-01
    assert secs[1].parent_index == 0  # ## Services
    assert secs[3].parent_index == 2  # ### Start / stop → ## Operations
    assert secs[4].parent_index == 2  # ### Backup → ## Operations
    assert secs[5].parent_index == 2  # ### Update procedure → ## Operations
    assert secs[6].parent_index == 0  # ## Troubleshooting


def test_parse_sections_fenced_headings_excluded():
    body = "# Heading\n\n```sh\n# not a heading\necho hi\n```\n\n# Another\n"
    secs = parse_sections(body)
    assert len(secs) == 2
    assert secs[0].heading == "Heading"
    assert secs[1].heading == "Another"


def test_parse_sections_body_end_of_child_closed_by_sibling():
    secs = parse_sections(BODY)
    backup = secs[4]
    update = secs[5]
    # Backup's body must end at Update's heading — not at len(body).
    assert backup.body_end == update.heading_offset
    assert backup.body_end < len(BODY)


def test_parse_sections_body_end_of_last_child_at_document_end():
    secs = parse_sections(BODY)
    troub = secs[6]
    assert troub.body_end == len(BODY)


def test_parent_always_contains_its_children_at_eof():
    """A parent's editable area must not depend on a trailing sibling.

    Regression for issue #485 review finding 5: without the closing sibling the
    old code ended the parent *before* its first child, but with one it ended at
    the sibling's heading — so whether `replace` removed the children depended
    on a section that came after them.
    """
    without_sibling = "# A\n\nHello\n\n## B\n\nchild\n"
    with_sibling = "# A\n\nHello\n\n## B\n\nchild\n\n# C\n\nother\n"

    a_without = parse_sections(without_sibling)[0]
    b_without = parse_sections(without_sibling)[1]
    a_with, b_with, c_with = parse_sections(with_sibling)

    # Both documents hold B inside A's editable area, whatever follows it.
    for a, b in ((a_without, b_without), (a_with, b_with)):
        assert a.body_start <= b.heading_offset < a.body_end

    # Replacing A removes its children either way, and only its own editable
    # area — the trailing sibling C survives in the second document.
    replaced_without, _, _ = apply_edit(without_sibling, "replace", 0, "only this")
    assert "only this" in replaced_without
    assert "## B" not in replaced_without
    replaced_with, _, _ = apply_edit(with_sibling, "replace", 0, "only this")
    assert "only this" in replaced_with
    assert "## B" not in replaced_with
    assert "# C" in replaced_with
    assert c_with.heading == "C"


def test_parse_sections_empty_body():
    assert parse_sections("") == []
    assert parse_sections(None) == []


def test_parse_sections_tilde_fence():
    body = "# A\n\n~~~\n# not real\n~~~\n\n# B\n"
    secs = parse_sections(body)
    assert len(secs) == 2


def test_parse_sections_fence_needs_three_markers():
    body = "# A\n\n`\n# nope\n`\n\n# B\n"
    secs = parse_sections(body)
    # Single backticks don't form a fence, so "# nope" is a heading.
    assert len(secs) == 3
    assert secs[1].heading == "nope"


# ── apply_edit: append ─────────────────────────────────────────────────────


def test_append_replaces_placeholder():
    secs = parse_sections(BODY)
    backup = secs[4]
    new_body, section, sectxt = apply_edit(BODY, "append", backup.index, "- **Retention** — 30 days")
    assert section.heading == "Backup"
    assert "- **Retention**" in sectxt
    # The section after Operations (Troubleshooting) is untouched.
    troub = secs[6]
    assert BODY[troub.heading_offset :] == new_body[new_body.index("## Troubleshooting") :]


def test_append_appends_below_existing_content():
    body = "# Title\n\n## Ops\n\n### Backup\n\nexisting content\n\n### Update\n\ndo\n"
    secs = parse_sections(body)
    backup = secs[2]
    new_body, _, sectxt = apply_edit(body, "append", backup.index, "- new line")
    assert "existing content" in sectxt
    assert "- new line" in sectxt
    # The new line appears after the existing content.
    assert sectxt.index("existing content") < sectxt.index("- new line")


def test_append_with_suffix_preserves_separation():
    body = "# T\n\n## Ops\n\n### Backup\n\n_…_\n\n### Update\n\ndo\n"
    secs = parse_sections(body)
    new_body, _, _ = apply_edit(body, "append", secs[2].index, "new stuff")
    # "### Update" remains intact, not glued to the inserted content.
    assert "### Update" in new_body


# ── apply_edit: replace ────────────────────────────────────────────────────


def test_replace_swaps_section_body():
    secs = parse_sections(BODY)
    troub = secs[6]
    new_body, section, sectxt = apply_edit(BODY, "replace", troub.index, "_Nothing worked out yet._")
    assert section.heading == "Troubleshooting"
    assert "_Nothing worked out yet._" in sectxt
    assert "| Symptom |" not in sectxt


def test_replace_preserves_surrounding_sections():
    secs = parse_sections(BODY)
    new_body, _, _ = apply_edit(BODY, "replace", secs[5].index, "patched")
    # Services heading (before) and Troubleshooting table (after) survive.
    assert "## Services" in new_body
    assert "| Symptom |" in new_body


# ── apply_edit: insert ─────────────────────────────────────────────────────


def test_insert_adds_subsection():
    secs = parse_sections(BODY)
    ops = secs[2]  # ## Operations (level 2)
    new_body, section, sectxt = apply_edit(
        BODY,
        "insert",
        ops.index,
        "1. Dial *110*\n2. Wait",
        heading="Call for help",
        level=3,
    )
    # The returned section is the target (Operations), now containing the subsection.
    assert section.heading == "Operations"
    assert "### Call for help" in sectxt
    assert "1. Dial *110*" in sectxt
    # The existing children of Operations remain.
    assert "### Start / stop" in sectxt


def test_insert_preserves_suffix_after_target():
    secs = parse_sections(BODY)
    ops = secs[2]
    new_body, _, _ = apply_edit(
        BODY,
        "insert",
        ops.index,
        "content",
        heading="New",
        level=3,
    )
    assert "## Troubleshooting" in new_body


def test_insert_default_level_is_one_deeper():
    secs = parse_sections(BODY)
    ops = secs[2]  # level 2
    _, section, sectxt = apply_edit(BODY, "insert", ops.index, "stuff", heading="Sub")
    assert section.heading == "Operations"
    assert "### Sub" in sectxt


# ── apply_edit: validation ─────────────────────────────────────────────────


def test_empty_content_rejected():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="content is empty"):
        apply_edit(BODY, "append", secs[4].index, "")


def test_whitespace_only_content_rejected():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="content is empty"):
        apply_edit(BODY, "append", secs[4].index, "  \n  \n  ")


def test_unclosed_fence_rejected():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="unclosed code fence"):
        apply_edit(BODY, "append", secs[4].index, "```\nlet x = 1")


def test_heading_at_owning_level_rejected():
    secs = parse_sections(BODY)
    # Backup is level 3; a level-3 heading would escape.
    with pytest.raises(SectionError, match="level 3"):
        apply_edit(BODY, "append", secs[4].index, "### Escape")


def test_heading_above_owning_level_rejected():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="level 2"):
        apply_edit(BODY, "append", secs[4].index, "## Escape")


def test_deeper_heading_within_section_allowed():
    secs = parse_sections(BODY)
    # A level-4 heading inside a level-3 section is fine.
    new_body, _, sectxt = apply_edit(BODY, "append", secs[4].index, "#### Sub-detail\n\ninfo")
    assert "#### Sub-detail" in sectxt


def test_insert_requires_heading():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="insert requires a heading"):
        apply_edit(BODY, "insert", secs[2].index, "content", heading="")


def test_insert_rejects_level_not_deeper():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="not deeper"):
        apply_edit(
            BODY,
            "insert",
            secs[2].index,
            "content",
            heading="Same level",
            level=2,
        )


def test_insert_rejects_level_below_1():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="not deeper"):
        apply_edit(
            BODY,
            "insert",
            secs[2].index,
            "content",
            heading="Shallow",
            level=1,
        )


def test_unknown_operation_rejected():
    secs = parse_sections(BODY)
    with pytest.raises(SectionError, match="unknown operation"):
        apply_edit(BODY, "shuffle", secs[0].index, "x")


def test_section_out_of_range_rejected():
    with pytest.raises(SectionError, match="does not exist"):
        apply_edit(BODY, "append", 99, "x")


# ── apply_edit: body integrity ──────────────────────────────────────────────


def test_outside_touched_range_is_byte_identical():
    """Everything before and after the edited section must be identical."""
    secs = parse_sections(BODY)
    backup = secs[4]
    new_body, _, _ = apply_edit(BODY, "append", backup.index, "added")
    # Prefix (everything before Backup's body) must not change.
    assert new_body[: backup.body_start] == BODY[: backup.body_start]
    # Suffix (Troubleshooting onward) must not change.
    troub = secs[6]
    assert new_body[new_body.index("## Troubleshooting") :] == BODY[troub.heading_offset :]


def test_edit_preserves_frontmatter_bytes():
    secs = parse_sections(BODY)
    new_body, _, _ = apply_edit(BODY, "replace", secs[6].index, "new stuff")
    assert new_body.startswith("---\ntitle: nas-01\n---")


def test_edit_preserves_fenced_code():
    secs = parse_sections(BODY)
    new_body, _, _ = apply_edit(BODY, "replace", secs[6].index, "new stuff")
    assert "```sh\necho update\n```" in new_body


# ── placeholder variants ───────────────────────────────────────────────────


def test_blockquote_content_is_preserved_not_replaced():
    body = "# T\n\n## Ops\n\n> _…_\n\n### Other\n\ndo\n"
    secs = parse_sections(body)
    new_body, _, sectxt = apply_edit(body, "append", secs[1].index, "filled in")
    # The blockquote is existing content, not a placeholder — append adds below.
    assert "> _…_" in sectxt
    assert "filled in" in sectxt


def test_plain_placeholder_in_non_opinionated_body():
    body = "# T\n\n## Notes\n\n_…_\n\n## End\n\ndone\n"
    secs = parse_sections(body)
    new_body, _, sectxt = apply_edit(body, "append", secs[1].index, "got it")
    assert "got it" in sectxt
    assert "_…_" not in sectxt


# ── outline / excerpt ───────────────────────────────────────────────────────


def test_outline_returns_index_and_heading():
    items = outline(BODY)
    assert items[0]["heading"] == "nas-01"
    assert items[0]["index"] == 0
    assert items[0]["level"] == 1
    assert "parent_index" in items[0]


def test_outline_excerpt_is_brief():
    items = outline(BODY)
    for item in items:
        assert len(item["excerpt"]) <= 160


def test_excerpt_strips_newlines():
    body = "# T\n\n## Ops\n\n### Backup\n\nline one\nline two\n\n## End\n"
    secs = parse_sections(body)
    exc = excerpt(body, secs[2])
    assert "\n" not in exc


# ── proposal_id ─────────────────────────────────────────────────────────────


def test_proposal_id_is_deterministic():
    a = proposal_id("d1", 7, "append", 4, None, None, "hi")
    b = proposal_id("d1", 7, "append", 4, None, None, "hi")
    assert a == b


def test_proposal_id_differs_for_different_content():
    a = proposal_id("d1", 7, "append", 4, None, None, "hi")
    b = proposal_id("d1", 7, "append", 4, None, None, "hi!")
    assert a != b


def test_proposal_id_differs_for_different_version():
    a = proposal_id("d1", 7, "append", 4, None, None, "hi")
    b = proposal_id("d1", 8, "append", 4, None, None, "hi")
    assert a != b


def test_proposal_id_is_hex_and_bounded():
    pid = proposal_id("x", 1, "replace", 0, None, None, "test")
    assert len(pid) == 24
    int(pid, 16)  # must be valid hex


# ── edge cases ──────────────────────────────────────────────────────────────


def test_single_section_body():
    body = "# Only\n\nJust this.\n"
    secs = parse_sections(body)
    assert len(secs) == 1
    assert secs[0].body_end == len(body)


def test_flat_document_no_nesting():
    secs = parse_sections(FLAT)
    assert secs[0].parent_index is None
    assert secs[1].parent_index is None


def test_append_to_flat_section():
    new_body, _, sectxt = apply_edit(FLAT, "append", 0, "extra")
    assert "extra" in sectxt
    assert "# B" in new_body


# ── markdown safety (issue #485 review finding 3) ────────────────────────────


def test_parse_sections_ignores_yaml_comments_in_frontmatter():
    """A `# comment` inside the frontmatter is YAML, not a section heading.

    The GUI offers every section's heading as an editable slot; a frontmatter
    comment offered the same way would let an edit rewrite the document's own
    metadata block.
    """
    body = "---\ntitle: nas-01\n# not a heading, just yaml\n---\n\n# nas-01\n\n## Services\n"
    secs = parse_sections(body)
    headings = [s.heading for s in secs]
    assert headings == ["nas-01", "Services"]
    assert secs[0].heading_offset >= 0
    assert "title: nas-01" not in headings


def test_parse_sections_frontmatter_offsets_stay_byte_aligned():
    new_body, _, sectxt = apply_edit(BODY, "append", 0, "extra line")
    assert sectxt.rstrip().endswith("extra line")
    assert "# Services" in new_body
    # The truncated headings proof the replacement never clobbered structure.
    rebuilt = parse_sections(new_body)
    assert [s.heading for s in rebuilt] == [
        "nas-01",
        "Services",
        "Operations",
        "Start / stop",
        "Backup",
        "Update procedure",
        "Troubleshooting",
    ]


def test_parse_sections_closing_fence_with_trailing_text_stays_open():
    """A closer that carries trailing text never closes the fence.

    Some fence-lookalike lines end with metadata (`` ```bash extra ``); per
    CommonMark only a run followed by spaces or tabs closes. If such a line were
    accepted as a closer, everything after it — up to and including later
    sections — would render inside the code block while still being parsed as
    headings, so the edit targets and the rendered output would disagree.
    """
    body = "# H\n\n```\nfirst\n```still open\n\n# After\n\nstill code\n"
    secs = parse_sections(body)
    assert [s.heading for s in secs] == ["H"]
    assert secs[0].body_end == len(body)


def test_validate_accepts_headings_inside_closed_fence():
    """`#` inside a *properly closed* fence is code, not an escape.

    The old validation scanned every line for shallow headings without tracking
    fences, so an innocent code block caused a false "would escape the section"
    rejection.
    """
    content = "```sh\n# a shell comment\n```\n\nreal note"
    new_body, _, sectxt = apply_edit(BODY, "append", 4, content)
    assert "real note" in sectxt


def test_validate_rejects_unclosed_fence_even_with_hash_lines():
    content = "```\n# comment\nnever closed"
    with pytest.raises(SectionError, match="unclosed code fence"):
        apply_edit(BODY, "append", 4, content)


def test_insert_rejects_multiline_heading():
    """`Backup\n# Außerhalb` in the heading slot is two headings, not one.

    The newline would turn the trailing `# Außerhalb` into a top-level heading
    outside the target section — the exact escape the bound is meant to stop.
    """
    with pytest.raises(SectionError, match="single line"):
        apply_edit(BODY, "insert", 4, "body", heading="Backup\n# Außerhalb", level=4)


def test_parse_sections_setext_headings():
    """Setext headings (`Text` over `=`/`-`) count like ATX ones."""
    body = "Title\n=====\n\nintro\n\nSub title\n--------\n\nbody\n\n## Real\n"
    secs = parse_sections(body)
    assert [(s.heading, s.level) for s in secs] == [
        ("Title", 1),
        ("Sub title", 2),
        ("Real", 2),
    ]
    # The setext heading's body starts after its underline, not after the text.
    assert body[secs[0].body_start:].lstrip().startswith("intro")


def test_parse_sections_thematic_break_is_not_a_heading():
    """`---` between paragraphs is a break, never a level-2 heading."""
    body = "# A\n\nbefore\n\n---\n\nafter\n\n# B\n"
    secs = parse_sections(body)
    assert [s.heading for s in secs] == ["A", "B"]


def test_validate_rejects_setext_heading_escape():
    """A paragraph plus `---` smuggles a level-2 heading into the content."""
    with pytest.raises(SectionError, match="setext level 2 heading"):
        apply_edit(BODY, "replace", 4, "hidden heading\n---")
    # A `---` separated from text by a blank line is a break, not an escape.
    apply_edit(BODY, "replace", 4, "line\n\n---\n\nanother")
