"""API + persistence tests for /api/v1/proxmox/*."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.routes.proxmox import (
    _background_proxmox_import,
    _guest_visibility_advisory,
    _persist_pending_import,
)
from app.api.routes.scan import _is_proxmox_cluster_member, _resolve_pending_links_for_ieee
from app.core.config import settings
from app.db.models import Design, Edge, Node, PendingDevice, PendingDeviceLink


@pytest.fixture(autouse=True)
def _clear_env_token():
    """Ensure a clean token state per test; restore afterwards."""
    tid, sec = settings.proxmox_token_id, settings.proxmox_token_secret
    settings.proxmox_token_id = ""
    settings.proxmox_token_secret = ""
    yield
    settings.proxmox_token_id, settings.proxmox_token_secret = tid, sec


def _host_node() -> dict:
    return {
        "id": "pve-node-pve1", "label": "pve1", "type": "proxmox",
        "ieee_address": "pve-node-pve1", "hostname": "pve1", "ip": None,
        "status": "online", "cpu_count": 8, "ram_gb": 16.0, "disk_gb": 500.0,
        "vendor": "Proxmox VE", "model": None, "parent_ieee": None,
    }


def _guest_node(vmid: int, ip: str | None, status: str = "online", mac: str | None = None) -> dict:
    return {
        "id": f"pve-pve1-{vmid}", "label": f"vm{vmid}", "type": "vm",
        "ieee_address": f"pve-pve1-{vmid}", "hostname": f"vm{vmid}", "ip": ip,
        "mac": mac,
        "status": status, "cpu_count": 2, "ram_gb": 4.0, "disk_gb": 32.0,
        "vendor": "Proxmox VE", "model": "QEMU", "vmid": vmid,
        "parent_ieee": "pve-node-pve1",
    }


# --- endpoints -------------------------------------------------------------

@pytest.mark.asyncio
async def test_test_connection_uses_body_token(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.proxmox.test_proxmox_connection", new=AsyncMock(return_value=(True, "ok"))):
        res = await client.post(
            "/api/v1/proxmox/test-connection",
            json={"host": "pve", "port": 8006, "token_id": "u@pam!t", "token_secret": "s"},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json()["connected"] is True


@pytest.mark.asyncio
async def test_missing_token_is_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/proxmox/test-connection",
        json={"host": "pve", "port": 8006},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_import_pending_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.proxmox._background_proxmox_import", new_callable=AsyncMock):
        res = await client.post(
            "/api/v1/proxmox/import-pending",
            json={"host": "pve", "port": 8006, "token_id": "u@pam!t", "token_secret": "s"},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "proxmox"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    settings.proxmox_host = "pve"
    settings.proxmox_token_id = "u@pam!t"
    settings.proxmox_token_secret = "s"
    with patch("app.api.routes.proxmox._background_proxmox_import", new_callable=AsyncMock):
        res = await client.post("/api/v1/proxmox/sync-now", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["kind"] == "proxmox"
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_token(client: AsyncClient, headers: dict) -> None:
    settings.proxmox_host = "pve"
    # _clear_env_token leaves token empty
    res = await client.post("/api/v1/proxmox/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_sync_now_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/proxmox/sync-now")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/proxmox/import-pending", json={"host": "pve"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_config_omits_token(client: AsyncClient, headers: dict) -> None:
    settings.proxmox_token_id = "u@pam!t"
    settings.proxmox_token_secret = "supersecret"
    res = await client.get("/api/v1/proxmox/config", headers=headers)
    assert res.status_code == 200
    body = res.text
    assert "supersecret" not in body
    assert res.json()["token_configured"] is True


@pytest.mark.asyncio
async def test_enable_sync_without_token_rejected(client: AsyncClient, headers: dict) -> None:
    # _clear_env_token leaves token empty → enabling auto-sync is rejected.
    res = await client.post(
        "/api/v1/proxmox/config",
        json={"sync_enabled": True, "sync_interval": 600},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_save_config_persists_only_sync_fields(client: AsyncClient, headers: dict) -> None:
    """Connection config is env-only: even if a client sends host/port/verify,
    the endpoint ignores them and persists only the sync activation."""
    settings.proxmox_host = "pve"
    settings.proxmox_token_id = "u@pam!t"
    settings.proxmox_token_secret = "s"
    saved: dict = {}
    with patch.object(type(settings), "save_overrides", lambda self: saved.update(
        host=self.proxmox_host, enabled=self.proxmox_sync_enabled, interval=self.proxmox_sync_interval
    )), patch("app.api.routes.proxmox.set_proxmox_sync_enabled"), \
            patch("app.api.routes.proxmox.reschedule_proxmox_sync"):
        res = await client.post(
            "/api/v1/proxmox/config",
            json={"host": "attacker", "port": 1, "verify_tls": False, "sync_enabled": True, "sync_interval": 900},
            headers=headers,
        )
    assert res.status_code == 200
    # host untouched by the request body; sync activation applied.
    assert settings.proxmox_host == "pve"
    assert saved == {"host": "pve", "enabled": True, "interval": 900}


@pytest.mark.asyncio
async def test_background_import_broadcasts_refresh() -> None:
    """After persisting, the import emits a scan update so an open inventory
    reloads without a manual refresh (same signal the IP scan uses)."""
    fake_db = AsyncMock()
    fake_db.get = AsyncMock(return_value=None)  # no ScanRun row → skip status update
    cm = AsyncMock()
    cm.__aenter__.return_value = fake_db
    cm.__aexit__.return_value = False

    with patch("app.api.routes.proxmox.AsyncSessionLocal", MagicMock(return_value=cm)), \
         patch("app.api.routes.proxmox.fetch_proxmox_inventory", new=AsyncMock(return_value=([], []))), \
         patch("app.api.routes.proxmox._persist_pending_import",
               new=AsyncMock(return_value=SimpleNamespace(device_count=3))), \
         patch("app.api.routes.status.broadcast_scan_update", new=AsyncMock()) as bcast:
        await _background_proxmox_import("run1", "h", 8006, "u@pam!t", "s", True)

    bcast.assert_awaited_once()
    assert bcast.await_args.kwargs["devices_found"] == 3


# --- guest-visibility advisory ---------------------------------------------

def test_advisory_when_hosts_only() -> None:
    msg = _guest_visibility_advisory([_host_node()])
    assert msg is not None
    assert "PVEAuditor" in msg


def test_no_advisory_when_guests_present() -> None:
    assert _guest_visibility_advisory([_host_node(), _guest_node(101, "10.0.0.5")]) is None


def test_no_advisory_when_nothing_imported() -> None:
    assert _guest_visibility_advisory([]) is None


# --- persistence / dedupe --------------------------------------------------

@pytest.mark.asyncio
async def test_persist_creates_pending(db_session) -> None:
    nodes = [_host_node(), _guest_node(101, "10.0.0.5")]
    edges = [{"source": "pve-node-pve1", "target": "pve-pve1-101"}]
    result = await _persist_pending_import(db_session, nodes, edges)
    assert result.pending_created == 2
    assert result.links_recorded == 1
    rows = (await db_session.execute(select(PendingDevice))).scalars().all()
    assert {r.suggested_type for r in rows} == {"proxmox", "vm"}
    # Specs carried as properties.
    vm = next(r for r in rows if r.suggested_type == "vm")
    assert any(p["key"] == "CPU Cores" for p in vm.properties)


@pytest.mark.asyncio
async def test_persist_merges_existing_scanned_node_by_ip(db_session) -> None:
    # A device previously found by an IP scan (no ieee, no specs).
    scanned = Node(
        id=str(uuid.uuid4()), type="generic", label="10.0.0.5",
        ip="10.0.0.5", status="online", pos_x=0, pos_y=0,
    )
    db_session.add(scanned)
    await db_session.commit()

    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.5")], [])

    # No duplicate node; identity + specs merged onto the existing one.
    nodes = (await db_session.execute(select(Node).where(Node.ip == "10.0.0.5"))).scalars().all()
    assert len(nodes) == 1
    merged = nodes[0]
    assert merged.ieee_address == "pve-pve1-101"
    assert merged.cpu_count == 2
    assert any(p["key"] == "CPU Cores" for p in (merged.properties or []))
    # Inventory row exists as approved (already on canvas).
    inv = (await db_session.execute(select(PendingDevice).where(PendingDevice.ieee_address == "pve-pve1-101"))).scalar_one()
    assert inv.status == "approved"


@pytest.mark.asyncio
async def test_persist_merges_pending_scan_row_by_mac(db_session) -> None:
    # Device previously found by an IP scan: arp source, MAC known, no ieee.
    db_session.add(PendingDevice(
        id=str(uuid.uuid4()), ip="10.0.0.5", mac="bc:24:11:aa:bb:cc",
        suggested_type="generic", status="pending",
        discovery_source="arp", discovery_sources=["arp"],
    ))
    await db_session.commit()

    # Proxmox import of the same box (stopped VM → no IP) but same NIC MAC in a
    # different casing. Must merge, not duplicate.
    await _persist_pending_import(db_session, [_guest_node(101, None, mac="BC:24:11:AA:BB:CC")], [])

    rows = (await db_session.execute(select(PendingDevice))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.ieee_address == "pve-pve1-101"          # adopted proxmox identity
    assert row.suggested_type == "vm"                  # kept proxmox type
    assert set(row.discovery_sources) == {"arp", "proxmox"}  # shows in both filters


@pytest.mark.asyncio
async def test_persist_preserves_ip_tag_for_legacy_null_source_row(db_session) -> None:
    # Legacy inventory row from an old IP scan, before discovery_source(s) were
    # recorded: scalar NULL, sources empty — but it has an IP + MAC.
    db_session.add(PendingDevice(
        id=str(uuid.uuid4()), ip="192.168.1.108", mac="bc:24:11:6c:96:52",
        suggested_type="lxc", status="pending",
        discovery_source=None, discovery_sources=[],
    ))
    await db_session.commit()

    await _persist_pending_import(
        db_session, [_guest_node(108, "192.168.1.108", mac="BC:24:11:6C:96:52")], []
    )

    rows = (await db_session.execute(select(PendingDevice))).scalars().all()
    assert len(rows) == 1
    # The IP tag must survive the proxmox merge even with no recorded origin.
    assert set(rows[0].discovery_sources) == {"arp", "proxmox"}


@pytest.mark.asyncio
async def test_persist_preserves_ip_tag_on_canvas_merge_legacy_row(db_session) -> None:
    # The immich case: an on-canvas node from an old scan, with a legacy
    # inventory row (NULL source). Merge must keep the IP tag on the row.
    node = Node(
        id=str(uuid.uuid4()), type="lxc", label="immich",
        ip="192.168.1.108", mac="bc:24:11:6c:96:52",
        status="online", pos_x=0, pos_y=0,
    )
    inv = PendingDevice(
        id=str(uuid.uuid4()), ip="192.168.1.108", mac="bc:24:11:6c:96:52",
        suggested_type="lxc", status="approved",
        discovery_source=None, discovery_sources=[],
    )
    db_session.add_all([node, inv])
    await db_session.commit()

    await _persist_pending_import(
        db_session, [_guest_node(108, "192.168.1.108", mac="BC:24:11:6C:96:52")], []
    )

    inv_row = (await db_session.execute(
        select(PendingDevice).where(PendingDevice.mac == "bc:24:11:6c:96:52")
    )).scalar_one()
    assert set(inv_row.discovery_sources) == {"arp", "proxmox"}


@pytest.mark.asyncio
async def test_persist_does_not_add_ip_tag_to_pure_proxmox_guest(db_session) -> None:
    # A guest first seen via Proxmox (agent IP, pve ieee) must NOT gain a spurious
    # IP tag on re-sync — it was never IP-scanned.
    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.5")], [])
    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.5")], [])  # re-sync
    row = (await db_session.execute(
        select(PendingDevice).where(PendingDevice.ieee_address == "pve-pve1-101")
    )).scalar_one()
    assert set(row.discovery_sources) == {"proxmox"}


@pytest.mark.asyncio
async def test_persist_merges_canvas_node_by_mac(db_session) -> None:
    # A scanned canvas node with a MAC but no IP recorded for the guest.
    scanned = Node(
        id=str(uuid.uuid4()), type="generic", label="box",
        mac="bc:24:11:aa:bb:cc", status="online", pos_x=0, pos_y=0,
    )
    db_session.add(scanned)
    await db_session.commit()

    await _persist_pending_import(db_session, [_guest_node(101, None, mac="BC:24:11:AA:BB:CC")], [])

    nodes = (await db_session.execute(select(Node))).scalars().all()
    assert len(nodes) == 1                              # no duplicate node
    merged = nodes[0]
    assert merged.ieee_address == "pve-pve1-101"
    assert merged.mac == "bc:24:11:aa:bb:cc"
    assert merged.cpu_count == 2                        # specs backfilled


@pytest.mark.asyncio
async def test_persist_resync_updates_in_place(db_session) -> None:
    nodes = [_guest_node(101, "10.0.0.5")]
    await _persist_pending_import(db_session, nodes, [])
    # Second sync: same device, new IP. Should update, not duplicate.
    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.9")], [])
    rows = (await db_session.execute(select(PendingDevice).where(PendingDevice.ieee_address == "pve-pve1-101"))).scalars().all()
    assert len(rows) == 1
    assert rows[0].ip == "10.0.0.9"


@pytest.mark.asyncio
async def test_persist_keeps_hidden_hidden(db_session) -> None:
    db_session.add(PendingDevice(
        id=str(uuid.uuid4()), ieee_address="pve-pve1-101", ip="10.0.0.5",
        suggested_type="vm", status="hidden", discovery_source="proxmox",
    ))
    await db_session.commit()
    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.5")], [])
    row = (await db_session.execute(select(PendingDevice).where(PendingDevice.ieee_address == "pve-pve1-101"))).scalar_one()
    assert row.status == "hidden"


@pytest.mark.asyncio
async def test_pending_endpoint_tolerates_legacy_null_properties(client: AsyncClient, headers: dict, db_session) -> None:
    # Legacy row: properties column NULL (added by migration on older DBs).
    dev = PendingDevice(
        id=str(uuid.uuid4()), ip="192.168.1.9", suggested_type="server",
        status="pending", discovery_source="arp",
    )
    dev.properties = None
    db_session.add(dev)
    await db_session.commit()
    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.status_code == 200
    assert res.json()[0]["properties"] == []


# --- cluster links ---------------------------------------------------------

@pytest.mark.asyncio
async def test_persist_records_cluster_links_between_hosts(db_session) -> None:
    # Two hosts + a guest → one host↔host cluster link, one host→guest link.
    nodes = [
        {**_host_node(), "id": "pve-node-a", "ieee_address": "pve-node-a", "hostname": "a", "label": "a"},
        {**_host_node(), "id": "pve-node-b", "ieee_address": "pve-node-b", "hostname": "b", "label": "b"},
        _guest_node(101, "10.0.0.5"),
    ]
    edges = [{"source": "pve-node-pve1", "target": "pve-pve1-101"}]
    await _persist_pending_import(db_session, nodes, edges)

    links = (await db_session.execute(select(PendingDeviceLink))).scalars().all()
    cluster = [ln for ln in links if ln.discovery_source == "proxmox_cluster"]
    assert len(cluster) == 1
    assert (cluster[0].source_ieee, cluster[0].target_ieee) == ("pve-node-a", "pve-node-b")
    # Membership helper sees both endpoints.
    assert await _is_proxmox_cluster_member(db_session, "pve-node-a") is True
    assert await _is_proxmox_cluster_member(db_session, "pve-node-b") is True
    assert await _is_proxmox_cluster_member(db_session, "pve-pve1-101") is False


@pytest.mark.asyncio
async def test_single_host_records_no_cluster_link(db_session) -> None:
    await _persist_pending_import(db_session, [_host_node()], [])
    links = (await db_session.execute(
        select(PendingDeviceLink).where(PendingDeviceLink.discovery_source == "proxmox_cluster")
    )).scalars().all()
    assert links == []


@pytest.mark.asyncio
async def test_cluster_link_resolves_to_cluster_edge(db_session) -> None:
    # Two host nodes already on a canvas + a pending cluster link between them.
    design = Design(id=str(uuid.uuid4()), name="d")
    db_session.add(design)
    a = Node(id=str(uuid.uuid4()), type="proxmox", label="a", ieee_address="pve-node-a",
             status="online", pos_x=0, pos_y=0, design_id=design.id,
             left_handles=1, right_handles=1)
    b = Node(id=str(uuid.uuid4()), type="proxmox", label="b", ieee_address="pve-node-b",
             status="online", pos_x=0, pos_y=0, design_id=design.id,
             left_handles=1, right_handles=1)
    db_session.add_all([a, b])
    db_session.add(PendingDeviceLink(
        id=str(uuid.uuid4()), source_ieee="pve-node-a", target_ieee="pve-node-b",
        discovery_source="proxmox_cluster",
    ))
    await db_session.commit()

    await _resolve_pending_links_for_ieee(db_session, "pve-node-a", design.id)

    edge = (await db_session.execute(select(Edge))).scalars().one()
    assert edge.type == "cluster"
    assert edge.source_handle == "right"
    # Bare side name (canonical) so React Flow resolves it to the left side;
    # a '-t' target would fall back to the top handle.
    assert edge.target_handle == "left"


@pytest.mark.asyncio
async def test_link_survives_and_resolves_onto_second_design(db_session) -> None:
    # Regression: approving the same mesh devices onto a second canvas must also
    # get their edges. The link row is topology, not one-shot — resolving it on
    # design A must not consume it, so design B resolves too.
    da = Design(id=str(uuid.uuid4()), name="a")
    db_ = Design(id=str(uuid.uuid4()), name="b")
    db_session.add_all([da, db_])
    # Same two devices placed on BOTH designs (one Node per canvas).
    for d in (da, db_):
        db_session.add_all([
            Node(id=str(uuid.uuid4()), type="iot", label="x", ieee_address="0xAAAA",
                 status="online", pos_x=0, pos_y=0, design_id=d.id),
            Node(id=str(uuid.uuid4()), type="iot", label="y", ieee_address="0xBBBB",
                 status="online", pos_x=0, pos_y=0, design_id=d.id),
        ])
    db_session.add(PendingDeviceLink(
        id=str(uuid.uuid4()), source_ieee="0xAAAA", target_ieee="0xBBBB",
        discovery_source="zigbee",
    ))
    await db_session.commit()

    first = await _resolve_pending_links_for_ieee(db_session, "0xAAAA", da.id)
    second = await _resolve_pending_links_for_ieee(db_session, "0xAAAA", db_.id)

    assert len(first) == 1
    assert len(second) == 1  # would be 0 if the link were consumed on design A
    # One iot edge per design, each between that design's own nodes.
    edges = (await db_session.execute(select(Edge))).scalars().all()
    assert len(edges) == 2
    assert {e.design_id for e in edges} == {da.id, db_.id}
    assert all(e.type == "iot" for e in edges)
    # The link row is still present for any further design.
    assert (await db_session.execute(select(PendingDeviceLink))).scalars().one()


@pytest.mark.asyncio
async def test_persist_never_deletes(db_session) -> None:
    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.5")], [])
    # A later sync that no longer includes vm101 must not remove it.
    await _persist_pending_import(db_session, [_guest_node(202, "10.0.0.6")], [])
    rows = (await db_session.execute(select(PendingDevice))).scalars().all()
    ieees = {r.ieee_address for r in rows}
    assert "pve-pve1-101" in ieees and "pve-pve1-202" in ieees
