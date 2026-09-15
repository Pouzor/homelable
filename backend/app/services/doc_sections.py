"""Markdown-aware section editing for documents.

`documents.py` replaces a whole body and records a revision. That is the right
shape for a human editor who owns the file, but it is useless for an AI that is
asked to *add* one paragraph to an existing document: a full-body write risks
rewriting what the user wrote. This module turns a body into a section outline
and applies small, bounded edits to it by slicing the source text — nothing
outside the touched range is reserialised, so frontmatter, heading order,
tables, lists, links and template markers stay byte-for-byte where they were.

Sections are resolved by a stable index into the outline, never by heading text
alone (headings repeat). The index is meaningful only against the exact body it
was read from, which is why every edit carries the document version it was
prepared on: the route refuses to apply an edit whose version no longer matches.

What can be inserted is deliberately bounded. Content that would redefine the
document's structure — a heading as shallow as the owning section (which would
terminate it), or an unclosed code fence (which would swallow everything after
it as code) — is rejected before anything is written.
"""

from __future__ import annotations

import hashlib
import hmac
import re
from dataclasses import dataclass
from typing import Any

# The template's empty-section prompt (doc_template.py). Filling it replaces the
# prompt rather than appending beneath it, so "add the backup strategy" turns
# `_…_` into the strategy instead of "backup strategy, over an empty prompt".
_PLACEHOLDER = "_…_"

# A fenced code block, per CommonMark: an opener is up to three spaces of
# indent plus a run of at least three backticks or tildes, optionally followed
# by an info string. A *closer* is a run of at least as many of the same marker
# followed only by spaces or tabs — an opener-lookalike with trailing text stays
# code, exactly as a renderer reads it. Missing that rule let a `` ```bash extra ``
# line "close" a fence it actually leaves open, shipping the sections after it
# into the code block.
_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})(?:[^\n]*)$")
_FENCE_CLOSE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*\r?$")

# A CommonMark ATX heading: up to three spaces of indent, #s, then whitespace or
# end of line. `#foo` without the space is not a heading.
_HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*))?$")

# A setext heading is a paragraph line followed by a line of only `=` (level 1)
# or only `-` (level 2), with no internal spacing. Spaced `- - -` is a thematic
# break, not an underline, and never a heading.
_SETEXT = re.compile(r"^ {0,3}(=+|-+)[ \t]*\r?$")

# A CommonMark thematic break: three or more `-`, `*` or `_`, spacing optional.
# It is not paragraph content, so it never carries a setext underline above it.
_THEMATIC = re.compile(r"^ {0,3}(?:([-*_])[ \t]*){3,}\r?$")

# Leading that cannot carry a setext underline above it: a list item, a
# blockquote, or an indented code line. A setext underline after these is not a
# heading (CommonMark treats the text as a block that way).
_NON_PARAGRAPH = re.compile(r"^( {0,3}(?:[-+*]|\d+[.)])[ \t]| {0,3}> | {4,}\S|\t\S)")

# The frontmatter block mirrors `doc_tree.parse_frontmatter`: a leading `---`
# line, then anything, then a closing `---` line. YAML `# comment` inside it is
# metadata, not a heading worth a section — offering it as an editable section
# would let an edit rewrite the document's own metadata block.
_FRONTMATTER = re.compile(r"\A---[ \t]*\r?\n(.*?)\n---[ \t]*\r?(?:\n|\Z)", re.DOTALL)

MAX_LEVEL = 6


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


def _is_heading(line: str) -> tuple[int, str] | None:
    match = _HEADING.match(line)
    if match is None:
        return None
    level = len(match.group(1))
    text = (match.group(2) or "").strip()
    return level, text


def _is_setext_underline(line: str) -> int | None:
    """The heading level a setext underline would make of the line above it."""
    match = _SETEXT.match(line)
    if match is None:
        return None
    marker = match.group(1)
    return 1 if marker.endswith("=") else 2


def _frontmatter_extent(body: str) -> int:
    """The byte length of a leading `---` YAML block, or 0 when absent.

    Mirrors `doc_tree.parse_frontmatter`, so the outline and the cache agree on
    which leading block is metadata. An unterminated `---` never closes, and a
    body that only opens one is not treated as frontmatter at all.
    """
    match = _FRONTMATTER.match(body)
    if match is None:
        return 0
    return match.end()


def _is_fence(line: str, open_fence: tuple[str, int] | None) -> tuple[str, int] | None:
    """Track fence state across lines.

    Returns the *active* fence as `(char, min_close_len)` when the line leaves a
    fence open, and None when the line leaves every fence closed. Outside a
    fence, a marker run of at least three opens the fence. Inside, only a run of
    the same marker at least as long as the opener's, followed solely by spaces
    or tabs, closes it — trailing text or a different marker keep it open.
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
    marker = opener.group(1)
    return (marker[0], len(marker))


def parse_sections(body: str | None) -> list[Section]:
    """The headings in `body` in document order, code fences and frontmatter excluded.

    ATX and Setext headings both count, matching how the UI renders the
    document. A setext heading spans two lines, so a paragraph line is deferred
    one step — it only becomes a heading when the line below it turns out to be
    `=`/`-` and it is not a block such as a list item or quote.
    """
    body = body or ""
    lines = body.splitlines(keepends=True)
    starts = []
    byte = 0
    for line in lines:
        starts.append(byte)
        byte += len(line)
    fm_end = _frontmatter_extent(body)

    sections: list[Section] = []
    parents: list[Section] = []
    fence: tuple[str, int] | None = None
    # The line a setext underline can still attach to: (start_offset, raw line).
    pending: tuple[int, str] | None = None
    for i, line in enumerate(lines):
        offset = starts[i]
        if offset < fm_end:
            pending = None
            continue
        fence = _is_fence(line, fence)
        if fence is not None:
            pending = None
            continue
        underline_level = _is_setext_underline(line)
        if underline_level is not None and pending is not None and not _NON_PARAGRAPH.match(pending[1]):
            level, text = underline_level, pending[1].strip()
            heading_offset = pending[0]
            body_start = offset + len(line)
        else:
            heading = _is_heading(line)
            if heading is not None:
                level, text = heading
                heading_offset = offset
                body_start = offset + len(line)
            elif line.strip() and not (_SETEXT.match(line) or _THEMATIC.match(line)):
                pending = (offset, line)
                continue
            else:
                pending = None
                continue
        pending = None
        # Every section still on the stack at this depth ends here — its body
        # runs to the heading that just arrived. Popping in order of descending
        # level assigns each its true end; the parent beneath them stays open
        # and grows up to this new heading instead.
        while parents and parents[-1].level >= level:
            parents.pop().body_end = heading_offset
        section = Section(
            index=len(sections),
            level=level,
            heading=text,
            heading_offset=heading_offset,
            body_start=body_start,
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
    """
    payload = "|".join(
        [
            document_id,
            str(expected_version),
            operation,
            str(section_index),
            heading or "",
            str(level) if level is not None else "",
            content,
        ]
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


def _section(body: str, section_index: int) -> Section:
    sections = parse_sections(body)
    if section_index < 0 or section_index >= len(sections):
        raise SectionError(
            f"section {section_index} does not exist in this version — the document has {len(sections)} sections"
        )
    return sections[section_index]


def _normalize_content(content: str) -> str:
    """Trim the block the client sent without touching what the caller owns."""
    return (content or "").strip()


def _finish(inner: str, has_suffix: bool) -> str:
    """Trailing whitespace so the next heading is separated by a blank line."""
    inner = inner.rstrip("\n")
    if has_suffix:
        return inner + "\n\n"
    return inner + "\n"


def _is_placeholder(raw: str) -> bool:
    stripped = raw.strip()
    return stripped == "" or stripped == _PLACEHOLDER


def _validate_content(content: str, owning_level: int, op: str) -> str:
    """Reject content that would escape the section it is being put into.

    A heading as shallow as the owning section starts a *new* section the moment
    it is inserted — the following headings would change meaning. A setext
    heading can be smuggled in as a paragraph line plus a `=`/`-` underline, and
    an unbalanced code fence turns everything after it, up to the document's
    end, into a code block. All three are caught here, before the write. Lines
    inside a fence are code, not headings, and never violate the depth rule.
    """
    normalized = _normalize_content(content)
    if not normalized:
        raise SectionError("content is empty")

    fence: tuple[str, int] | None = None
    # The paragraph line an underline could turn into a setext heading, tagged
    # with what to name in the error.
    pending: tuple[str, str] | None = None
    for lineno, line in enumerate(normalized.splitlines(), start=1):
        fence = _is_fence(line, fence)
        if fence is not None:
            pending = None
            continue
        underline_level = _is_setext_underline(line)
        if (
            underline_level is not None
            and pending is not None
            and not _NON_PARAGRAPH.match(pending[1])
        ):
            if underline_level <= owning_level:
                raise SectionError(
                    f"line {lineno} introduces a setext level {underline_level} heading; "
                    f"content inside a level {owning_level} section may only use "
                    f"deeper headings"
                )
            pending = None
            continue
        heading = _is_heading(line)
        if heading is not None:
            pending = None
            if heading[0] <= owning_level:
                raise SectionError(
                    f"line {lineno} introduces a level {heading[0]} heading; "
                    f"content inside a level {owning_level} section may only use "
                    f"deeper headings"
                )
            continue
        pending = (
            None
            if not line.strip() or _SETEXT.match(line) or _THEMATIC.match(line)
            else (str(lineno), line)
        )
    if fence is not None:
        raise SectionError("content contains an unclosed code fence")
    return normalized


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
    """
    body = body or ""
    target = _section(body, section_index)
    prefix = body[: target.body_start]
    raw_inner = body[target.body_start : target.body_end]
    suffix = body[target.body_end :]

    if operation == "append":
        normalized = _validate_content(content, target.level, operation)
        if _is_placeholder(raw_inner):
            new_inner = _finish(normalized, bool(suffix))
        else:
            new_inner = _finish(raw_inner.rstrip("\n") + "\n\n" + normalized, bool(suffix))
    elif operation == "replace":
        normalized = _validate_content(content, target.level, operation)
        new_inner = _finish(normalized, bool(suffix))
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
        normalized = _validate_content(content, new_level, operation)
        heading_line = f"{'#' * new_level} {text}\n"
        new_inner = heading_line + _finish(normalized, True) + _finish(raw_inner.lstrip("\n"), bool(suffix))
    else:
        raise SectionError(f"unknown operation: {operation}")

    new_body = prefix + new_inner + suffix

    # The construction never touches text outside the replaced range, and the
    # content checks above forbid the two ways it could step on the section that
    # follows. The final parse is a cheap backstop that the section the edit
    # targeted still exists and nothing else shifted.
    sections = parse_sections(new_body)
    if section_index >= len(sections):
        raise SectionError("edit produced a document without the target section")
    if sections[section_index].heading != target.heading:
        raise SectionError("edit produced a document whose section headers shifted")
    return (
        new_body,
        sections[section_index],
        new_body[sections[section_index].body_start : sections[section_index].body_end],
    )
