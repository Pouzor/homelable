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
    sign_proposal,
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
    assert sectxt.index("extra line") < sectxt.index("## Services")
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
    assert body[secs[0].body_start :].lstrip().startswith("intro")


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


def test_parse_sections_html_comment_and_block_do_not_leak_headings():
    """`# …` inside an HTML comment or block is HTML text, not a heading.

    Issue #485 repro: the old line scanner saw the `# hidden` line inside
    `<!-- … -->` / `<div>…</div>` and offered it as an editable section, so an
    edit could push content into what is really raw HTML.
    """
    for markdown in ("# A\n\n<!--\n# hidden\n-->\n\n# B\n", "# A\n\n<div>\n# hidden\n</div>\n\n# B\n"):
        assert [s.heading for s in parse_sections(markdown)] == ["A", "B"]


def test_parse_sections_backtick_in_info_string_is_not_a_fence():
    """`` ``` bad`info `` carries a backtick in its info string: not an opener.

    Issue #485 repro: the old opener regex allowed any info string, so this
    line opened a fence that swallowed the rest of the document as code and the
    later `# B` heading was never offered as a section. CommonMark rejects the
    line as an opener, and B must survive.
    """
    markdown = "# A\n\n``` bad`info\n# B\n```\n\n# C\n"
    assert [s.heading for s in parse_sections(markdown)] == ["A", "B"]


def test_parse_sections_multiline_setext_keeps_full_text():
    """A setext heading is the whole paragraph above the underline.

    Issue #485 repro: the old scanner kept only the *last* line as the heading
    text, so `line one\nline two\n===` came back as "line two" even though the
    rendered heading reads both lines.
    """
    markdown = "# A\n\nline one\nline two\n===\n\n# B\n"
    secs = parse_sections(markdown)
    assert [s.heading for s in secs] == ["A", "line one\nline two", "B"]
    heading = secs[1]
    assert heading.level == 1
    # Body starts after the underline, not after the last text line.
    assert markdown[heading.body_start :].lstrip().startswith("# B") or heading.body_start == markdown.index("\n\n# B")


def test_parse_sections_crlf_body_stays_byte_aligned():
    """CRLF line endings survive and keep the offsets byte-exact.

    Only CR/LF are line endings here; a edit of one section must not rewrite or
    renumber the rest of the document's `\r\n` pairs.
    """
    markdown = "# A\r\n\r\nintro\r\n\r\n## B\r\n\r\nchild\r\n\r\n# C\r\n"
    secs = parse_sections(markdown)
    assert [s.heading for s in secs] == ["A", "B", "C"]
    a, b, c = secs
    assert markdown[a.heading_offset] == "#"
    assert b.heading_offset == markdown.index("## B")
    assert "child" in markdown[b.body_start : b.body_end]
    assert c.heading_offset == markdown.index("# C")
    new_body, _, _ = apply_edit(markdown, "replace", 1, "new")
    assert new_body[: b.body_start] == markdown[: b.body_start]
    assert new_body[new_body.index("# C") :] == markdown[c.heading_offset :]
    assert "## B\r\nnew\r\n\r\n# C" in new_body


def test_parse_sections_eof_heading_without_newline_is_editable():
    markdown = "# Parent\n\nbody\n\n# Empty"
    sections = parse_sections(markdown)
    assert [(section.heading, section.body_start) for section in sections] == [
        ("Parent", len("# Parent\n")),
        ("Empty", len(markdown)),
    ]
    new_body, _, preview = apply_edit(markdown, "append", 1, "now filled")
    assert new_body == markdown + "\n\nnow filled\n"
    assert preview == "\nnow filled\n"

    replaced, _, _ = apply_edit("# Empty", "replace", 0, "now filled")
    assert replaced == "# Empty\nnow filled\n"
    inserted, _, _ = apply_edit("# Empty", "insert", 0, "now filled", heading="Child")
    assert inserted == "# Empty\n\n## Child\nnow filled\n"

    setext = "line one\nline two\n==="
    [section] = parse_sections(setext)
    assert section.heading == "line one\nline two"
    assert section.body_start == len(setext)


def test_parse_sections_lone_cr_is_an_ending_but_u2028_is_not():
    cr = "# A\r\r## B\rtext"
    sections = parse_sections(cr)
    assert [section.heading for section in sections] == ["A", "B"]
    assert sections[1].heading_offset == cr.index("## B")

    unicode_separator = "# A\u2028## not another heading\n# B"
    sections = parse_sections(unicode_separator)
    assert [section.heading for section in sections] == ["A\u2028## not another heading", "B"]
    assert sections[1].heading_offset == unicode_separator.index("# B")


@pytest.mark.parametrize("newline", ["\r\n", "\r"])
def test_edit_preserves_frontmatter_and_suffix_with_non_lf_endings(newline: str):
    frontmatter = newline.join(("---", "title: NAS", "tags: [a, b]", "---", ""))
    markdown = frontmatter + newline.join(("# A", "", "old", "", "# B", "", "keep"))
    [first, second] = parse_sections(markdown)
    suffix = markdown[second.heading_offset :]
    new_body, _, _ = apply_edit(markdown, "replace", first.index, "new")
    assert new_body.startswith(frontmatter)
    assert new_body[new_body.index("# B") :] == suffix


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_frontmatter_is_masked_before_markdown_parsing(newline: str):
    """An unclosed Markdown construct in YAML cannot hide the real body."""
    for yaml_value in ("  ```", "  <!--", "  <script>"):
        markdown = newline.join(("---", "note: |", yaml_value, "---", "# Real"))
        sections = parse_sections(markdown)
        assert [section.heading for section in sections] == ["Real"]
        assert sections[0].heading_offset == markdown.index("# Real")


def test_nested_container_headings_are_not_editable_sections():
    markdown = "# A\n\n> ## Quoted\n\n- ## Listed\n\n  text\n\n# B\n"
    sections = parse_sections(markdown)
    assert [section.heading for section in sections] == ["A", "B"]
    assert sections[0].body_end == sections[1].heading_offset


def test_insert_places_subsection_after_intro_before_children():
    """Insert lands as the *first child*: after the intro, before the children.

    Issue #485 review guidance: the parent's introductory prose must stay the
    parent's; the new subsection goes between that intro and the first existing
    child, and the children keep their relative order.
    """
    markdown = "# Parent\n\nintro prose\n\n## Child\n\nkeep me\n\n# Sibling\n\nend\n"
    new_body, _, sectxt = apply_edit(markdown, "insert", 0, "nested content", heading="New", level=2)
    assert sectxt.index("intro prose") < sectxt.index("## New") < sectxt.index("## Child")
    assert "## Child" in sectxt
    assert "# Sibling" in new_body


def test_append_to_parent_stays_before_children_and_preserves_them_exactly():
    markdown = "# Parent\r\n\r\nintro\r\n\r\n## Child\r\n\r\nkeep *exactly*\r\n\r\n# Sibling\r\n"
    parent, child, sibling = parse_sections(markdown)
    child_source = markdown[child.heading_offset : sibling.heading_offset]
    new_body, _, preview = apply_edit(markdown, "append", parent.index, "added")
    assert preview.index("intro") < preview.index("added") < preview.index("## Child")
    child_at = new_body.index("## Child")
    assert new_body[child_at : new_body.index("# Sibling")] == child_source


@pytest.mark.parametrize("operation", ["append", "insert"])
def test_unclosed_html_cannot_swallow_an_existing_child(operation: str):
    markdown = "# Parent\n\nintro\n\n## Child\n\nkeep\n\n# Sibling\n\nend\n"
    kwargs = {"heading": "New", "level": 2} if operation == "insert" else {}
    with pytest.raises(SectionError, match="hide an existing section"):
        apply_edit(markdown, operation, 0, "<script>never closed", **kwargs)


def test_unclosed_comment_cannot_swallow_an_untouched_suffix():
    markdown = "# A\n\ntext\n\n# B\n\nkeep\n"
    with pytest.raises(SectionError, match="hide an existing section"):
        apply_edit(markdown, "append", 0, "<!-- never closed")


def test_insert_cannot_silently_reparent_a_skipped_level_child():
    markdown = "# Parent\n\nintro\n\n### Existing child\n\nkeep\n"
    with pytest.raises(SectionError, match="change an existing section's parent"):
        apply_edit(markdown, "insert", 0, "new", heading="New child")


def test_append_heading_cannot_silently_reparent_an_existing_child():
    markdown = "# Parent\n\nintro\n\n### Existing child\n\nkeep\n"
    with pytest.raises(SectionError, match="change an existing section's parent"):
        apply_edit(markdown, "append", 0, "## Added child\n\nnew")


def test_replace_returns_exact_selected_subtree_preview():
    markdown = "# Parent\n\nintro\n\n## Child\n\nremove\n\n# Sibling\n\nkeep\n"
    sibling = markdown[markdown.index("# Sibling") :]
    new_body, section, preview = apply_edit(markdown, "replace", 0, "replacement")
    assert new_body == "# Parent\nreplacement\n\n" + sibling
    assert preview == "replacement\n\n"
    assert section.heading == "Parent"
    assert "## Child" not in new_body


def test_insert_replaces_placeholder_and_can_fill_empty_section():
    """Into an empty or `_…_` parent the new subsection follows the heading."""
    empty = "# Parent\n\n## Sibling\n\nend\n"
    new_body, _, _ = apply_edit(empty, "insert", 0, "nested content", heading="New", level=2)
    assert "# Parent\n\n## New\nnested content\n\n## Sibling" in new_body
    placeholder = "# Parent\n\n_…_\n\n## Sibling\n\nend\n"
    new_body, _, sectxt = apply_edit(placeholder, "insert", 0, "nested content", heading="New", level=2)
    assert "_…_" not in sectxt
    assert "# Parent\n\n## New\nnested content\n" in new_body


def test_proposal_id_is_delimiter_safe():
    """Field boundaries cannot be smuggled inside a field's own text.

    Issue #485 repro: `(heading="x|2", level=None, content="y")` and
    `(heading="x", level=2, content="|y")` are two different edits that produce
    different bodies, but a `|`-joined payload collided. Canonical JSON keeps
    them apart, so a preview token can never mask the other edit.
    """
    request_a = ("doc", 1, "insert", 0, "x|2", None, "y")
    request_b = ("doc", 1, "insert", 0, "x", 2, "|y")
    proposal_a = proposal_id(*request_a)
    proposal_b = proposal_id(*request_b)
    assert proposal_a != proposal_b
    assert sign_proposal(proposal_a, secret="s") != sign_proposal(proposal_b, secret="s")
    assert (
        apply_edit("# Root\n\nold\n", "insert", 0, "y", heading="x|2", level=None)[0]
        != apply_edit("# Root\n\nold\n", "insert", 0, "|y", heading="x", level=2)[0]
    )


def test_validate_accepts_html_block_with_hash_lines():
    """`# like this` inside an HTML block is not an escape the bound must fight.

    The token-based validation only sees renderable headings, so raw HTML that
    contains a markdown-lookalike heading inserts cleanly instead of being
    rejected like a real structural change.
    """
    content = "<div>\n# one\n</div>\n\nthen text"
    new_body, _, sectxt = apply_edit(BODY, "append", 4, content)
    assert "<div>" in sectxt
    assert "then text" in sectxt
