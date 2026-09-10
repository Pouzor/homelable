"""One-shot topology auto-placement service.

Build a topology graph from UniFi LLDP/client-association data and
SNMP/LLDP walks on infrastructure-typed devices only, then place (or
re-layout) approved devices on the target design using a BFS tier layout.
"""
import asyncio
import logging
import math
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.db.models import Edge, InventoryDevice, InventoryDeviceLink, Node

try:
    from app.services.unifi_service import fetch_unifi_topology
except ImportError:
    async def fetch_unifi_topology(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {}

try:
    from app.services.pfsense_service import fetch_dhcp_hostname_macs
except ImportError:
    async def fetch_dhcp_hostname_macs(*args: Any, **kwargs: Any) -> dict[str, str]:
        return {}

try:
    from app.services.lldp import discover_neighbors
except ImportError:
    async def discover_neighbors(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return []

logger = logging.getLogger(__name__)

# --- Layout constants ------------------------------------------------------
# Positions are slot top-left (existing convention): x = centre_x - slot/2.
INFRA_NODE_WIDTH = 320    # horizontal slot (= leaf width) for an infra device
INFRA_TIER_HEIGHT = 260   # vertical distance between infra tiers
CLIENT_NODE_WIDTH = 220   # horizontal slot per client in a group grid
CLIENT_NODE_HEIGHT = 80   # vertical slot per client row in a group grid
CLIENT_TIER_GAP = 260     # vertical gap from the deepest infra tier to the client band
CLIENT_MAX_COLS = 4       # max columns in one per-parent client group
CLIENT_GROUP_GAP = 120    # horizontal whitespace between adjacent client groups
LLDP_TIMEOUT = 5.0

# Tier-0 roots (highest in topology hierarchy)
_ROOT_TYPES = {"router", "gateway", "firewall"}

# Only walk SNMP/LLDP on infrastructure devices — end devices don't run SNMP
_INFRA_TYPES = {"router", "gateway", "firewall", "switch", "ap"}

# Hypervisors sit between the switch tier and the client band; their VMs are
# their "clients".  Not in _INFRA_TYPES so SNMP walks skip them.
_VIRTUAL_INFRA_TYPES = {"xcpng", "proxmox", "docker_host", "hub"}

# InventoryDeviceLink discovery_source values that encode hypervisor→VM edges
_VIRTUAL_LINK_SOURCES = {"xcpng_virtual", "proxmox_virtual", "manual"}


def _dev_in_types(dev: "InventoryDevice", types: set[str]) -> bool:
    """True if the device's type OR suggested_type is in types.

    Checks both fields so that devices where a generic IP scan set type='server'
    but the UniFi sync set suggested_type='switch' are still recognized.
    """
    return (
        (dev.type or "").lower() in types
        or (dev.suggested_type or "").lower() in types
    )


def _client_grid_shape(n: int) -> tuple[int, int]:
    """(cols, rows) for a group of n clients: roughly square, at most CLIENT_MAX_COLS wide."""
    if n <= 0:
        return 0, 0
    cols = min(CLIENT_MAX_COLS, max(1, math.ceil(math.sqrt(n))))
    return cols, math.ceil(n / cols)


_CLIENT_LEAF = "clients:"   # prefix for virtual tree leaves that stand in for a client group
_ORPHAN_KEY = "_orphans"    # client-group key for clients with no infra parent


def _compute_tree_layout(
    infra_ids: list[str],
    infra_tier_map: dict[str, int],
    infra_bfs_parent: dict[str, str],
    infra_adj: dict[str, set[str]],
    client_parent: dict[str, str | None],
    label_of: dict[str, str],
    virtual_infra_ids: set[str] | None = None,
) -> tuple[dict[str, tuple[float, float]], float]:
    """Tidy-tree (Reingold-Tilford style) layout for infra + grouped clients.

    Tree = the infra BFS tree, plus one *virtual leaf* per infra node that has
    clients (its "client group").  Leaves have fixed widths, every parent is
    centred over its children, and sibling subtrees never overlap horizontally,
    so no primary-tree edge passes through another node.  The client group's
    virtual leaf reserves an empty column through every tier below its parent,
    so long parent->client edges also have a clear corridor.

    Multiple roots (firewalls): the forest of tier-1 "hubs" is tidied first,
    then each root is placed at the centroid of its non-root infra neighbours
    and roots are pushed apart to INFRA_NODE_WIDTH spacing (two firewalls that
    both face one core switch end up at core.x -/+ 160).

    Returns (position, client_band_bottom_y).  ``position`` maps device id to
    slot top-left (x, y).
    """
    infra_set = set(infra_ids)
    roots = [d for d in infra_ids if infra_tier_map[d] == 0]
    root_set = set(roots)

    def _lbl(d: str) -> str:
        return label_of.get(d, d).lower()

    # -- children map from the BFS tree ------------------------------------
    children: dict[str, list[str]] = {d: [] for d in infra_ids}
    hubs: list[str] = []            # tops of the non-root forest
    for d in infra_ids:
        if d in root_set:
            continue
        p = infra_bfs_parent.get(d)
        if p in root_set or p not in infra_set:
            hubs.append(d)          # sits directly under a firewall, or unattached
        else:
            children[p].append(d)

    # -- client groups -> one virtual leaf per parent ----------------------
    groups: dict[str, list[str]] = {}
    for cid, p in client_parent.items():
        groups.setdefault(p if p in infra_set else _ORPHAN_KEY, []).append(cid)
    for cids in groups.values():
        cids.sort(key=_lbl)

    def _leaf(key: str) -> str:
        return _CLIENT_LEAF + key

    for p in infra_ids:
        kids = children[p]
        kids.sort(key=_lbl)
        if p in groups:
            # Client group sits in the middle so the parent hangs straight above it.
            kids.insert(len(kids) // 2, _leaf(p))
    hubs.sort(key=_lbl)
    if _ORPHAN_KEY in groups:
        hubs.append(_leaf(_ORPHAN_KEY))

    _virtual_infra = virtual_infra_ids or set()

    def _leaf_width(node: str) -> float:
        if node.startswith(_CLIENT_LEAF):
            key = node[len(_CLIENT_LEAF):]
            # Virtual infra hubs (hypervisors, IoT hubs) are leaf infra nodes;
            # their client group should not widen the infra tree — it will be
            # placed directly below the hub after tree layout.
            if key in _virtual_infra:
                return INFRA_NODE_WIDTH
            cols, _ = _client_grid_shape(len(groups[key]))
            return cols * CLIENT_NODE_WIDTH + CLIENT_GROUP_GAP
        return INFRA_NODE_WIDTH

    # -- pass 1: subtree widths, bottom-up --------------------------------
    width: dict[str, float] = {}

    def _measure(node: str) -> float:
        kids = children.get(node, [])
        if not kids:
            width[node] = _leaf_width(node)
        else:
            width[node] = max(INFRA_NODE_WIDTH, sum(_measure(k) for k in kids))
        return width[node]

    # -- pass 2: centre x, top-down -----------------------------------------
    cx: dict[str, float] = {}

    def _place(node: str, left: float) -> None:
        kids = children.get(node, [])
        if not kids:
            cx[node] = left + width[node] / 2
            return
        cursor = left + (width[node] - sum(width[k] for k in kids)) / 2
        for k in kids:
            _place(k, cursor)
            cursor += width[k]
        cx[node] = (cx[kids[0]] + cx[kids[-1]]) / 2

    total = sum(_measure(h) for h in hubs)
    cursor = -total / 2
    for h in hubs:
        _place(h, cursor)
        cursor += width[h]

    # -- roots: centroid of the hubs they face, then de-overlap -------------
    # Only tier-1 hubs count; deeper cross-edges (e.g. a firewall's secondary
    # link to a distribution switch) are drawn but must not drag the root.
    hub_set = set(hubs)
    wanted: list[tuple[float, str]] = []
    for r in roots:
        xs = [cx[n] for n in infra_adj.get(r, ()) if n in hub_set]
        if not xs:
            xs = [cx[n] for n in infra_adj.get(r, ()) if n in cx and n not in root_set]
        wanted.append((sum(xs) / len(xs) if xs else 0.0, r))
    wanted.sort()
    placed: list[float] = []
    for want, _ in wanted:
        placed.append(want if not placed else max(want, placed[-1] + INFRA_NODE_WIDTH))
    if placed:
        # Shift the whole root row so its centre matches the centre of the wanted xs.
        shift = (sum(w for w, _ in wanted) - sum(placed)) / len(placed)
        for (_, r), x in zip(wanted, placed, strict=False):
            cx[r] = x + shift

    # -- emit positions ------------------------------------------------------
    position: dict[str, tuple[float, float]] = {}
    for d in infra_ids:
        position[d] = (cx[d] - INFRA_NODE_WIDTH / 2, infra_tier_map[d] * INFRA_TIER_HEIGHT)

    max_tier = max(infra_tier_map[d] for d in infra_ids) if infra_ids else 0
    client_y0 = max_tier * INFRA_TIER_HEIGHT + CLIENT_TIER_GAP
    band_bottom = client_y0
    for key, cids in groups.items():
        cols, rows = _client_grid_shape(len(cids))
        # Virtual infra hubs position their client group directly below the hub
        # node (using the hub's own cx), not the wide virtual leaf cx.
        if key in _virtual_infra and key in cx:
            hub_y = infra_tier_map.get(key, max_tier) * INFRA_TIER_HEIGHT
            group_y0 = hub_y + INFRA_TIER_HEIGHT
            centre_x = cx[key]
        else:
            group_y0 = client_y0
            centre_x = cx[_leaf(key)] if _leaf(key) in cx else cx.get(key, 0.0)
        left = centre_x - (cols * CLIENT_NODE_WIDTH) / 2
        for i, cid in enumerate(cids):
            position[cid] = (
                left + (i % cols) * CLIENT_NODE_WIDTH,
                group_y0 + (i // cols) * CLIENT_NODE_HEIGHT,
            )
        band_bottom = max(band_bottom, group_y0 + rows * CLIENT_NODE_HEIGHT)

    return position, band_bottom


async def _build_topology(
    devices: list[InventoryDevice],
) -> tuple[dict[str, set[str]], dict[str, int], set[str]]:
    """Return (adjacency, stp_by_dev, confirmed_infra_ids).

    confirmed_infra_ids is the set of device IDs confirmed as real UniFi-managed
    infrastructure (appeared in /stat/device). Empty when UniFi is unconfigured.

    Sources (all non-fatal — partial results are usable):
      A. UniFi LLDP edges between infrastructure devices
      B. UniFi client-uplink associations (client -> AP/switch)
      C. SNMP/LLDP walks on infrastructure-typed approved devices only
    """
    # Build MAC / name lookup tables
    mac_to_dev: dict[str, str] = {}
    name_to_dev: dict[str, str] = {}
    dev_label: dict[str, str] = {}
    for dev in devices:
        if dev.mac:
            mac_to_dev[dev.mac.lower()] = dev.id
        if dev.hostname:
            name_to_dev[dev.hostname.lower()] = dev.id
        if dev.label:
            name_to_dev[dev.label.lower()] = dev.id
        dev_label[dev.id] = dev.label or dev.hostname or dev.ip or dev.id

    adjacency: dict[str, set[str]] = {}
    # device_id -> STP bridge priority (lower = root bridge candidate)
    stp_by_dev: dict[str, int] = {}
    # device IDs confirmed as real UniFi-managed infra (/stat/device)
    confirmed_infra_ids: set[str] = set()

    def _add_edge(dev_a: str, dev_b: str) -> None:
        if dev_a != dev_b:
            adjacency.setdefault(dev_a, set()).add(dev_b)
            adjacency.setdefault(dev_b, set()).add(dev_a)

    # --- A0. OPNsense DHCP lease aliases ------------------------------------
    # Devices with MAC randomization appear under a different MAC in UniFi
    # client_uplinks than the hardware MAC stored in the inventory. DHCP leases
    # include hostname + current MAC, so we can add the randomized MAC as an
    # alias pointing to the same device_id before processing client_uplinks.
    s = app_settings
    pfsense_url: str = getattr(s, "pfsense_url", "")
    pfsense_api_key: str = getattr(s, "pfsense_api_key", "")
    if pfsense_url and pfsense_api_key:
        dhcp_aliases = await fetch_dhcp_hostname_macs(
            base_url=pfsense_url,
            api_key=pfsense_api_key,
            verify_tls=getattr(s, "pfsense_verify_tls", True),
        )
        aliases_added = 0
        for lease_mac, hostname in dhcp_aliases.items():
            if lease_mac not in mac_to_dev:
                dev_id = name_to_dev.get(hostname.lower())
                if dev_id:
                    mac_to_dev[lease_mac] = dev_id
                    aliases_added += 1
        if aliases_added:
            logger.info("auto_place: added %d DHCP MAC aliases for randomized-MAC devices", aliases_added)

    # --- A. UniFi topology ---------------------------------------------------
    host: str = getattr(s, "unifi_effective_host", getattr(s, "unifi_host", ""))
    port: int = getattr(s, "unifi_effective_port", getattr(s, "unifi_port", 443))
    unifi_username: str = getattr(s, "unifi_username", "")
    unifi_password: str = getattr(s, "unifi_password", "")
    if host and unifi_username and unifi_password:
        try:
            topo = await fetch_unifi_topology(
                host=host,
                port=port,
                site=getattr(s, "unifi_site", "") or "default",
                username=unifi_username,
                password=unifi_password,
                verify_tls=getattr(s, "unifi_verify_tls", True),
            )
            # Infrastructure LLDP links
            resolved_lldp: list[str] = []
            unresolved_lldp: list[str] = []
            for mac_a, mac_b in topo.get("lldp_edges", []):
                dev_a = mac_to_dev.get(mac_a)
                dev_b = mac_to_dev.get(mac_b)
                if dev_a and dev_b:
                    _add_edge(dev_a, dev_b)
                    resolved_lldp.append(f"{dev_label.get(dev_a, mac_a)} ↔ {dev_label.get(dev_b, mac_b)}")
                else:
                    unresolved_lldp.append(
                        f"{mac_a}({'ok' if dev_a else 'NO'}) ↔ {mac_b}({'ok' if dev_b else 'NO'})"
                    )
            if resolved_lldp:
                logger.info("auto_place: resolved LLDP pairs:\n  %s", "\n  ".join(resolved_lldp))
            if unresolved_lldp:
                logger.info("auto_place: unresolved LLDP MACs (not in DB):\n  %s", "\n  ".join(unresolved_lldp))
                logger.info("auto_place: DB MACs for lookup: %s", ", ".join(sorted(mac_to_dev.keys())))

            # Client -> AP/switch uplinks
            unmatched_clients: list[str] = []
            unmatched_uplinks: list[str] = []
            matched_uplinks = 0
            for client_mac, uplink_mac in topo.get("client_uplinks", {}).items():
                dev_client = mac_to_dev.get(client_mac)
                dev_uplink = mac_to_dev.get(uplink_mac)
                if dev_client and dev_uplink:
                    _add_edge(dev_client, dev_uplink)
                    matched_uplinks += 1
                else:
                    if not dev_client:
                        unmatched_clients.append(client_mac)
                    if not dev_uplink:
                        unmatched_uplinks.append(uplink_mac)

            logger.info(
                "auto_place: UniFi topology — %d LLDP edges, %d client uplinks "
                "(%d resolved, %d unmatched clients, %d unmatched uplinks)",
                len(topo.get("lldp_edges", [])),
                len(topo.get("client_uplinks", {})),
                matched_uplinks,
                len(unmatched_clients),
                len(set(unmatched_uplinks)),
            )
            if unmatched_clients:
                logger.info(
                    "auto_place: unmatched client MACs (not in DB): %s",
                    ", ".join(sorted(set(unmatched_clients))[:30]),
                )
            if unmatched_uplinks:
                logger.info(
                    "auto_place: unmatched uplink MACs (AP/switch not in DB): %s",
                    ", ".join(sorted(set(unmatched_uplinks))),
                )

            # Device uplinks: each UniFi device reports its upstream device MAC.
            # Devices whose uplink MAC doesn't resolve (e.g. the router is not
            # a UniFi device) are "core" switches — wire them to every BFS root
            # so BFS can traverse the full switch hierarchy.
            root_macs: set[str] = {
                dev.mac.lower() for dev in devices
                if dev.mac and _dev_in_types(dev, _ROOT_TYPES)
            }
            core_switches: list[str] = []
            for dev_mac, uplink_mac in topo.get("device_uplinks", {}).items():
                dev_id = mac_to_dev.get(dev_mac)
                uplink_id = mac_to_dev.get(uplink_mac)
                if dev_id and uplink_id:
                    _add_edge(dev_id, uplink_id)
                elif dev_id and not uplink_id:
                    # Uplink not in DB — this device's upstream is a non-managed
                    # device (e.g. pfsense/opnsense router). Treat it as a core switch.
                    core_switches.append(dev_id)

            if core_switches:
                # Connect core switches to all BFS roots so BFS can traverse down
                root_ids = [
                    mac_to_dev[m] for m in root_macs if m in mac_to_dev
                ]
                for root_id in root_ids:
                    for core_id in core_switches:
                        _add_edge(root_id, core_id)
                logger.info(
                    "auto_place: core switch(es) wired to BFS roots: %s → %s",
                    [dev_label.get(c, c) for c in core_switches],
                    [dev_label.get(r, r) for r in root_ids],
                )

            # Confirmed infra: every device that appeared in /stat/device
            for infra_mac in topo.get("infra_macs", {}):
                dev_id = mac_to_dev.get(infra_mac)
                if dev_id:
                    confirmed_infra_ids.add(dev_id)


            # STP priorities: translate MAC keys to device IDs.
            # The STP root bridge (priority 0) is the TOR/core switch — it sits
            # directly above the firewall but pfSense/OPNsense won't appear in
            # UniFi device_uplinks.  Wire it to every BFS root so BFS places it
            # at t1 alongside other core switches.
            stp_root_ids: list[str] = []
            for stp_mac, stp_prio in topo.get("stp_priorities", {}).items():
                dev_id = mac_to_dev.get(stp_mac)
                if dev_id:
                    stp_by_dev[dev_id] = stp_prio
                    if stp_prio == 0:
                        stp_root_ids.append(dev_id)

            if stp_root_ids:
                root_ids = [mac_to_dev[m] for m in root_macs if m in mac_to_dev]
                for root_id in root_ids:
                    for stp_root in stp_root_ids:
                        if stp_root not in core_switches:
                            _add_edge(root_id, stp_root)
                logger.info(
                    "auto_place: STP root bridge(s) wired to BFS roots: %s → %s",
                    [dev_label.get(s, s) for s in stp_root_ids],
                    [dev_label.get(r, r) for r in root_ids],
                )

        except Exception as exc:
            logger.warning("auto_place: UniFi topology fetch failed: %s", exc)

    # --- B. SNMP/LLDP — infrastructure devices only -------------------------
    snmp_infra = [
        d for d in devices
        if getattr(d, "snmp_enabled", False) and d.ip
        and _dev_in_types(d, _INFRA_TYPES)
    ]

    async def _walk(dev: InventoryDevice) -> tuple[str, list[dict[str, Any]]]:
        try:
            neighbors = await asyncio.wait_for(
                discover_neighbors(
                    host=dev.ip,
                    community=getattr(dev, "snmp_community", None) or "public",
                    port=getattr(dev, "snmp_port", None) or 161,
                ),
                timeout=LLDP_TIMEOUT,
            )
        except Exception:
            neighbors = []
        return dev.id, neighbors

    if snmp_infra:
        results = await asyncio.gather(*[_walk(d) for d in snmp_infra], return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                continue
            dev_id, neighbors = result
            for n in neighbors:
                chassis = (n.get("chassis_id") or "").lower().strip()
                sys_name = (n.get("sys_name") or "").lower().strip()
                neighbor_dev_id = mac_to_dev.get(chassis) or name_to_dev.get(sys_name)
                if neighbor_dev_id:
                    _add_edge(dev_id, neighbor_dev_id)
        logger.info("auto_place: SNMP walk on %d infra device(s)", len(snmp_infra))

    return adjacency, stp_by_dev, confirmed_infra_ids


async def run_auto_place(
    design_id: str,
    db: AsyncSession,
    force: bool = False,
) -> dict[str, Any]:
    """Place (or re-layout) approved devices onto design_id using topology data.

    force=False (default): only place devices not yet on the canvas.
    force=True: reposition ALL existing nodes using the topology tier layout.

    Returns:
      nodes_placed    — new Node rows created
      nodes_moved     — existing nodes repositioned (force mode only)
      edges_created   — new Edge rows created
      skipped         — devices already on canvas (non-force mode)
    """
    # --- 1. Load devices -----------------------------------------------------
    # All non-hidden devices are placed on canvas and used for MAC/topology
    # resolution.  Using status != "hidden" (rather than status == "approved")
    # makes auto-place resilient to devices reverting to "pending" — e.g. after
    # a scan re-import — without breaking the layout.
    all_devices: list[InventoryDevice] = list((
        await db.execute(
            select(InventoryDevice).where(InventoryDevice.status != "hidden")
        )
    ).scalars().all())

    approved_devices = all_devices  # placement uses same set as topology build

    if not approved_devices:
        return {"nodes_placed": 0, "nodes_moved": 0, "edges_created": 0, "skipped": 0}

    # --- 2. Find which devices already have a node on this design ----------
    existing_nodes: list[Node] = list((
        await db.execute(select(Node).where(Node.design_id == design_id))
    ).scalars().all())

    placed_device_ids: set[str] = {
        n.device_id for n in existing_nodes if n.device_id
    }

    # --- 3. Build topology adjacency from UniFi + SNMP ---------------------
    adjacency, stp_by_dev, confirmed_infra_ids = await _build_topology(all_devices)

    # Inject xcpng_virtual / proxmox_virtual host→VM edges from InventoryDeviceLink.
    # UniFi sees the VM's MAC on the hypervisor's switch port (LLDP bleed-through),
    # so it wires the VM directly to the switch.  We correct this by:
    #   1. Adding hypervisor ↔ VM to adjacency
    #   2. Inferring hypervisor ↔ switch from the VM's UniFi-reported switch parent
    #   3. Removing the spurious VM ↔ switch edge so VMs group under their hypervisor
    ieee_to_dev_id: dict[str, str] = {
        dev.ieee_address: dev.id for dev in all_devices if dev.ieee_address
    }
    virtual_links = (await db.execute(
        select(InventoryDeviceLink).where(
            InventoryDeviceLink.discovery_source.in_(list(_VIRTUAL_LINK_SOURCES))
        )
    )).scalars().all()

    # vm_dev_id → host_dev_id (for use in client_parent and edge drawing)
    virt_host_of: dict[str, str] = {}
    for link in virtual_links:
        host_id = ieee_to_dev_id.get(link.source_ieee)
        vm_id = ieee_to_dev_id.get(link.target_ieee)
        if not host_id or not vm_id:
            continue
        virt_host_of[vm_id] = host_id
        adjacency.setdefault(host_id, set()).add(vm_id)
        adjacency.setdefault(vm_id, set()).add(host_id)

    # Resolve switch neighbors for hypervisors and clean up bleed-through edges.
    # Must run after all virt_host_of entries are populated.
    _switch_ids_for_mac: set[str] = {
        dev.id for dev in all_devices if _dev_in_types(dev, {"switch"})
    }
    for vm_id, host_id in virt_host_of.items():
        # If the host IS a switch (hub directly under a switch), skip bleed-through
        # cleanup — the vm↔switch edge is intentional, not an LLDP artifact.
        if host_id in _switch_ids_for_mac:
            continue
        for sw_id in list(adjacency.get(vm_id, set())):
            if sw_id not in _switch_ids_for_mac:
                continue
            # Wire hypervisor ↔ switch (physical uplink inferred from VM LLDP)
            adjacency.setdefault(host_id, set()).add(sw_id)
            adjacency.setdefault(sw_id, set()).add(host_id)
            # Remove the spurious VM ↔ switch edge
            adjacency[vm_id].discard(sw_id)
            adjacency[sw_id].discard(vm_id)

    if virt_host_of:
        logger.info(
            "auto_place: virtual link injection — %d hypervisor→VM pairs",
            len(virt_host_of),
        )

    devices = approved_devices
    _dev_label = {dev.id: (dev.label or dev.hostname or dev.ip or dev.id) for dev in devices}

    # --- 4. BFS tier layout from root devices ------------------------------
    roots: list[str] = [
        d.id for d in devices
        if _dev_in_types(d, _ROOT_TYPES)
    ]

    if not roots:
        if adjacency:
            approved_ids: set[str] = {d.id for d in devices}
            # 1. Lowest STP bridge priority among approved switches = root bridge.
            #    Priority 0 < 4096 < 8192 … — the switch explicitly elected as root.
            stp_candidates = {
                dev_id: prio for dev_id, prio in stp_by_dev.items()
                if dev_id in approved_ids
            }
            if stp_candidates:
                roots = [min(stp_candidates, key=stp_candidates.__getitem__)]
                logger.info(
                    "auto_place: BFS root selected by lowest STP priority (%d): %s",
                    stp_candidates[roots[0]],
                    _dev_label.get(roots[0], roots[0]),
                )
            else:
                # 2. Approved switch directly connected to a root-typed device
                #    (e.g. the switch whose port faces pfsense/opnsense).
                root_typed_ids: set[str] = {
                    d.id for d in all_devices if _dev_in_types(d, _ROOT_TYPES)
                }
                near_root = [
                    dev_id for dev_id in approved_ids
                    if any(n in root_typed_ids for n in adjacency.get(dev_id, set()))
                ]
                if near_root:
                    roots = [max(near_root, key=lambda k: len(adjacency.get(k, set())))]
                    logger.info(
                        "auto_place: BFS root selected by proximity to firewall/router: %s",
                        _dev_label.get(roots[0], roots[0]),
                    )
                else:
                    # 3. Last resort: most-connected node.
                    roots = [max(adjacency, key=lambda k: len(adjacency[k]))]
        else:
            roots = [devices[0].id]

    tier: dict[str, int] = {r: 0 for r in roots}
    queue = list(roots)
    while queue:
        current_id = queue.pop(0)
        for neighbor_id in adjacency.get(current_id, set()):
            if neighbor_id not in tier:
                tier[neighbor_id] = tier[current_id] + 1
                queue.append(neighbor_id)

    max_tier = max(tier.values(), default=0)
    for dev in devices:
        if dev.id not in tier:
            tier[dev.id] = max_tier + 1

    # --- 5. Compute positions (two-phase) ------------------------------------
    # Phase 1: place infra devices in a clean BFS tree using infra-only edges.
    # Phase 2: place all other (client) devices below, sorted by their infra
    # parent so clients of the same switch/AP appear adjacent.

    approved_set: set[str] = {d.id for d in devices}
    # AP-typed devices are only treated as infra if they appear in the UniFi
    # /stat/device response (confirmed_infra_ids) or have SNMP enabled.
    # IP/ARP scanners mistype WiFi clients (Google Nest, Chromecast, etc.) as 'ap';
    # real access points always appear in the UniFi device inventory.
    # If UniFi is unconfigured (confirmed_infra_ids empty), trust type='ap' as-is.
    infra_ids: set[str] = {
        d.id for d in devices
        if _dev_in_types(d, _INFRA_TYPES)
        and (
            not _dev_in_types(d, {"ap"})
            or not confirmed_infra_ids      # no UniFi data → trust type field
            or d.id in confirmed_infra_ids
        )
    } | {
        # Hypervisors (xcpng, proxmox, docker_host) occupy a tier between
        # switches and their guest VMs — no AP-style filter needed.
        d.id for d in devices if _dev_in_types(d, _VIRTUAL_INFRA_TYPES)
    }

    # Infra-only adjacency — both endpoints must be infra devices
    infra_adj: dict[str, set[str]] = {
        k: {v for v in vs if v in infra_ids}
        for k, vs in adjacency.items()
        if k in infra_ids
    }

    # BFS from infra roots through infra-only edges
    infra_root_ids = [r for r in roots if r in infra_ids]
    if not infra_root_ids and infra_ids:
        # roots may be firewall/router type not in approved_set — find adjacent infra
        for r in roots:
            for nbr in adjacency.get(r, set()):
                if nbr in infra_ids:
                    infra_root_ids = [nbr]
                    break
            if infra_root_ids:
                break
        if not infra_root_ids:
            infra_root_ids = [next(iter(infra_ids))]

    infra_tier_map: dict[str, int] = {r: 0 for r in infra_root_ids}
    infra_bfs_parent: dict[str, str] = {}
    infra_queue = list(infra_root_ids)
    while infra_queue:
        cur = infra_queue.pop(0)
        for nbr in infra_adj.get(cur, set()):
            if nbr not in infra_tier_map:
                infra_tier_map[nbr] = infra_tier_map[cur] + 1
                infra_bfs_parent[nbr] = cur
                infra_queue.append(nbr)

    max_infra_tier = max(infra_tier_map.values(), default=0)
    for dev_id in infra_ids:
        if dev_id in approved_set and dev_id not in infra_tier_map:
            infra_tier_map[dev_id] = max_infra_tier + 1

    # STP-priority tier override for switches: STP bridge priority directly
    # encodes the switch hierarchy (0=TOR/core, 4096=distribution, 8192=access,
    # …) in multiples of 4096.  Convert to tier: priority//4096 + 1 so the
    # STP root sits at t1 regardless of BFS hop count.  Only override switch-
    # typed devices that have STP data; APs and virtual infra are unaffected.
    _sw_ids = {d.id for d in devices if d.id in infra_ids and _dev_in_types(d, {"switch"})}
    for dev_id in _sw_ids:
        if dev_id in stp_by_dev and dev_id in infra_tier_map:
            infra_tier_map[dev_id] = stp_by_dev[dev_id] // 4096 + 1

    # Type-stratified tier adjustment: enforce the visual hierarchy
    #   t0 : firewalls / routers / gateways  (BFS roots, already at 0)
    #   t1..n : switches, ordered by STP priority (or BFS depth if no STP)
    #   t(n+1): APs, all at the same tier regardless of which switch they face
    #   (client area below)
    _ap_ids = {d.id for d in devices if d.id in infra_ids and _dev_in_types(d, {"ap"})}

    # Move all APs to one tier beyond the deepest switch; FWs stay at t0 (BFS root).
    # Do NOT adjust FW tiers — they are already at 0 as infra_root_ids, and moving
    # them to -1 then normalizing shifts every switch up by 1, creating a t1 gap.
    max_sw_tier = max((infra_tier_map[d] for d in _sw_ids if d in infra_tier_map), default=0)
    for dev_id in _ap_ids:
        if dev_id in infra_tier_map:
            infra_tier_map[dev_id] = max_sw_tier + 1

    # Infra devices that take part in the layout (approved + tiered).
    layout_infra_ids = sorted(
        (d for d in infra_tier_map if d in approved_set),
        key=lambda d: (infra_tier_map[d], _dev_label.get(d, d).lower()),
    )
    if layout_infra_ids:
        logger.info(
            "auto_place: infra layout tiers (%d devices):\n  %s",
            len(layout_infra_ids),
            "\n  ".join(
                f"{_dev_label.get(d, d)}=t{infra_tier_map[d]}" for d in layout_infra_ids
            ),
        )

    # Phase 2 input: each client's infra parent.  Prefer the deepest-tier
    # neighbour (AP over switch) and break ties by id so runs are stable.
    layout_infra_set = set(layout_infra_ids)
    client_parent: dict[str, str | None] = {}
    for dev in devices:
        if dev.id in infra_ids:
            continue
        # VMs with a known virtual hypervisor parent always group under that
        # hypervisor, overriding any UniFi LLDP bleed-through adjacency.
        virt_p = virt_host_of.get(dev.id)
        if virt_p and virt_p in layout_infra_set:
            client_parent[dev.id] = virt_p
        else:
            cands = [n for n in adjacency.get(dev.id, set()) if n in layout_infra_set]
            client_parent[dev.id] = (
                max(cands, key=lambda n: (infra_tier_map[n], n)) if cands else None
            )

    # Phase 1 + 2: tidy-tree layout of infra with per-parent client groups.
    _layout_virtual_infra = {
        d.id for d in devices
        if _dev_in_types(d, _VIRTUAL_INFRA_TYPES) and d.id in layout_infra_ids
    }
    position, fallback_y = _compute_tree_layout(
        layout_infra_ids,
        infra_tier_map,
        infra_bfs_parent,
        infra_adj,
        client_parent,
        _dev_label,
        virtual_infra_ids=_layout_virtual_infra,
    )

    # Post-process: snap virtual infra hubs (HomeBase, hypervisors) to sit
    # just to the right of their BFS parent node instead of the distant
    # Reingold-Tilford position caused by sibling-count spreading.
    # Also reposition their client groups (cameras, VMs) directly below them.
    _virt_client_groups: dict[str, list[str]] = {}
    for cid, pid in client_parent.items():
        if pid in _layout_virtual_infra:
            _virt_client_groups.setdefault(pid, []).append(cid)

    # Group sibling hubs by parent so they can be spread horizontally.
    _hubs_by_parent: dict[str, list[str]] = {}
    for hub_id in _layout_virtual_infra:
        parent_id = infra_bfs_parent.get(hub_id)
        if parent_id in position:
            _hubs_by_parent.setdefault(parent_id, []).append(hub_id)

    for parent_id, hub_ids in _hubs_by_parent.items():
        parent_x, parent_y = position[parent_id]
        # Sort siblings alphabetically for stable ordering.
        hub_ids_sorted = sorted(hub_ids, key=lambda h: _dev_label.get(h, h).lower())
        for idx, hub_id in enumerate(hub_ids_sorted):
            hub_x = parent_x + INFRA_NODE_WIDTH * (idx + 1)
            hub_y = parent_y + INFRA_TIER_HEIGHT
            position[hub_id] = (hub_x, hub_y)
            # reposition this hub's client group directly below it
            cids = sorted(_virt_client_groups.get(hub_id, []), key=lambda d: _dev_label.get(d, d).lower())
            if cids:
                cols, _ = _client_grid_shape(len(cids))
                left = hub_x + INFRA_NODE_WIDTH / 2 - (cols * CLIENT_NODE_WIDTH) / 2
                group_y = hub_y + INFRA_TIER_HEIGHT
                for i, cid in enumerate(cids):
                    position[cid] = (
                        left + (i % cols) * CLIENT_NODE_WIDTH,
                        group_y + (i // cols) * CLIENT_NODE_HEIGHT,
                    )

    # --- 6. Create / reposition Node rows ----------------------------------
    nodes_placed = 0
    nodes_moved = 0
    skipped = 0
    new_node_by_dev: dict[str, str] = {}

    existing_node_by_dev: dict[str, str] = {
        n.device_id: n.id for n in existing_nodes if n.device_id
    }
    existing_node_obj: dict[str, Node] = {
        n.device_id: n for n in existing_nodes if n.device_id
    }

    for dev in devices:
        x, y = position.get(dev.id, (0.0, fallback_y))
        if dev.id in placed_device_ids:
            if force:
                node = existing_node_obj[dev.id]
                node.pos_x = x
                node.pos_y = y
                # Sync node type from inventory so hub/ap/camera etc. stay current.
                inv_type = dev.type or dev.suggested_type or "device"
                if node.type != inv_type:
                    node.type = inv_type
                # Reset handle counts to default; edge creation will not re-expand them.
                node.bottom_handles = 1
                node.top_handles = 1
                nodes_moved += 1
            else:
                skipped += 1
            continue

        node_id = str(uuid.uuid4())
        label = dev.label or dev.hostname or dev.mac or dev.ip or dev.id
        node_type = dev.type or dev.suggested_type or "device"
        db.add(Node(
            id=node_id,
            type=node_type,
            label=label,
            design_id=design_id,
            device_id=dev.id,
            pos_x=x,
            pos_y=y,
        ))
        new_node_by_dev[dev.id] = node_id
        nodes_placed += 1

    await db.flush()

    all_node_by_dev = {**existing_node_by_dev, **new_node_by_dev}

    # --- 6b. Create groupRect nodes for each client group ------------------
    # Delete old auto-placed groupRects (type='groupRect', no device_id) so
    # force re-layout and incremental placement both produce fresh rects.
    _GROUP_RECT_PADDING = 30
    from sqlalchemy import delete as _sa_del
    await db.execute(
        _sa_del(Node).where(
            Node.design_id == design_id,
            Node.type == "groupRect",
            Node.device_id.is_(None),
        )
    )
    await db.flush()

    # Build reverse map: parent infra id → [client device ids]
    _parent_clients: dict[str | None, list[str]] = {}
    for _cid, _pid in client_parent.items():
        _parent_clients.setdefault(_pid, []).append(_cid)

    for _pid, _cids in _parent_clients.items():
        _cid_positions = [(c, position[c]) for c in _cids if c in position]
        if not _cid_positions:
            continue
        _xs = [p[0] for _, p in _cid_positions]
        _ys = [p[1] for _, p in _cid_positions]
        _rect_x = min(_xs) - _GROUP_RECT_PADDING
        _rect_y = min(_ys) - _GROUP_RECT_PADDING
        _rect_w = max(_xs) - min(_xs) + CLIENT_NODE_WIDTH + 2 * _GROUP_RECT_PADDING
        _rect_h = max(_ys) - min(_ys) + CLIENT_NODE_HEIGHT + 2 * _GROUP_RECT_PADDING
        _rect_label = _dev_label.get(_pid, "Unassigned") if _pid else "Unassigned"
        db.add(Node(
            id=str(uuid.uuid4()),
            type="groupRect",
            label=_rect_label,
            design_id=design_id,
            device_id=None,
            pos_x=_rect_x,
            pos_y=_rect_y,
            width=_rect_w,
            height=_rect_h,
        ))

    await db.flush()

    # --- 7. Create Edge rows for topology pairs ----------------------------
    existing_edges: list[Edge] = list((
        await db.execute(select(Edge).where(Edge.design_id == design_id))
    ).scalars().all())

    # On force re-layout, wipe all existing edges and redraw only infra edges.
    # This removes the old client→AP spider-web lines left from prior runs.
    if force and existing_edges:
        from sqlalchemy import delete as sa_delete
        await db.execute(sa_delete(Edge).where(Edge.design_id == design_id))
        existing_edges = []

    existing_edge_pairs: set[frozenset[str]] = {
        frozenset([e.source, e.target]) for e in existing_edges
    }

    edges_created = 0
    seen_pairs: set[frozenset[str]] = set()

    # Draw edges between infrastructure devices (switch↔switch, switch↔AP,
    # router↔switch, switch↔hypervisor).  Virtual infra (xcpng/proxmox) is
    # included so switch↔hypervisor edges are drawn.
    infra_dev_ids: set[str] = {
        d.id for d in devices
        if _dev_in_types(d, _INFRA_TYPES | _VIRTUAL_INFRA_TYPES)
    }

    for dev_id, neighbors in adjacency.items():
        if dev_id not in infra_dev_ids:
            continue
        src_node = all_node_by_dev.get(dev_id)
        if not src_node:
            continue
        for neighbor_id in neighbors:
            if neighbor_id not in infra_dev_ids:
                continue
            tgt_node = all_node_by_dev.get(neighbor_id)
            if not tgt_node:
                continue
            pair = frozenset([src_node, tgt_node])
            if pair in existing_edge_pairs or pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            src_y = position.get(dev_id, (0.0, 0.0))[1]
            tgt_y = position.get(neighbor_id, (0.0, 0.0))[1]
            if src_y <= tgt_y:
                src_handle, tgt_handle = "bottom", "top-t"
            else:
                src_handle, tgt_handle = "top", "bottom-t"
            db.add(Edge(
                id=str(uuid.uuid4()),
                source=src_node,
                target=tgt_node,
                design_id=design_id,
                type="ethernet",
                source_handle=src_handle,
                target_handle=tgt_handle,
            ))
            edges_created += 1

    # Draw hypervisor → VM edges (virtual type) for all approved vm/hypervisor pairs.
    approved_set_ids: set[str] = {d.id for d in approved_devices}
    for vm_id, host_id in virt_host_of.items():
        if vm_id not in approved_set_ids or host_id not in approved_set_ids:
            continue
        src_node = all_node_by_dev.get(host_id)
        tgt_node = all_node_by_dev.get(vm_id)
        if not src_node or not tgt_node:
            continue
        pair = frozenset([src_node, tgt_node])
        if pair in existing_edge_pairs or pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        db.add(Edge(
            id=str(uuid.uuid4()),
            source=src_node,
            target=tgt_node,
            design_id=design_id,
            type="virtual",
            source_handle="bottom",
            target_handle="top-t",
        ))
        edges_created += 1

    # Draw dashed edges from each client to its infra parent.
    # Thin dashed lines keep the canvas readable while making the connection explicit.
    for _client_dev, _parent_dev in client_parent.items():
        if not _parent_dev:
            continue
        if _client_dev not in approved_set_ids or _parent_dev not in approved_set_ids:
            continue
        _src_node = all_node_by_dev.get(_parent_dev)
        _tgt_node = all_node_by_dev.get(_client_dev)
        if not _src_node or not _tgt_node:
            continue
        _pair = frozenset([_src_node, _tgt_node])
        if _pair in existing_edge_pairs or _pair in seen_pairs:
            continue
        seen_pairs.add(_pair)
        db.add(Edge(
            id=str(uuid.uuid4()),
            source=_src_node,
            target=_tgt_node,
            design_id=design_id,
            type="ethernet",
            line_style="dashed",
            width_mult=0.5,
            source_handle="bottom",
            target_handle="top-t",
        ))
        edges_created += 1

    await db.commit()
    logger.info(
        "auto_place design=%s: placed=%d moved=%d edges=%d skipped=%d",
        design_id, nodes_placed, nodes_moved, edges_created, skipped,
    )
    return {
        "nodes_placed": nodes_placed,
        "nodes_moved": nodes_moved,
        "edges_created": edges_created,
        "skipped": skipped,
    }
