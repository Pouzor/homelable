"""Backlinks — the documents pointing at a given document.

A wiki-link is one-way in the body: `[[device:nas-01]]` says where to go, not
where it came from. This walks every body once and inverts that.

The parsing and resolution rules **mirror `frontend/src/documentation/
wikilinks.ts` exactly** — same prefixes, same fallback order, same
case-insensitivity — the way `doc_template.service_url` mirrors
`utils/serviceUrl.ts`. They are duplicated rather than shared because the
forward direction has to resolve while the user types, with only what the
browser already holds, and the reverse direction needs every body, which the
browser does not hold: the list endpoint is metadata-only on purpose.

Change one side and change the other; `test_doc_backlinks.py` pins the rules.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

_LINK = re.compile(r"\[\[([^\]]+)\]\]")
_TARGETS = {"device", "doc", "node"}

# How much of the line the link sits on is worth showing next to it.
_CONTEXT_CHARS = 160


@dataclass(frozen=True)
class WikiLink:
    """`[[device:nas-01|the NAS]]` → target=device, key=nas-01, label=the NAS."""

    target: str
    key: str
    label: str


@dataclass(frozen=True)
class Backlink:
    """One document pointing at another, and the line it does it on."""

    doc_id: str
    label: str
    context: str
    count: int


def parse_link(inner: str) -> WikiLink | None:
    """Parse the inside of a `[[…]]`. An unknown prefix is part of the key."""
    address, _, label_part = inner.partition("|")
    address = address.strip()
    label = label_part.strip()
    if not address:
        return None
    target = "doc"
    key = address
    prefix, sep, rest = address.partition(":")
    if sep and prefix.lower() in _TARGETS:
        target = prefix.lower()
        key = rest.strip()
    if not key:
        return None
    return WikiLink(target=target, key=key, label=label or key)


def iter_links(body: str) -> Iterator[tuple[str, WikiLink]]:
    """Every link in a body, with the line it was written on."""
    for line in (body or "").splitlines():
        for match in _LINK.finditer(line):
            link = parse_link(match.group(1))
            if link:
                yield line, link


def device_label(device: Any) -> str:
    """Mirrors `deviceLabel` in `documentation/tree.ts`."""
    return (
        device.label
        or device.friendly_name
        or device.hostname
        or device.ip
        or "Unnamed device"
    )


def resolve(link: WikiLink, docs: list[Any], devices: list[Any]) -> str | None:
    """The document a link points at, or None when nothing matches yet."""
    key = link.key.lower()
    if link.target == "device":
        device = next(
            (d for d in devices if d.id == link.key or device_label(d).lower() == key),
            None,
        )
        if device is None:
            return None
        return next((doc.id for doc in docs if doc.device_id == device.id), None)
    if link.target == "node":
        return next((doc.id for doc in docs if doc.node_id == link.key), None)
    # A bare or `doc:` link: id, then slug, then title.
    return (
        next((doc.id for doc in docs if doc.id == link.key), None)
        or next((doc.id for doc in docs if (doc.slug or "").lower() == key), None)
        or next((doc.id for doc in docs if (doc.title or "").lower() == key), None)
    )


def _context(line: str, label: str) -> str:
    """The line the link is on, trimmed to a readable window around it."""
    text = " ".join(line.split())
    if len(text) <= _CONTEXT_CHARS:
        return text
    at = text.find(label)
    if at < 0:
        return text[:_CONTEXT_CHARS].rstrip() + "…"
    start = max(0, at - _CONTEXT_CHARS // 2)
    end = min(len(text), start + _CONTEXT_CHARS)
    return ("…" if start else "") + text[start:end].strip() + ("…" if end < len(text) else "")


def backlinks_for(target_id: str, docs: list[Any], devices: list[Any]) -> list[Backlink]:
    """Which of `docs` link to `target_id`, in the order the tree lists them.

    One entry per source document however many times it links, because the
    reader wants the documents, not the occurrences; `count` keeps the rest.
    A document linking to itself is not a backlink.
    """
    found: dict[str, Backlink] = {}
    for doc in docs:
        # Every document is a resolution target, but only one carrying `[[`
        # can be a source — skipping the rest early keeps this one cheap pass.
        if doc.id == target_id or "[[" not in (doc.body or ""):
            continue
        for line, link in iter_links(doc.body or ""):
            if resolve(link, docs, devices) != target_id:
                continue
            existing = found.get(doc.id)
            if existing is None:
                found[doc.id] = Backlink(
                    doc_id=doc.id,
                    label=link.label,
                    context=_context(line, link.label),
                    count=1,
                )
            else:
                found[doc.id] = Backlink(
                    doc_id=existing.doc_id,
                    label=existing.label,
                    context=existing.context,
                    count=existing.count + 1,
                )
    return list(found.values())


def has_device_link(docs: list[Any]) -> bool:
    """Whether any body carries a `[[device:…]]`, so the devices load is skippable."""
    return any(
        link.target == "device" for doc in docs for _, link in iter_links(doc.body or "")
    )
