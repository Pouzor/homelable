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
import re
from dataclasses import dataclass
from typing import Any

# The template's empty-section prompt (doc_template.py). Filling it replaces the
# prompt rather than appending beneath it, so "add the backup strategy" turns
# `_…_` into the strategy instead of "backup strategy, over an empty prompt".
_PLACEHOLDER = "_…_"

# Up to three spaces of indentation, then the fence — CommonMark's rule, minus
# the need to distinguish info strings: any ``` / ~~~ run opens or closes.
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*(.*)$")

# A CommonMark ATX heading: up to three spaces of indent, #s, then whitespace or
# end of line. `#foo` without the space is not a heading.
_HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*))?$")

MAX_LEVEL = 6


class SectionError(ValueError):
    """A section edit cannot be expressed; nothing was written."""


@dataclass
class Section:
    """One ATX heading and its body, as byte offsets into the source.

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


def _is_fence(line: str, open_fence: tuple[str, int] | None) -> tuple[str, int] | None:
    """Track fence state across lines.

    Returns the *active* fence as `(char, min_close_len)` when the line leaves a
    fence open, and None when the line leaves every fence closed. A line is a
    candidate opener only outside a fence; outside, a fence run opens when its
    marker is at least 3 long. Inside, the fence closes on a run of the same
    marker at least as long as the opener's.
    """
    match = _FENCE.match(line)
    if match is None:
        return open_fence
    marker = match.group(1)
    char = marker[0]
    length = len(marker)
    if open_fence is None:
        return (char, length) if length >= 3 else None
    if char == open_fence[0] and length >= open_fence[1]:
        return None
    return open_fence


def parse_sections(body: str | None) -> list[Section]:
    """The ATX headings in `body` in document order, code fences excluded."""
    body = body or ""
    sections: list[Section] = []
    parents: list[Section] = []
    fence: tuple[str, int] | None = None
    offset = 0
    for line in body.splitlines(keepends=True):
        fence = _is_fence(line, fence)
        if fence is not None:
            offset += len(line)
            continue
        heading = _is_heading(line)
        if heading is not None:
            level, text = heading
            # Every section still on the stack at this depth ends here — its
            # body runs to the heading that just arrived. Popping in order of
            # descending level assigns each its true end; the parent beneath
            # them stays open and grows up to this new heading instead.
            while parents and parents[-1].level >= level:
                parents.pop().body_end = offset
            section = Section(
                index=len(sections),
                level=level,
                heading=text,
                heading_offset=offset,
                body_start=offset + len(line),
                body_end=len(body),
                parent_index=parents[-1].index if parents else None,
            )
            if parents:
                parents[-1].body_end = section.heading_offset
            sections.append(section)
            parents.append(section)
        offset += len(line)
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

    A heading as shallow as the owning section starts a *new* section the
    moment it is inserted — the following headings would change meaning. An
    unbalanced code fence turns everything after it, up to the document's end,
    into a code block. Either mistake is caught here, before the write.
    """
    normalized = _normalize_content(content)
    if not normalized:
        raise SectionError("content is empty")

    fence: tuple[str, int] | None = None
    for line in normalized.splitlines():
        fence = _is_fence(line, fence)
    if fence is not None:
        raise SectionError("content contains an unclosed code fence")

    for lineno, line in enumerate(normalized.splitlines(), start=1):
        heading = _is_heading(line)
        if heading is not None and heading[0] <= owning_level:
            raise SectionError(
                f"line {lineno} introduces a level {heading[0]} heading; "
                f"content inside a level {owning_level} section may only use "
                f"deeper headings"
            )
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
