"""Fold several `device_inventory` rows describing one host into a single row.

The inventory matches on identity *when a row is created* (``find_device_for``:
ieee > ip > mac) and never looks again. A row minted while its facts were still
incomplete — a canvas node saved before anyone typed its IP, a legacy node the
3.3.0 backfill could only see by label — therefore stays a second row forever,
even once the missing address arrives and both rows plainly describe the same
machine. This module is the repair for that, in two shapes:

* :func:`merge_devices` — the user picks the survivor and what folds into it.
  The only way to collapse rows that share nothing an automatic rule can trust:
  a name is not an identity.
* :func:`reconcile_duplicates` — run after an import, collapses only what a
  shared MAC proves. Never a shared IP alone: that is not an identity.

Merging is non-destructive by construction: facts are unioned, and every
reference (`nodes`, `rack_devices`, `documents`, mesh links) is re-pointed onto
the survivor *before* the extras go. That is what separates it from the
scanner's older collapse, which deleted duplicate rows outright and left canvas
nodes naming a row that no longer existed — SQLite runs with foreign keys off
here, so the declared ``ON DELETE SET NULL`` never fires.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, InventoryDevice, InventoryDeviceLink, Node, RackDevice
from app.services.discovery_sources import add_source
from app.services.inventory_sync import (
    VIEW_LISTS,
    ip_tokens,
    merge_properties,
    merge_services,
    normalize_view_key,
    view_of_device,
)
from app.services.node_dedupe import dedupe_nodes_by_device

logger = logging.getLogger(__name__)

# Scalars the survivor fills from a loser when — and only when — it has none of
# its own. `ip`, `mac`, the lists and the timestamps are merged by rule below.
_FILL_SCALARS = (
    "hostname",
    "os",
    "suggested_type",
    "discovery_source",
    "friendly_name",
    "device_subtype",
    "model",
    "vendor",
    "lqi",
    "label",
    "type",
    "notes",
    "cpu_count",
    "cpu_model",
    "ram_gb",
    "disk_gb",
    "check_method",
    "check_target",
    "response_time_ms",
    "rack_faceplate_id",
    "rack_u_height",
    "rack_col_span",
    "rack_color",
    "rack_ports",
)


def _blank(value: Any) -> bool:
    return value is None or value == ""


def _naive(value: datetime | None) -> datetime:
    """A stored timestamp in a form two rows can be compared in.

    SQLite keeps no offset, so a row read back from the database carries a naive
    datetime while a row created in this session still holds the tz-aware value
    ``_now`` gave it — and ``expire_on_commit=False`` means no commit ever
    reconciles the two. A reconcile pass sorts exactly those two together (a
    scan is where a row first learns the MAC that proves it a duplicate), so
    comparing them raw raises ``TypeError: can't compare offset-naive and
    offset-aware datetimes`` and aborts the merge. Normalise to naive UTC before
    every comparison. ``datetime.min`` stands in for no timestamp at all, which
    the column forbids but a hand-edited database could still hold.
    """
    if value is None:
        return datetime.min
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _newest(left: datetime | None, right: datetime | None) -> datetime | None:
    if left is None or right is None:
        return left or right
    return max(left, right, key=_naive)


def _merged_ip(winner: str | None, loser: str | None) -> str | None:
    """Union of both address lists, the survivor's own addresses first.

    A device legitimately holds several addresses (a management VLAN, a second
    NIC), and dropping the loser's would undo the very match that identified it
    — the next import would mint the duplicate again.
    """
    tokens = ip_tokens(winner)
    for token in ip_tokens(loser):
        if token not in tokens:
            tokens.append(token)
    return ", ".join(tokens) or None


def _merged_status(winner: str, losers: list[InventoryDevice]) -> str:
    """The lifecycle state the survivor carries.

    ``approved`` wins over everything: a canvas node or a rack mount is about to
    point at this row, and a row that is pending or hidden would file a drawn
    device back in the discovery queue or make it vanish from the inventory.
    """
    if winner == "approved" or any(loser.status == "approved" for loser in losers):
        return "approved"
    return winner


async def _merge_documents(db: AsyncSession, winner: InventoryDevice, loser_ids: list[str]) -> int:
    """Re-point the losers' documents, or orphan them. Returns how many orphaned.

    ``documents.device_id`` is unique per device (a partial index built in
    ``init_db``), so only one document can describe the survivor. The oldest of
    the losers' is adopted when the survivor has none; the rest are unlinked
    rather than deleted — what the user wrote outlives the row it described, and
    an orphan keeps its denormalized title and can be re-linked from the Library.
    """
    docs = (
        await db.execute(
            select(Document)
            .where(Document.device_id.in_(loser_ids))
            .order_by(Document.created_at, Document.id)
        )
    ).scalars().all()
    if not docs:
        return 0

    has_own = (
        await db.execute(select(Document.id).where(Document.device_id == winner.id).limit(1))
    ).scalar_one_or_none()
    orphaned = 0
    for i, doc in enumerate(docs):
        if i == 0 and has_own is None:
            doc.device_id = winner.id
            continue
        doc.device_id = None
        orphaned += 1
    return orphaned


async def _show_merged_facts(db: AsyncSession, winner: InventoryDevice) -> int:
    """Make the survivor's facts visible on every canvas that draws it.

    A node's ``display_view`` is a whitelist: ``apply_view`` appends anything the
    view does not list *hidden*, which is what keeps a service a later scan found
    off canvases nobody has enabled it on. After a merge that rule works against
    the user — a node that came from the poorer row lists only the poorer row's
    keys, so every service and property it just gained would arrive invisible,
    and the canvas would look exactly as bare as before the merge.

    So each node drawing the survivor has the keys missing from its view appended
    as shown. Only *missing* keys: a fact this canvas listed as hidden was hidden
    on purpose and stays that way. Returns the number of nodes touched.
    """
    nodes = (
        await db.execute(select(Node).where(Node.device_id == winner.id))
    ).scalars().all()
    seeds = view_of_device(winner)
    touched = 0
    for node in nodes:
        view = dict(node.display_view or {})
        changed = False
        for kind in VIEW_LISTS:
            entries = view.get(kind)
            if not isinstance(entries, list):
                # No view at all for this list — `apply_view` already shows
                # everything the row holds, merged facts included.
                continue
            # Normalized: a view written before #469 addresses a service by a
            # key that carries its name, and comparing it raw against a freshly
            # seeded key would call an already-listed service missing.
            listed = {
                normalize_view_key(str(e.get("key")), kind)
                for e in entries
                if isinstance(e, dict)
            }
            missing = [entry for entry in seeds[kind] if entry["key"] not in listed]
            if missing:
                view[kind] = [*entries, *missing]
                changed = True
        if changed:
            # Reassign rather than mutate: a JSON column tracks identity, not
            # in-place edits, so a mutated dict would never be written back.
            node.display_view = view
            touched += 1
    return touched


async def _refresh_rack_mounts(db: AsyncSession, winner: InventoryDevice, losers: list[InventoryDevice]) -> None:
    """Point the losers' rack mounts at the survivor and refresh what they copied.

    A mount denormalizes the device's ``label`` so a rack still renders after an
    inventory purge. Re-pointing alone would leave it printing the name of a row
    that no longer exists, so a copy that still matches the loser is refreshed to
    the survivor's name — a label the user typed on the mount itself does not
    match and is left alone. The faceplate, its size and its ports are overlaid
    from the inventory row on load, and the merge already filled any the survivor
    lacked, so the plate keeps rendering as it did.
    """
    loser_ids = [row.id for row in losers]
    mounts = (
        await db.execute(select(RackDevice).where(RackDevice.device_id.in_(loser_ids)))
    ).scalars().all()
    stale = {
        name
        for row in losers
        for name in (row.label, row.friendly_name, row.hostname)
        if name
    }
    winner_name = winner.label or winner.friendly_name or winner.hostname
    for mount in mounts:
        mount.device_id = winner.id
        if winner_name and mount.label in stale:
            mount.label = winner_name


async def _rewrite_links(db: AsyncSession, winner_ieee: str, loser_ieees: list[str]) -> None:
    """Move mesh/Proxmox links off the losers' IEEEs onto the survivor's.

    ``device_inventory_links`` addresses endpoints by IEEE, not by row id, so a
    link left on a merged-away address stops resolving to anything. Rewriting
    can produce a self-link (both endpoints were the same device) or a duplicate
    pair; both are dropped.
    """
    if not loser_ieees:
        return
    links = (
        await db.execute(
            select(InventoryDeviceLink).where(
                or_(
                    InventoryDeviceLink.source_ieee.in_(loser_ieees),
                    InventoryDeviceLink.target_ieee.in_(loser_ieees),
                )
            )
        )
    ).scalars().all()
    for link in links:
        if link.source_ieee in loser_ieees:
            link.source_ieee = winner_ieee
        if link.target_ieee in loser_ieees:
            link.target_ieee = winner_ieee
    await db.flush()

    seen: set[tuple[str, str, str]] = set()
    all_links = (
        await db.execute(
            select(InventoryDeviceLink)
            .where(
                or_(
                    InventoryDeviceLink.source_ieee == winner_ieee,
                    InventoryDeviceLink.target_ieee == winner_ieee,
                )
            )
            .order_by(InventoryDeviceLink.discovered_at, InventoryDeviceLink.id)
        )
    ).scalars().all()
    for link in all_links:
        key = (link.source_ieee, link.target_ieee, link.discovery_source)
        if link.source_ieee == link.target_ieee or key in seen:
            await db.delete(link)
            continue
        seen.add(key)


def distinct_ieees(rows: list[InventoryDevice]) -> list[str]:
    """Every distinct non-blank IEEE carried by ``rows``, first spelling wins.

    ``ieee_address`` is UNIQUE and is what every other writer comes back to —
    the import matches on it before anything else, the mesh links and the
    Proxmox host→guest graph are keyed on it. A merge has exactly one row left
    at the end, so it has room for exactly one of these: any group holding two
    is a group that cannot be collapsed without destroying an identity. Callers
    use this to refuse the collapse; :func:`merge_devices` uses it to say what
    it dropped when the user asked for it anyway.
    """
    out: dict[str, str] = {}
    for row in rows:
        ieee = row.ieee_address
        if ieee and not _blank(ieee):
            out.setdefault(ieee.lower(), ieee)
    return list(out.values())


async def merge_devices(
    db: AsyncSession,
    winner: InventoryDevice,
    losers: list[InventoryDevice],
    *,
    dedupe_nodes: bool = True,
) -> dict[str, Any]:
    """Fold ``losers`` into ``winner``. Does not commit — the caller owns that.

    The survivor keeps every fact it already has; a loser only fills a gap. That
    rule is the whole safety of the operation: whichever row the user (or the
    reconcile pass) picked, nothing it recorded is overwritten by an older or
    less-curated copy, and nothing the extras recorded is lost — lists are
    unioned, addresses are unioned, sources accumulate.

    Returns counts for the caller to report.
    """
    losers = [row for row in losers if row.id != winner.id]
    if not losers:
        return {
            "merged": 0,
            "device_id": winner.id,
            "nodes_repointed": 0,
            "documents_orphaned": 0,
            "views_extended": 0,
            "ieee_dropped": [],
        }

    loser_ids = [row.id for row in losers]
    # Oldest first: where two losers both fill the same gap, the older sighting
    # is the one that has survived longest without being contradicted.
    for loser in sorted(losers, key=lambda d: (_naive(d.discovered_at), d.id)):
        for field in _FILL_SCALARS:
            if _blank(getattr(winner, field, None)):
                value = getattr(loser, field, None)
                if not _blank(value):
                    setattr(winner, field, value)
        winner.ip = _merged_ip(winner.ip, loser.ip)
        winner.mac = winner.mac or loser.mac
        # discovered=: the winner is the row the canvas points at (an approved
        # row wins `_collapse_targets`), and a loser is usually a pending row a
        # scan just minted, carrying the fingerprint's guess at a name. Both
        # rows describe one device, so two entries on one port are one service
        # — and the curated side of it is the winner's. Without this the guess
        # would overwrite a name, icon or category the user had chosen, in a
        # collapse that runs unattended during a background scan.
        winner.services = merge_services(winner.services, loser.services, discovered=True)
        winner.properties = merge_properties(winner.properties, loser.properties)
        winner.show_hardware = winner.show_hardware or loser.show_hardware
        for source in add_source(loser.discovery_sources, loser.discovery_source):
            winner.discovery_sources = add_source(winner.discovery_sources, source)
        if winner.status_live in (None, "", "unknown"):
            winner.status_live = loser.status_live
        winner.last_seen = _newest(winner.last_seen, loser.last_seen)
        winner.last_scan = _newest(winner.last_scan, loser.last_scan)
        # The device has been known since the earliest of the rows saw it.
        if loser.discovered_at and winner.discovered_at:
            winner.discovered_at = min(winner.discovered_at, loser.discovered_at, key=_naive)

    winner.status = _merged_status(winner.status, losers)

    nodes = await db.execute(
        update(Node).where(Node.device_id.in_(loser_ids)).values(device_id=winner.id)
    )
    await _refresh_rack_mounts(db, winner, losers)
    orphaned = await _merge_documents(db, winner, loser_ids)
    await db.flush()
    shown = await _show_merged_facts(db, winner)

    loser_ieees = [row.ieee_address for row in losers if row.ieee_address]
    adopted: str | None = None
    if _blank(winner.ieee_address) and loser_ieees:
        # `ieee_address` is UNIQUE, so the address can only move once the row
        # holding it is gone — assigned after the delete below.
        adopted = loser_ieees[0]

    # One row survives, so it can hold one IEEE. Every other distinct address in
    # the group goes with the row that carried it, and whatever keys on it — a
    # Proxmox import, a re-scan, a mesh writer — stops finding this device and
    # mints a fresh duplicate instead. The automatic passes refuse such a group
    # outright (`_group_candidates`, the scanner's `_collapse_targets`); reaching
    # here means the user asked for it by hand, so it is allowed and recorded
    # rather than vetoed. The mesh links themselves survive: `_rewrite_links`
    # moves them onto the survivor's address below.
    kept_ieee = adopted or winner.ieee_address
    kept_key = kept_ieee.lower() if kept_ieee else None
    ieee_dropped = [
        ieee for ieee in distinct_ieees([winner, *losers]) if ieee.lower() != kept_key
    ]
    if ieee_dropped:
        logger.warning(
            "Inventory merge: %s keeps %s and drops %d other IEEE address(es) — "
            "anything keying on %s will no longer find this device (%s)",
            winner.id, kept_ieee or "no IEEE", len(ieee_dropped),
            ", ".join(ieee_dropped), winner.label or winner.friendly_name or winner.ip,
        )

    for loser in losers:
        await db.delete(loser)
    await db.flush()

    if adopted is not None:
        winner.ieee_address = adopted
        await db.flush()
    if winner.ieee_address:
        await _rewrite_links(db, winner.ieee_address, loser_ieees)

    # Two nodes on one canvas may now draw the survivor — that is exactly the
    # same-design duplicate the node repair collapses. Batch callers set
    # dedupe_nodes=False and run dedupe_nodes_by_device once after all merges.
    if dedupe_nodes:
        await dedupe_nodes_by_device(db)
        await db.flush()

    logger.info(
        "Inventory merge: %d row(s) folded into %s (%s)",
        len(losers), winner.id, winner.label or winner.friendly_name or winner.ip,
    )
    return {
        "merged": len(losers),
        "device_id": winner.id,
        "nodes_repointed": nodes.rowcount or 0,
        "documents_orphaned": orphaned,
        "views_extended": shown,
        "ieee_dropped": ieee_dropped,
    }


def _conflicting(left: InventoryDevice, right: InventoryDevice) -> bool:
    """True when two rows carry addresses that say they are different machines.

    A distinct non-blank IEEE on each is decisive: two Proxmox guests (the
    synthetic ``pve-{host}-{vmid}``) or two radios are never one device. A
    distinct MAC says the same for hardware. Either one vetoes an automatic
    merge — the user can still merge them by hand.
    """
    if left.ieee_address and right.ieee_address and left.ieee_address.lower() != right.ieee_address.lower():
        return True
    return bool(left.mac and right.mac and left.mac != right.mac)


def _pick_winner(group: list[InventoryDevice]) -> InventoryDevice:
    """The row the others fold into.

    An IEEE first: mesh links and the Proxmox host→guest graph are keyed on it,
    and the import matches on it before anything else, so the row holding one is
    the row every other writer will come back to. Then an approved row (it is
    the one already drawn), then the oldest.
    """
    return sorted(
        group,
        key=lambda d: (
            0 if d.ieee_address else 1,
            0 if d.status == "approved" else 1,
            _naive(d.discovered_at),
            d.id,
        ),
    )[0]


def _auto_groups(rows: list[InventoryDevice]) -> list[list[InventoryDevice]]:
    """Group rows a shared MAC proves to be one device.

    The MAC and nothing else. A shared IP is not enough on its own — a re-used
    DHCP lease, two guests behind one NAT, or a container bridge address several
    guests report all make one address describe several machines — and the
    scanner already collapses what an IP does justify, under its own guard for
    rows that are drawn on a canvas. Labels and hostnames are ignored outright:
    two boxes are often called the same thing, and an automatic pass is not the
    place to decide they are one. Whatever is left over is what the manual merge
    is for.

    A group is dropped whole when any pair inside it contradicts (see
    :func:`_conflicting`) rather than guessing which member does not belong.
    """
    by_mac: dict[str, list[InventoryDevice]] = {}
    for row in rows:
        if row.mac:
            by_mac.setdefault(row.mac.lower(), []).append(row)

    out = []
    for group in by_mac.values():
        if len(group) < 2:
            continue
        pairs = [(a, b) for i, a in enumerate(group) for b in group[i + 1:]]
        if any(_conflicting(a, b) for a, b in pairs):
            logger.info(
                "Inventory reconcile: leaving %d row(s) sharing a MAC alone — "
                "their IEEE says they are different devices (%s)",
                len(group), ", ".join(row.id for row in group),
            )
            continue
        out.append(group)
    return out


async def reconcile_duplicates(db: AsyncSession) -> int:
    """Merge inventory rows a shared MAC proves to be one device. Does not commit.

    Meant to run at the end of an import, where a row that was created blind may
    have just gained the address that identifies it. Returns the number of rows
    merged away.

    Hidden rows are excluded on both sides: the user hid one deliberately, and
    folding it into a visible row would put it back in front of them, while
    folding a visible row into it would make a device they are using disappear.
    """
    rows = (
        await db.execute(
            select(InventoryDevice)
            .where(InventoryDevice.status != "hidden")
            .order_by(InventoryDevice.discovered_at, InventoryDevice.id)
        )
    ).scalars().all()

    merged = 0
    for group in _auto_groups(list(rows)):
        winner = _pick_winner(group)
        result = await merge_devices(
            db, winner, [row for row in group if row is not winner], dedupe_nodes=False
        )
        merged += int(result["merged"])
    if merged:
        await dedupe_nodes_by_device(db)
        await db.flush()
    return merged
