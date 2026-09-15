"""Markdown-aware section editing for documents.

`documents.py` replaces a whole body and records a revision. That is the right
shape for a human editor who owns the file, but it is useless for an AI that is
asked to *add* one paragraph to an existing document: a full-body write risks
rewriting what the user wrote. This module turns a body into a section outline
and applies small, bounded edits to it by slicing the source text — nothing
outside the touched range is reserialised, so frontmatter, heading order,
tables, lists, links and template markers stay byte-for-byte where they were.

Sections are located through markdown-it's CommonMark token stream rather
than a hand-rolled line scanner. The parser already knows which `#` lines are
real ATX headings, which paragraph-plus-underline pairs are setext headings
(the underline alone says nothing — `---` alone is a thematic break), and
which `#`-looking lines live inside HTML blocks, code fences or the YAML
frontmatter and are therefore not headings at all. Every `heading_open` token
carries a `[start, end)` *source line* range; a CR/LF-aware start-of-line
table turns that range into byte offsets into the original body, so an edit
remains a small, exact slice and the untouched text keeps its raw form —
including CRLF line endings and headings whose *text* spans several lines
(setext headings pair up the whole paragraph, not just its last line).

Sections are resolved by a stable index into the outline, never by heading text
alone (headings repeat). The index is meaningful only against the exact body it
was read from, which is why every edit carries the document version it was
prepared on: the route refuses to apply an edit whose version no longer matches.

What can be inserted is deliberately bounded. Content that would redefine the
document's structure — a heading as shallow as the owning section (which would
terminate it), or an unclosed code fence (which would swallow everything after
it as code) — is rejected before anything is written. The assembled document
must also retain every untouched source heading, so unclosed raw HTML cannot
silently consume an existing child or following section.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import Any

from markdown_it import MarkdownIt

# The template's empty-section prompt (doc_template.py). Filling it replaces the
# prompt rather than appending beneath it, so "add the backup strategy" turns
# `_…_` into the strategy instead of "backup strategy, over an empty prompt".
_PLACEHOLDER = "_…_"

# An opening fenced-code marker, per CommonMark: at most three spaces of
# indent, then a run of at least three backticks *whose info string contains no
# backtick*, or of at least three tildes with any info. The run is captured
# alone so the tracker knows how many markers a closer needs. The old pattern
# let a backtick inside the info string (`` ``` bad`info ``) open a fence that
# swallowed everything after it as code — CommonMark refuses that line as an
# opener, and this tracker must match markdown-it exactly.
_FENCE_OPEN = re.compile(r"^ {0,3}(?:(`{3,})[^`]*$|(~{3,}).*$)")
# A *closer* is a run of at least as many of the same marker followed only by
# spaces or tabs. An opener-lookalike with trailing text stays code, exactly as
# a renderer reads it; missing that rule let a `` ```bash extra `` line "close"
# a fence it actually leaves open.
_FENCE_CLOSE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*$")

# The line endpoints this software understands. markdown-it normalises every
# CR and CRLF to LF before parsing, so a lone carriage return is a line ending
# here too — splitting on only CRLF/LF would disagree with the parser. We split
# on these characters alone — never on `str.splitlines`, which also splits
# U+2028 — so the offsets align with markdown-it's own line counting.
_LINE_ENDING = re.compile(r"\r\n|\n|\r")

# The frontmatter block uses `doc_tree.parse_frontmatter`'s delimiter semantics,
# extended to the CR/LF forms markdown-it accepts. YAML `# comment` inside it is
# metadata, not a heading worth a section — offering it as an editable section
# would let an edit rewrite the document's own metadata block.
_FRONTMATTER = re.compile(
    r"\A---[ \t]*(?:\r\n|\n|\r)(.*?)(?:\r\n|\n|\r)---[ \t]*(?:(?:\r\n|\n|\r)|\Z)",
    re.DOTALL,
)

MAX_LEVEL = 6

_MD = MarkdownIt("commonmark")


class SectionError(ValueError):
    """A section edit cannot be expressed; nothing was written."""


@dataclass
class Section:
    """One ATX or setext heading and its body, as byte offsets into the source.

    The offsets are what make the edit bounded: every other section's text is
    guaranteed untouched because only `[body_start, body_end)` is replaced.
    """

    index: int
    level: int
    heading: str
    heading_offset: int
    body_start: int
    body_end: int
    parent_index: int | None = None


def _split_lines(body: str) -> tuple[list[int], list[str]]:
    """The start offset of every line and the line text without its terminator.

    CRLF, LF and a lone CR all count as one ending; U+2028 does not. There is
    always one *past-the-end* offset equal to `len(body)` at the end of the
    list, so a token whose map points one past the last line still indexes
    safely — for a body that does not end in a newline, markdown-it's last
    heading ends on the final line and `offsets[map.end]` would otherwise be
    out of range.
    """
    offsets = [0]
    parts: list[str] = []
    pos = 0
    for match in _LINE_ENDING.finditer(body):
        parts.append(body[pos : match.start()])
        offsets.append(match.end())
        pos = match.end()
    parts.append(body[pos:])
    offsets.append(len(body))
    return offsets, parts


def _is_fence(line: str, open_fence: tuple[str, int] | None) -> tuple[str, int] | None:
    """Track fence state across lines.

    Returns the *active* fence as `(char, min_close_len)` when the line leaves a
    fence open, and None when the line leaves every fence closed. Outside a
    fence, a marker run of at least three opens it — backtick fences reject an
    info string containing a backtick, matching CommonMark. Inside, only a run
    of the same marker at least as long as the opener's, followed solely by
    spaces or tabs, closes it.
    """
    if open_fence is not None:
        closer = _FENCE_CLOSE.match(line)
        if closer is None:
            return open_fence
        marker = closer.group(1)
        if marker[0] == open_fence[0] and len(marker) >= open_fence[1]:
            return None
        return open_fence
    opener = _FENCE_OPEN.match(line)
    if opener is None:
        return None
    marker = opener.group(1) or opener.group(2)
    return (marker[0], len(marker))


def _frontmatter_extent(body: str) -> int:
    """The byte length of a leading `---` YAML block, or 0 when absent.

    Uses the same leading/closing delimiters as `doc_tree.parse_frontmatter`,
    plus the CR/LF variants accepted by the Markdown parser. An unterminated
    `---` never closes, and a body that only opens one is not frontmatter.
    """
    match = _FRONTMATTER.match(body)
    if match is None:
        return 0
    return match.end()


def parse_sections(body: str | None) -> list[Section]:
    """The top-level headings in `body` in document order.

    ATX and Setext headings both count, matching how the UI renders the
    document. A setext heading spans as many text lines as its paragraph plus
    the `=`/`-` underline; markdown-it hands the whole paragraph text back as
    the heading, body_start lands right after the underline, and everything in
    an HTML block or code fence never produces a heading token at all.

    Two constructions never become editable sections:

    * The YAML frontmatter is *masked* (spaced out to blank lines, same bytes)
      before the parser sees it, so a code fence or HTML block inside YAML
      cannot swallow or invent headings later in the document — filtering
      tokens purely by offset is not enough: a fence the parser believes is
      still open hides everything that follows.
    * A heading nested inside a blockquote or list item (`> ## x`, `- ## x`)
      renders, but it is not offered as a section. Sourcing a sub-slice of its
      body would tear the container marker lines and the container's other
      content apart, so only headings at the top container level are editable.
    """
    body = body or ""
    offsets, _ = _split_lines(body)
    fm_end = _frontmatter_extent(body)
    if fm_end:
        frontmatter = body[:fm_end]
        # Keep the newline characters and the byte length identical, so both
        # line numbers and offsets stay in sync with the original body.
        masked = "".join(line_char if line_char in ("\r", "\n") else " " for line_char in frontmatter)
        source = masked + body[fm_end:]
    else:
        source = body

    sections: list[Section] = []
    parents: list[Section] = []
    tokens = _MD.parse(source)
    for i, token in enumerate(tokens):
        if token.type != "heading_open" or token.level != 0 or token.map is None:
            continue
        start, end = token.map
        heading_offset = offsets[start]
        if heading_offset < fm_end:
            continue
        inline = tokens[i + 1] if i + 1 < len(tokens) else None
        text = inline.content if inline is not None and inline.type == "inline" else ""
        # Every section still on the stack at this depth ends here — its body
        # runs to the heading that just arrived. Popping in order of descending
        # level assigns each its true end; the parent beneath them stays open
        # and grows up to this new heading instead.
        while parents and parents[-1].level >= int(token.tag[1:]):
            parents.pop().body_end = heading_offset
        section = Section(
            index=len(sections),
            level=int(token.tag[1:]),
            heading=text,
            heading_offset=heading_offset,
            body_start=offsets[end],
            body_end=len(body),
            parent_index=parents[-1].index if parents else None,
        )
        sections.append(section)
        parents.append(section)
    return sections


def outline(body: str | None) -> list[dict[str, Any]]:
    """The outline the API hands back: every section, its place and a taste.

    The excerpt rides along so a listing can tell which section is which
    without shipping the whole body — the body itself stays a deliberate,
    separate read.
    """
    body = body or ""
    items = []
    for section in parse_sections(body):
        items.append(
            {
                "index": section.index,
                "level": section.level,
                "heading": section.heading,
                "parent_index": section.parent_index,
                "excerpt": excerpt(body, section),
            }
        )
    return items


def excerpt(body: str, section: Section, limit: int = 160) -> str:
    raw = body[section.body_start : section.body_end].strip()
    return " ".join(raw.split())[:limit]


def proposal_id(
    document_id: str,
    expected_version: int,
    operation: str,
    section_index: int,
    heading: str | None,
    level: int | None,
    content: str,
) -> str:
    """A stable token for one proposed bounded edit.

    The same request retried after a lost response produces the same token, so
    the route can tell a duplicate from a new edit and answer the retry instead
    of appending twice.

    The payload is a *canonical JSON array* of the edited fields. Join-based
    serialisation is ambiguous: `(heading="x|2", level=None, content="y")` and
    `(heading="x", level=2, content="|y")` both valid for a level-1 target, yet
    collapse to the same `|`-joined string while producing different bodies.
    JSON keeps every field boundary explicit.
    """
    payload = json.dumps(
        [document_id, expected_version, operation, section_index, heading, level, content],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def sign_proposal(proposal: str, *, secret: str) -> str:
    """A server-signed preview token for one computed proposal.

    The preview endpoint hands this token to the caller; the apply endpoint
    demands it back and re-derives the expected value from the request it
    received. Only a server holding `secret` can produce a token for a given
    proposal, and the proposal itself digests the document id, the version and
    every edited field — so applying an edit that was never previewed, or a
    preview minted for another document, version or content, fails the signature
    check before any write is attempted.
    """
    return hmac.new(secret.encode("utf-8"), proposal.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def _normalize_content(content: str) -> str:
    """Trim the block the client sent without touching what the caller owns."""
    return (content or "").strip()


def _finish(inner: str, has_suffix: bool, newline: str) -> str:
    """Trailing whitespace so the next heading is separated by a blank line."""
    inner = inner.rstrip("\r\n")
    if has_suffix:
        return inner + newline * 2
    return inner + newline


def _preferred_newline(body: str) -> str:
    """Reuse the document's first line ending for generated separators."""
    match = _LINE_ENDING.search(body)
    return match.group() if match is not None else "\n"


def _block_gap(before: str, newline: str) -> str:
    """The smallest separator that starts a distinct Markdown block."""
    endings = list(_LINE_ENDING.finditer(before))
    if not endings or endings[-1].end() != len(before):
        return newline * 2
    if len(endings) > 1 and endings[-2].end() == endings[-1].start():
        return ""
    return newline


def _without_placeholder(raw: str) -> str:
    """Remove only the prompt, retaining whitespace before its source line."""
    if raw.strip() != _PLACEHOLDER:
        return raw
    return raw[: raw.index(_PLACEHOLDER)]


def _validate_content(content: str, owning_level: int) -> str:
    """Reject content that would escape the section it is being put into.

    Any heading at the owning level or shallower starts a *new* section the
    moment it is inserted — the following headings would change meaning. The
    markdown-it token stream catches them all: ATX headings, setext headings
    smuggled in as a paragraph plus an underline (reporting them as setext),
    and headings inside list items or quotes. Headings inside a code fence or
    HTML block never surface as tokens, so a closed fence or raw HTML is fine.

    A fence whose closer never arrives is rejected here too. markdown-it runs
    an unclosed fence to the end of the fragment either way — the fragment
    itself cannot tell — so a balanced-marker scan over the fixed opener rule
    decides whether the fence truly closed.
    """
    normalized = _normalize_content(content)
    if not normalized:
        raise SectionError("content is empty")

    for token in _MD.parse(normalized):
        if token.type != "heading_open" or token.map is None:
            continue
        level = int(token.tag[1:])
        if level <= owning_level:
            kind = "setext level" if token.markup in ("=", "-") else "level"
            raise SectionError(
                f"line {token.map[0] + 1} introduces a {kind} {level} heading; "
                f"content inside a level {owning_level} section may only use "
                f"deeper headings"
            )

    fence: tuple[str, int] | None = None
    for line in _split_lines(normalized)[1]:
        fence = _is_fence(line, fence)
    if fence is not None:
        raise SectionError("content contains an unclosed code fence")
    return normalized


def _first_child_offset(text: str) -> int | None:
    """The byte offset in `text` of its first real, top-level child heading.

    "Real" matters: markdown-it only reports headings the renderer would
    produce, so a `# like this` inside an HTML block or a code fence up front
    does not split the intro prose from the children it belongs to. "Top
    level" matters just as much: a heading inside a blockquote or list item
    is still part of the intro, not a section boundary — splitting there
    would tear the container apart.
    """
    if not text:
        return None
    offsets, _ = _split_lines(text)
    for token in _MD.parse(text):
        if token.type == "heading_open" and token.level == 0 and token.map is not None:
            return offsets[token.map[0]]
    return None


def apply_edit(
    body: str | None,
    operation: str,
    section_index: int,
    content: str,
    *,
    heading: str | None = None,
    level: int | None = None,
) -> tuple[str, Section, str]:
    """Produce the body a bounded edit would write, and the affected section.

    Pure: returns the assembled body and never touches a database. `preview`
    and `apply` share it, so what the caller saw in the preview is exactly what
    an apply of the same arguments writes. Raises `SectionError` for nothing
    that could be the requested edit.

    An insert places the new subsection as the *first* child: after the target
    section's own intro prose and before its existing children, which stay in
    their relative order. The intro never silently becomes another heading's
    body.
    """
    body = body or ""
    original_sections = parse_sections(body)
    if section_index < 0 or section_index >= len(original_sections):
        raise SectionError(
            f"section {section_index} does not exist in this version — "
            f"the document has {len(original_sections)} sections"
        )
    target = original_sections[section_index]
    prefix = body[: target.body_start]
    raw_inner = body[target.body_start : target.body_end]
    suffix = body[target.body_end :]
    newline = _preferred_newline(body)
    child_offset: int | None = None
    children = ""

    if operation == "append":
        normalized = _validate_content(content, target.level)
        child_offset = _first_child_offset(raw_inner)
        if child_offset is None:
            intro = raw_inner
        else:
            intro, children = raw_inner[:child_offset], raw_inner[child_offset:]
        intro = _without_placeholder(intro)
        new_inner = (
            intro
            + _block_gap(prefix + intro, newline)
            + _finish(normalized, bool(children or suffix), newline)
            + children
        )
    elif operation == "replace":
        normalized = _validate_content(content, target.level)
        gap = "" if prefix.endswith(("\n", "\r")) else newline
        new_inner = gap + _finish(normalized, bool(suffix), newline)
    elif operation == "insert":
        new_level = level if level is not None else target.level + 1
        if new_level <= target.level:
            raise SectionError(f"insert level {new_level} is not deeper than the target section's level {target.level}")
        if new_level > MAX_LEVEL:
            raise SectionError(f"insert level {new_level} is deeper than markdown supports ({MAX_LEVEL})")
        text = (heading or "").strip()
        if not text:
            raise SectionError("insert requires a heading")
        if "\n" in text or "\r" in text:
            raise SectionError("insert heading must be a single line")
        # Guard the whole inserted block — heading plus its content — against
        # escaping: the heading itself opens the new section, so content below
        # it belongs to a section of `new_level`.
        normalized = _validate_content(content, new_level)
        heading_line = f"{'#' * new_level} {text}{newline}"
        child_offset = _first_child_offset(raw_inner)
        if child_offset is None:
            intro = raw_inner
        else:
            intro, children = raw_inner[:child_offset], raw_inner[child_offset:]
        intro = _without_placeholder(intro)
        # The new subsection goes straight after the parent's intro (or, when
        # the section is empty or placeholder-filled, right after its heading)
        # and before the first existing child.
        new_inner = (
            intro
            + _block_gap(prefix + intro, newline)
            + heading_line
            + _finish(normalized, bool(children or suffix), newline)
            + children
        )
    else:
        raise SectionError(f"unknown operation: {operation}")

    new_body = prefix + new_inner + suffix

    # Parser evidence is the final safety bound. Raw HTML comments and script
    # blocks have no reliable local "closed" flag: parse the assembled document
    # and require every source heading we preserved to remain a real heading at
    # its exact new offset with the same parent. This catches inserted content
    # that would swallow or silently reparent an untouched child or suffix
    # without growing another HTML mini-parser here.
    sections = parse_sections(new_body)
    actual_by_offset = {section.heading_offset: section for section in sections}

    def mapped_offset(section: Section) -> int | None:
        if section.heading_offset < target.body_start:
            return section.heading_offset
        if child_offset is not None and section.heading_offset >= target.body_start + child_offset:
            child_start = len(prefix) + len(new_inner) - len(children)
            return child_start + section.heading_offset - target.body_start - child_offset
        if section.heading_offset >= target.body_end:
            return len(prefix) + len(new_inner) + section.heading_offset - target.body_end
        # `replace` deliberately removes the target's descendants. Append and
        # insert reach this branch only when there were no children.
        return None

    for original in original_sections:
        new_offset = mapped_offset(original)
        if new_offset is None:
            continue
        current = actual_by_offset.get(new_offset)
        if current is None or (current.level, current.heading) != (original.level, original.heading):
            raise SectionError("content would hide an existing section; close its HTML block or comment")

        original_parent = original_sections[original.parent_index] if original.parent_index is not None else None
        expected_parent_offset = mapped_offset(original_parent) if original_parent is not None else None
        current_parent_offset = (
            sections[current.parent_index].heading_offset if current.parent_index is not None else None
        )
        if current_parent_offset != expected_parent_offset:
            raise SectionError("content would change an existing section's parent")

    target_after = actual_by_offset.get(target.heading_offset)
    if target_after is None or target_after.level != target.level or target_after.heading != target.heading:
        raise SectionError("edit produced a document whose section headers shifted")
    return (
        new_body,
        target_after,
        new_body[target_after.body_start : target_after.body_end],
    )
