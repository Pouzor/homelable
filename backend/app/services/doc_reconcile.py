"""Reconcile a device document against the live device facts — the engine
behind "Update from device".

``regenerate`` throws the body away, so it is only right for a user who wants a
fresh document. The everyday need is different: the device moved on, and the
document should keep up without losing the notes, annotations and reformatting
the user added around the generated sections. This module is that path, built
on a three-way comparison:

* **baseline** — the body recorded at the last sync (``doc.baseline_body``),
  with ``doc.facts_snapshot`` as a fallback for the tables it can reconstruct
  (the Device Information cells, Hardware and Properties);
* **current** — the body the user has *now*, manual edits included;
* **new** — a freshly generated body from the live device.

Comparing current vs new alone cannot tell a device change from a user edit. A
fact that reads the same in current as in baseline was never touched by the
user, so the device's new value can be applied without asking; a fact the user
changed *and* the device changed is a conflict the user must resolve (keep /
take the device / write their own). User-owned sections — Configuration,
Operations, Troubleshooting, Dependencies, Changelog, Notes, the preamble, any
heading this module does not know — are never touched. Where the baseline
cannot reconstruct what a fact used to say, the module is deliberately
conservative: the user decides rather than risking a silent overwrite.

Nothing here writes to the database. It turns three bodies, the old device
facts and optional resolutions into a proposed body plus the list of changes
and the decisions behind them.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field

from app.services.doc_template import _hardware_property, cell

# The disposition of a fact or section after the three-way comparison.
SAME = "same"      # no decision needed — include it in the merge as it is
AUTO = "auto"      # safe to apply the device value without asking
CONFLICT = "conflict"  # user edited it *and* the device changed it — ask

# How a conflict is resolved. Sentinels for "not decided yet" are None.
KEEP = "keep"      # keep the user's text
DEVICE = "device"  # take the device's value
CUSTOM = "custom"  # the user's own replacement text

# The rows of the generated Device Information table, mapped to the words a
# decision surface should use for them ("IP" is not an IP *address*).
_INFO_ROWS = (
    ("Type", "Type"),
    ("Vendor / Model", "Vendor / Model"),
    ("Hostname", "Hostname"),
    ("IP", "IP address"),
    ("MAC", "MAC address"),
    ("IEEE", "IEEE address"),
    ("OS", "Operating system"),
    ("First discovered", "First discovered"),
    ("Status check", "Status check"),
)
_INFO_NAME_BY_LABEL = {label: name for label, name in _INFO_ROWS}

# The generated, device-owned sections, in the order the generator emits them.
_DEVICE_SECTIONS = ("Hardware", "Physical location", "Properties", "Services", "Network")

# The table of facts every generated device document opens with.
_DEVICE_INFO_HEADING = "Device Information"

# Section names that own their block: the generated ones plus the user-owned
# sections that end a generated document. A block boundary is one of these, the
# device-name H1, or any level-2 heading (a user's free `## Something` must not
# be swallowed by the section above it). Anything else — the `### <service>` sub
# blocks under Services, `### Start / stop` under Operations, an arbitrary
# `###` decoration — stays inside the block that hosts it, which is exactly what
# lets a whole generated section be compared and replaced in one piece.
_SECTION_NAMES = frozenset((_DEVICE_INFO_HEADING, *_DEVICE_SECTIONS))
_USER_SECTION_NAMES = frozenset(
    ("Configuration", "Operations", "Troubleshooting", "Dependencies", "Changelog", "Notes")
)
_ALL_SECTION_NAMES = _SECTION_NAMES | _USER_SECTION_NAMES

_HEADING = re.compile(r"^(#{1,3})\s+(.*?)\s*$")
_ROW = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$")
_TITLE_IN_FRONTMATTER = re.compile(r"^title:.*$", re.MULTILINE)


@dataclass
class Block:
    """A run of contiguous lines: the preamble, or one heading and its body."""

    level: int
    heading: str | None
    lines: list[str]
    removed: bool = False


@dataclass
class Change:
    """One fact or section whose disposition the preview surfaces.

    ``status`` is ``same``, ``auto`` or ``conflict``. A conflict carries a
    resolution once the user has decided, and that resolution changes what the
    merged body holds for it.
    """

    id: str
    name: str
    kind: str  # "field" | "section"
    status: str
    documented: str
    device: str
    previous: str = ""
    resolution: str | None = None  # keep | device | custom
    custom: str | None = None


@dataclass
class Resolution:
    """What the user wants for one conflict: keep, take the device, or custom."""

    id: str
    choice: str
    custom: str | None = None


@dataclass
class Result:
    changes: list[Change] = field(default_factory=list)
    proposed_body: str = ""
    summary: list[str] = field(default_factory=list)

    @property
    def conflicts(self) -> list[Change]:
        return [c for c in self.changes if c.status == CONFLICT]

    @property
    def auto(self) -> list[Change]:
        return [c for c in self.changes if c.status == AUTO]

    @property
    def unresolved(self) -> list[Change]:
        return [c for c in self.changes if c.status == CONFLICT and not c.resolution]


# ── parsing ─────────────────────────────────────────────────────────────────


def _norm(text: str | None) -> str:
    """Compare bodies tolerantly: trailing space and blank runoff don't matter."""
    if not text:
        return ""
    return "\n".join(line.rstrip() for line in text.splitlines()).strip()


def _or_none(text: str | None) -> str | None:
    """A normalized string that collapses the empty state to None."""
    if not text:
        return None
    return "\n".join(line.rstrip() for line in text.splitlines()).strip()


def split_blocks(body: str) -> list[Block]:
    """The body as a list of blocks.

    The preamble comes first, then one block per section. A block boundary is a
    heading that owns its block (a generated section, a user section, the
    device-name H1) or any level-2 heading; everything between two such
    boundaries — including nested ``###`` subheadings such as the per-service
    entries under ``## Services`` — stays inside the block that hosts it.
    """
    blocks: list[Block] = []
    current = Block(level=0, heading=None, lines=[])
    for line in body.splitlines():
        match = _HEADING.match(line)
        if match:
            level = len(match.group(1))
            name = match.group(2)
            if level == 1 or level == 2 or name in _ALL_SECTION_NAMES:
                if current.lines:
                    blocks.append(current)
                current = Block(level=level, heading=name, lines=[line])
                continue
        current.lines.append(line)
    if current.lines:
        blocks.append(current)
    return blocks


def _find(blocks: list[Block], heading: str) -> Block | None:
    for block in blocks:
        if block.heading == heading:
            return block
    return None


def _first_h1(blocks: list[Block]) -> str | None:
    for block in blocks:
        if block.level == 1 and block.heading:
            return block.heading
    return None


def _heading_level(line: str) -> int:
    """The level (`#` count) of a heading line, or 0 for anything else."""
    match = _HEADING.match(line)
    return len(match.group(1)) if match else 0


def _block_text(block: Block) -> str:
    return "\n".join(block.lines)


def _content(block: Block | None) -> list[str]:
    """A section's lines without its heading line."""
    if block is None:
        return []
    return block.lines[1:] if block.heading else block.lines


def _content_text(block: Block | None) -> str:
    return "\n".join(_content(block))


def _row_from_line(line: str) -> tuple[str, str] | None:
    """The (label, cell) of a markdown data row, or None for anything else."""
    match = _ROW.match(line)
    if not match:
        return None
    label = match.group(1).strip()
    if not label or set(label) <= {"-", ":"}:
        return None  # header or separator row
    return label, match.group(2).strip()


def _table_rows(text: str) -> list[tuple[str, str]]:
    """The data rows of a markdown table, in order, labels and cells as-is."""
    pairs: list[tuple[str, str]] = []
    for line in text.splitlines():
        row = _row_from_line(line)
        if row is not None:
            pairs.append(row)
    return pairs


# ── baseline reconstruction from the old device facts ──────────────────────


def _info_old_cell(snapshot: dict | None, label: str) -> str | None:
    """What a Device Information cell read at snapshot time, if reconstructable.

    ``None`` means the snapshot cannot say — the reconcile then treats the fact
    conservatively (the user decides if current and device values differ).
    """
    if not snapshot:
        return None
    if label == "Type":
        return cell(snapshot.get("type"))
    if label == "Vendor / Model":
        parts = [p for p in (snapshot.get("vendor"), snapshot.get("model")) if p]
        return cell(" / ".join(parts) or "—")
    if label == "Hostname":
        return cell(snapshot.get("hostname"))
    if label == "IP":
        return cell(snapshot.get("ip"))
    if label == "MAC":
        return cell(snapshot.get("mac"))
    if label == "IEEE":
        return cell(snapshot.get("ieee_address"))
    if label == "OS":
        return cell(snapshot.get("os"))
    if label == "First discovered":
        return None  # date and sources are not in the snapshot
    if label == "Status check":
        check, target = snapshot.get("check_method"), snapshot.get("check_target")
        if check and target:
            return f"`{check}` → `{target}`"
        if check:
            return f"`{check}`"
        return "—"
    return None


def _info_old_table(snapshot: dict | None, baseline: Block | None) -> str | None:
    """The full Device Information table as of the last sync, if known."""
    if baseline is not None:
        return _content_text(baseline)
    if not snapshot:
        return None
    rows: list[tuple[str, str]] = []
    for label, _ in _INFO_ROWS:
        value = _info_old_cell(snapshot, label)
        if value is None:
            return None  # cannot reconstruct faithfully → conservative
        rows.append((label, value))
    return "\n".join(_render_info_rows(rows))


def _render_info_rows(rows: list[tuple[str, str]]) -> list[str]:
    return [f"| {label} | {value} |" for label, value in rows]


def _hardware_old_content(snapshot: dict | None) -> str | None:
    """The Hardware table at snapshot time, generator-shape, or None."""
    if not snapshot:
        return None
    props = snapshot.get("properties") or {}

    cpu_model = _hardware_property(props, "cpu_model") or snapshot.get("cpu_model")
    cpu_count = _hardware_property(props, "cpu_count") or snapshot.get("cpu_count")
    cpu = cpu_model or (f"{cpu_count} cores" if cpu_count else None)
    ram_gb = snapshot.get("ram_gb")
    ram = _hardware_property(props, "ram") or (f"{ram_gb:g} GB" if ram_gb else None)
    disk_gb = snapshot.get("disk_gb")
    disk = _hardware_property(props, "disk") or (f"{disk_gb:g} GB" if disk_gb else None)

    row = f"| {cell(cpu)} | {cell(ram)} | {cell(disk)} |"
    return "| CPU | RAM | Disk |\n|---|---|---|\n" + row


def _properties_old_content(snapshot: dict | None) -> str | None:
    """The Properties table at snapshot time, generator-shape, or None."""
    if not snapshot:
        return None
    props = snapshot.get("properties") or {}
    if not props:
        return None  # generator would not have emitted the section at all
    rows = [f"| {cell(key)} | {cell(value)} |" for key, value in props.items()]
    return "\n".join(["| Key | Value |", "|---|---|", *rows])


# ── the three-way decision ──────────────────────────────────────────────────


def decide(cur: str | None, old: str | None, new: str | None) -> str:
    """Classify one fact or section given its current, baseline and device value.

    The rules, in order:

    * the user already has the device's value → nothing to do;
    * the device is unchanged → nothing to do, whatever the user wrote;
    * the device's value is gone while the user still has text → ask before
      removing anything (even untouched);
    * no baseline for it and nothing in the document → safe to add;
    * no baseline for it and the document differs → ask (conservative);
    * the user left the baseline value → safe to apply;
    * anything else → the user touched it and the device changed it: conflict.
    """
    if cur == new:
        return SAME
    if old == new:
        return SAME
    if not new:
        return CONFLICT  # device dropped the value the user still shows
    if old is None:
        return AUTO if not cur else CONFLICT
    if cur == old:
        return AUTO
    return CONFLICT


def _inform_closed_change(change: Change, resolutions: dict[str, Resolution]) -> None:
    resolution = resolutions.get(change.id)
    if resolution is not None:
        change.resolution = resolution.choice
        change.custom = resolution.custom


# ── the reconcile ───────────────────────────────────────────────────────────


def reconcile(
    current: str,
    new: str,
    baseline_body: str | None = None,
    snapshot: dict | None = None,
    resolutions: list[Resolution] | None = None,
) -> Result:
    """Merge ``current`` up to the device's current facts.

    ``baseline_body`` is the body recorded at the last sync; ``snapshot`` backs
    it up for the tables it can reconstruct. ``resolutions`` settle conflicts;
    anything left open keeps the user's text in the proposed body, so a preview
    reads like a draft, not a guess.
    """
    by_id = {r.id: r for r in (resolutions or [])}
    new_blocks = split_blocks(new)
    baseline_blocks = split_blocks(baseline_body) if baseline_body else []
    changes: list[Change] = []

    def add(change: Change) -> Change:
        _inform_closed_change(change, by_id)
        changes.append(change)
        return change

    # ── Device name ─────────────────────────────────────────────────────────
    new_name = _first_h1(new_blocks) or ""
    cur_name = _first_h1(split_blocks(current))
    old_name = (snapshot or {}).get("label") if snapshot else None
    name_change = add(
        Change(
            id="name",
            name="Device name",
            kind="field",
            status=decide(_or_none(cur_name), _or_none(old_name), _or_none(new_name) or None),
            documented=cur_name or "",
            device=new_name,
            previous=old_name or "",
        )
    )

    # ── Device Information rows ─────────────────────────────────────────────
    current_blocks = split_blocks(current)
    cur_info = _find(current_blocks, "Device Information")
    new_info = _find(new_blocks, "Device Information")
    baseline_info = _find(baseline_blocks, "Device Information")
    info_changes: dict[str, Change] = {}

    new_rows = _table_rows(_content_text(new_info)) if new_info else []
    new_by_label = {label: value for label, value in new_rows}
    base_cells = (
        dict(_table_rows(_content_text(baseline_info))) if baseline_info is not None else {}
    )

    if new_rows:
        cur_rows = _table_rows(_content_text(cur_info)) if cur_info else []
        cur_cells = {label: value for label, value in cur_rows}
        for label, new_cell in new_rows:
            old_cell = base_cells.get(label)
            if old_cell is None:
                old_cell = _info_old_cell(snapshot, label)
            change = add(
                Change(
                    id=f"device-info.{label}",
                    name=_INFO_NAME_BY_LABEL.get(label, label),
                    kind="field",
                    status=decide(
                        _or_none(cur_cells.get(label)),
                        _or_none(old_cell),
                        _or_none(new_cell) or None,
                    ),
                    documented=cur_cells.get(label, ""),
                    device=new_cell,
                    previous=old_cell or "",
                )
            )
            info_changes[label] = change
        # Rows the user added that the generator never emits are theirs alone.
        for label, cur_cell in cur_rows:
            if label not in new_by_label:
                add(
                    Change(
                        id=f"device-info.{label}",
                        name=_INFO_NAME_BY_LABEL.get(label, label),
                        kind="field",
                        status=SAME,
                        documented=cur_cell,
                        device=cur_cell,
                        previous=cur_cell,
                    )
                )

    # ── generated sections ──────────────────────────────────────────────────
    section_changes: dict[str, Change] = {}
    for name in _DEVICE_SECTIONS:
        cur_section = _find(current_blocks, name)
        new_section = _find(new_blocks, name)
        if cur_section is None and new_section is None:
            continue
        cur_text = _content_text(cur_section) if cur_section else ""
        new_text = _content_text(new_section) if new_section else ""
        baseline_section = _find(baseline_blocks, name)
        if baseline_section is not None:
            old_text = _content_text(baseline_section)
        elif name == "Hardware":
            old_text = _hardware_old_content(snapshot)
        elif name == "Properties":
            old_text = _properties_old_content(snapshot)
        else:
            old_text = None  # snapshot cannot say → conservative
        section_changes[name] = add(
            Change(
                id=f"section.{name}",
                name=name,
                kind="section",
                status=decide(
                    _or_none(cur_text), _or_none(old_text) if old_text is not None else None,
                    _or_none(new_text) or None,
                ),
                documented=cur_text,
                device=new_text,
                previous=_or_none(old_text) or "",
            )
        )

    # ── Device Information handled sectionally when the user dropped the table ─
    info_table_change: Change | None = None
    if new_info is not None and cur_info is None:
        old_text = _info_old_table(snapshot, baseline_info)
        info_table_change = add(
            Change(
                id="device-info",
                name="Device Information",
                kind="section",
                status=decide(
                    None,
                    _or_none(old_text) if old_text is not None else None,
                    _or_none(_content_text(new_info)) or None,
                ),
                documented="",
                device=_content_text(new_info),
                previous=_or_none(old_text) or "",
            )
        )

    proposed = _assemble(
        current_blocks,
        new_blocks,
        name_change=name_change,
        info_changes=info_changes,
        section_changes=section_changes,
        info_table_change=info_table_change,
    )
    if current.endswith("\n") and not proposed.endswith("\n"):
        proposed += "\n"
    return Result(changes=changes, proposed_body=proposed, summary=_summarise(changes))


# ── assembling the merged body ──────────────────────────────────────────────


def _assemble(
    current_blocks: list[Block],
    new_blocks: list[Block],
    *,
    name_change: Change,
    info_changes: dict[str, Change],
    section_changes: dict[str, Change],
    info_table_change: Change | None,
) -> str:
    blocks = [Block(level=b.level, heading=b.heading, lines=list(b.lines)) for b in current_blocks]

    if name_change.status == AUTO:
        _apply_name(blocks, name_change.device)
    elif name_change.status == CONFLICT:
        if name_change.resolution == DEVICE:
            _apply_name(blocks, name_change.device)
        elif name_change.resolution == CUSTOM and name_change.custom:
            _apply_name(blocks, name_change.custom)

    for block in blocks:
        if block.heading is None:
            continue
        if block.heading == "Device Information" and info_changes:
            _rebuild_info_table(block, info_changes)
        elif block.heading in section_changes:
            change = section_changes[block.heading]
            new_section = _find(new_blocks, block.heading)
            _apply_section(block, change, new_section)

    if current_blocks and not any(b.heading == "Device Information" for b in current_blocks) and info_table_change:
        _apply_added_table(blocks, new_blocks, info_table_change)

    for name in _DEVICE_SECTIONS:
        if any(b.heading == name for b in current_blocks):
            continue
        change = section_changes.get(name)
        new_section = _find(new_blocks, name)
        if change is None or new_section is None:
            continue
        content = _section_result(change)
        if content == "skip" or content == "remove":
            continue
        heading = new_section.lines[0]
        body_lines = ([""] + content.splitlines() + [""]) if content else []
        block = Block(
            level=_heading_level(heading), heading=name, lines=[heading, *body_lines]
        )
        _insert_before_user_sections(blocks, block)

    return "\n".join(_block_text(b) for b in blocks if not b.removed)


def _apply_section(block: Block, change: Change, new_section: Block | None) -> None:
    """Apply one device-owned section's decision to its block."""
    heading = block.lines[0] if block.lines else ""
    if change.status == SAME:
        return
    if change.status == AUTO:
        replacement = _content(new_section) if new_section else []
        block.lines = [heading, *replacement]
        return
    # CONFLICT
    result = _section_result(change)
    if result == "remove":
        block.removed = True
    elif result != "skip":
        body_lines = ([""] + result.splitlines() + [""]) if result else [""]
        block.lines = [heading, *body_lines]


def _apply_added_table(blocks: list[Block], new_blocks: list[Block], change: Change) -> None:
    """Re-introduce a Device Information table the user had removed."""
    result = _section_result(change)
    if result == "skip" or result == "remove":
        return
    new_section = _find(new_blocks, "Device Information")
    if new_section is None:
        return
    heading = new_section.lines[0]
    body_lines = ([""] + result.splitlines() + [""]) if result else [""]
    _insert_before_user_sections(
        blocks,
        Block(
            level=_heading_level(heading),
            heading="Device Information",
            lines=[heading, *body_lines],
        ),
    )


def _section_result(change: Change) -> str:
    """The replacement content for a section: literal text, or a sentinel.

    ``"skip"`` keeps the current block as-is (same / keep-user / undecided);
    ``"remove"`` drops it (device value gone and the user accepted that).
    """
    if change.status == SAME:
        return "skip"
    if change.status == AUTO:
        return change.device
    # CONFLICT
    if change.resolution is None or change.resolution == KEEP:
        return "skip"
    if change.resolution == DEVICE:
        return change.device if change.device else "remove"
    if change.resolution == CUSTOM:
        return change.custom or "remove"
    return "skip"


def _rebuild_info_table(block: Block, info_changes: dict[str, Change]) -> None:
    """Rebuild the Device Information rows according to the decisions.

    The non-data lines (the header and separator of the table, and the blank
    lines around them) stay exactly where they are; the data rows are replaced
    in place, and a label the device has but the document does not is appended
    at the end of the table when its decision calls for it.
    """
    head: list[str] = []
    cur_rows: list[tuple[str, str]] = []
    trailing: list[str] = []
    in_data = False
    for line in _content(block):
        row = _row_from_line(line)
        if row is not None:
            cur_rows.append(row)
            in_data = True
        elif in_data:
            trailing.append(line)
        else:
            head.append(line)

    rebuilt = [*head]
    seen: set[str] = set()
    for label, cur_cell in cur_rows:
        seen.add(label)
        value = _value_for(info_changes.get(label), cur_cell)
        if value is not None:
            rebuilt.append(f"| {label} | {value} |")
    for label, change in info_changes.items():
        if label in seen:
            continue
        value = _value_for(change, "")
        if value is not None:
            rebuilt.append(f"| {label} | {value} |")
    rebuilt.extend(trailing)

    block.lines = [block.lines[0] if block.lines else "## Device Information", *rebuilt]


def _value_for(change: Change | None, cur_cell: str) -> str | None:
    """The cell text a decided row should carry; None means the row stays out."""
    if change is None:
        return cur_cell
    if change.status == SAME:
        return change.documented if change.documented else None
    if change.status == AUTO:
        return change.device
    # CONFLICT
    if change.resolution is None or change.resolution == KEEP:
        return change.documented if change.documented else None
    if change.resolution == DEVICE:
        return change.device
    if change.resolution == CUSTOM:
        return cell(change.custom) if change.custom is not None else None
    return None


def _insert_before_user_sections(blocks: list[Block], block: Block) -> None:
    for index, existing in enumerate(blocks):
        if existing.heading in _USER_SECTION_NAMES:
            blocks.insert(index, block)
            return
    blocks.append(block)


def _apply_name(blocks: list[Block], name: str) -> None:
    """Rename the document in its first H1 and in the frontmatter title."""
    for block in blocks:
        if block.level == 1 and block.heading is not None:
            block.lines[0] = f"# {name}"
            break
    for block in blocks:
        if block.level == 0:
            _set_frontmatter_title(block, name)


def _set_frontmatter_title(block: Block, title: str) -> None:
    """Write the `title:` line inside the opening YAML block, if there is one."""
    lines = block.lines
    open_index = next((i for i, line in enumerate(lines) if line.strip() == "---"), None)
    if open_index is None:
        return
    close_index = next((i for i in range(open_index + 1, len(lines)) if lines[i].strip() == "---"), None)
    if close_index is None:
        return
    for i in range(open_index + 1, close_index):
        if re.match(r"^title:", lines[i]):
            lines[i] = f"title: {title}"
            return
    lines.insert(close_index, f"title: {title}")


# ── summary & fingerprint ───────────────────────────────────────────────────


def _summarise(changes: list[Change]) -> list[str]:
    lines: list[str] = []
    for change in changes:
        if change.status == SAME:
            continue
        if change.status == AUTO:
            lines.append(f"{change.name} updated to {change.device}")
        elif change.resolution == KEEP:
            lines.append(f"{change.name} kept as written")
        elif change.resolution == DEVICE:
            lines.append(f"{change.name} updated to {change.device}" if change.device else f"{change.name} removed")
        elif change.resolution == CUSTOM:
            lines.append(f"{change.name} set from your text")
    return [re.sub(r"\s+", " ", line).strip() for line in lines]


def preview_id(updated_at: str, snapshot: dict | None, body: str) -> str:
    """Stable id for a preview, so a stale save is rejected instead of overwriting.

    Binds the latest ``updated_at``, the facts the preview was computed against
    and the body it began from: any of the three moving since the modal opened
    means a new preview is needed before the resolution can be saved.
    """
    material = {
        "updated_at": updated_at,
        "snapshot": snapshot,
        "body": body,
    }
    payload = json.dumps(material, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]