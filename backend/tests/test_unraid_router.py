"""API + persistence tests for /api/v1/unraid/*."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.routes.unraid import _background_unraid_import, _persist_pending_import
from app.core.config import settings
from app.db.models import InventoryDevice, InventoryDeviceLink, Node

HOST = "unraid-host-abc"


@pytest.fixture(autouse=True)
def _clear_env():
    """A clean env-config state per test; restored afterwards."""
    saved = (settings.unraid_host, settings.unraid_port, settings.unraid_api_key, settings.unraid_verify_tls)
    settings.unraid_host = ""
    settings.unraid_port = 443
    settings.unraid_api_key = ""
    settings.unraid_verify_tls = False
    yield
    settings.unraid_host, settings.unraid_port, settings.unraid_api_key, settings.unraid_verify_tls = saved


def _host(ip: str = "10.1.1.231", mac: str = "a0:36:9f:77:f9:44") -> dict:
    return {
        "id": HOST, "label": "Pearl", "type": "docker_host", "ieee_address": HOST,
        "hostname": "Pearl", "ip": ip, "mac": mac, "status": "online",
        "cpu_count": 20, "cpu_model": "i5", "vendor": "Unraid", "model": "MSI",
        "os_version": "Unraid 7.3.1", "parent_ieee": None,
    }


def _ct(name: str, status: str = "online", ip: str | None = None) -> dict:
    ieee = f"unraid-abc-ct-{name}"
    return {
        "id": ieee, "label": name, "type": "docker_container", "ieee_address": ieee,
        "hostname": name, "ip": ip, "mac": None, "status": status,
        "vendor": "Docker", "model": f"img/{name}", "network": "bridge",
        "ports": [], "services": [], "compose_project": None, "parent_ieee": HOST,
    }


def _inventory(*containers: dict) -> tuple[list[dict], list[dict]]:
    nodes = [_host(), *containers]
    return nodes, [{"source": HOST, "target": c["id"]} for c in containers]


def _fetched(*guests: dict, notice: str | None = None) -> tuple[list[dict], list[dict], str | None]:
    """What fetch_unraid_inventory returns: nodes, edges and the VM notice."""
    return (*_inventory(*guests), notice)


def _vm(name: str, status: str = "online") -> dict:
    ieee = f"unraid-abc-vm-{name}-uuid"
    return {
        "id": ieee, "label": name, "type": "vm", "ieee_address": ieee,
        "hostname": name, "ip": None, "mac": None, "status": status,
        "vendor": "Unraid", "model": "KVM", "uuid": f"{name}-uuid",
        "services": [], "parent_ieee": HOST,
    }


BODY = {"host": "pearl", "port": 443, "api_key": "k"}
WEB_UI = {
    "port": 32400, "protocol": "tcp", "service_name": "Web UI",
    "host": "http://10.1.1.231:32400", "path": "/web/index.html",
}


# --- endpoints -------------------------------------------------------------

@pytest.mark.asyncio
async def test_custom_host_without_key_is_rejected(client: AsyncClient, headers: dict) -> None:
    settings.unraid_host = "pearl"
    settings.unraid_api_key = "envkey"
    res = await client.post("/api/v1/unraid/test-connection", json={"host": "evil", "port": 443}, headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_env_key_used_for_configured_host(client: AsyncClient, headers: dict) -> None:
    settings.unraid_host = "pearl"
    settings.unraid_api_key = "envkey"
    with patch("app.api.routes.unraid.test_unraid_connection", new=AsyncMock(return_value=(True, "ok"))) as t:
        res = await client.post("/api/v1/unraid/test-connection", json={"host": "Pearl", "port": 443}, headers=headers)
    assert res.status_code == 200
    assert t.await_args.kwargs["api_key"] == "envkey"


@pytest.mark.asyncio
async def test_env_key_refused_with_tls_verification_off(client: AsyncClient, headers: dict) -> None:
    settings.unraid_host = "pearl"
    settings.unraid_api_key = "envkey"
    settings.unraid_verify_tls = True
    res = await client.post(
        "/api/v1/unraid/test-connection",
        json={"host": "pearl", "port": 443, "verify_tls": False},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/unraid/import", json=BODY)
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_import_pending_creates_scan_run(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.unraid._background_unraid_import", new_callable=AsyncMock) as bg:
        res = await client.post("/api/v1/unraid/import-pending", json={**BODY, "offline_containers": "skip"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["kind"] == "unraid"
    # include_offline is the last positional argument.
    assert bg.call_args.args[-1] is False


@pytest.mark.asyncio
async def test_sync_now_rejected_without_env(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/unraid/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_config_omits_key(client: AsyncClient, headers: dict) -> None:
    settings.unraid_api_key = "supersecret"
    res = await client.get("/api/v1/unraid/config", headers=headers)
    assert res.status_code == 200
    assert "supersecret" not in res.text
    assert res.json()["api_key_configured"] is True


@pytest.mark.asyncio
async def test_save_config_persists_only_sync_fields(client: AsyncClient, headers: dict) -> None:
    settings.unraid_host = "pearl"
    settings.unraid_api_key = "k"
    with patch.object(type(settings), "save_overrides", lambda self: None), \
            patch("app.api.routes.unraid.set_unraid_sync_enabled"), \
            patch("app.api.routes.unraid.reschedule_unraid_sync"):
        res = await client.post(
            "/api/v1/unraid/config",
            json={"host": "attacker", "sync_enabled": True, "sync_interval": 900, "include_offline": False},
            headers=headers,
        )
    assert res.status_code == 200
    assert settings.unraid_host == "pearl"
    assert settings.unraid_sync_interval == 900
    assert settings.unraid_sync_include_offline is False


@pytest.mark.asyncio
async def test_background_import_broadcasts_refresh() -> None:
    fake_db = AsyncMock()
    fake_db.get = AsyncMock(return_value=None)
    cm = AsyncMock()
    cm.__aenter__.return_value = fake_db
    cm.__aexit__.return_value = False
    with patch("app.api.routes.unraid.AsyncSessionLocal", MagicMock(return_value=cm)), \
         patch("app.api.routes.unraid.fetch_unraid_inventory", new=AsyncMock(return_value=([], [], None))), \
         patch("app.api.routes.unraid._persist_pending_import",
               new=AsyncMock(return_value=SimpleNamespace(device_count=3))), \
         patch("app.api.routes.status.broadcast_scan_update", new=AsyncMock()) as bcast:
        await _background_unraid_import("run1", "h", 443, "k", True, True)
    bcast.assert_awaited_once()


# --- offline policy on the canvas import -------------------------------------

async def _canvas_import(client: AsyncClient, headers: dict, offline: str) -> dict:
    inv = _fetched(_ct("plex"), _ct("old", status="offline"), _vm("winvm", status="offline"))
    with patch("app.api.routes.unraid.fetch_unraid_inventory", new=AsyncMock(return_value=inv)):
        res = await client.post("/api/v1/unraid/import", json={**BODY, "offline_containers": offline}, headers=headers)
    assert res.status_code == 200
    return res.json()


async def _stored_names(db_session) -> set[str]:
    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    return {r.hostname for r in rows}


@pytest.mark.asyncio
async def test_canvas_import_skip_offline(client: AsyncClient, headers: dict, db_session) -> None:
    data = await _canvas_import(client, headers, "skip")
    assert {n["label"] for n in data["nodes"]} == {"Pearl", "plex"}
    assert await _stored_names(db_session) == {"Pearl", "plex"}


@pytest.mark.asyncio
async def test_canvas_import_offline_to_inventory_only(client: AsyncClient, headers: dict, db_session) -> None:
    data = await _canvas_import(client, headers, "inventory")
    assert {n["label"] for n in data["nodes"]} == {"Pearl", "plex"}
    assert len(data["edges"]) == 1
    assert await _stored_names(db_session) == {"Pearl", "plex", "old", "winvm"}


@pytest.mark.asyncio
async def test_canvas_import_offline_to_canvas(client: AsyncClient, headers: dict, db_session) -> None:
    data = await _canvas_import(client, headers, "canvas")
    assert {n["label"] for n in data["nodes"]} == {"Pearl", "plex", "old", "winvm"}
    assert len(data["edges"]) == 3
    # Every node points at the inventory row the import created.
    assert all(n["device_id"] for n in data["nodes"])


@pytest.mark.asyncio
async def test_canvas_nodes_carry_the_row_lists(client: AsyncClient, headers: dict) -> None:
    # A dropped node's first save replaces the row's lists with the node's, so
    # the node must already hold what the import wrote.
    plex = {**_ct("plex"), "services": [WEB_UI]}
    with patch("app.api.routes.unraid.fetch_unraid_inventory", new=AsyncMock(return_value=_fetched(plex))):
        res = await client.post("/api/v1/unraid/import", json=BODY, headers=headers)
    node = next(n for n in res.json()["nodes"] if n["label"] == "plex")
    assert node["services"] == [WEB_UI]
    assert {p["key"] for p in node["properties"]} >= {"Image", "Source"}


@pytest.mark.asyncio
async def test_canvas_import_returns_the_vm_notice(client: AsyncClient, headers: dict) -> None:
    inv = _fetched(_ct("plex"), notice="VMs were not imported: no access")
    with patch("app.api.routes.unraid.fetch_unraid_inventory", new=AsyncMock(return_value=inv)):
        res = await client.post("/api/v1/unraid/import", json=BODY, headers=headers)
    assert res.json()["notice"] == "VMs were not imported: no access"


@pytest.mark.asyncio
async def test_background_import_records_the_vm_notice_on_the_run(db_session) -> None:
    from app.db.models import ScanRun

    run = ScanRun(status="running", kind="unraid", ranges=["pearl:443"])
    db_session.add(run)
    await db_session.commit()
    inv = _fetched(_ct("plex"), notice="VMs were not imported: no access")
    with patch("app.api.routes.unraid.fetch_unraid_inventory", new=AsyncMock(return_value=inv)), \
         patch("app.api.routes.status.broadcast_scan_update", new=AsyncMock()):
        await _background_unraid_import(run.id, "pearl", 443, "k", False, True)
    await db_session.refresh(run)
    assert run.status == "done"
    assert run.error == "VMs were not imported: no access"


# --- persistence ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_persist_creates_rows_and_links(db_session) -> None:
    nodes, edges = _inventory(_ct("plex"))
    result = await _persist_pending_import(db_session, nodes, edges)
    assert result.pending_created == 2
    assert result.links_recorded == 1
    host = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.ieee_address == HOST)
    )).scalar_one()
    assert host.suggested_type == "docker_host"
    assert host.os == "Unraid 7.3.1"
    assert host.discovery_sources == ["unraid"]


@pytest.mark.asyncio
async def test_persist_stores_a_vm_linked_to_its_host(db_session) -> None:
    nodes, edges = _inventory(_vm("winvm"))
    await _persist_pending_import(db_session, nodes, edges)
    vm = (await db_session.execute(
        select(InventoryDevice).where(InventoryDevice.suggested_type == "vm")
    )).scalar_one()
    assert vm.ieee_address == "unraid-abc-vm-winvm-uuid"
    assert {p["key"]: p["value"] for p in vm.properties}["UUID"] == "winvm-uuid"
    link = (await db_session.execute(select(InventoryDeviceLink))).scalar_one()
    assert (link.source_ieee, link.target_ieee) == (HOST, vm.ieee_address)


@pytest.mark.asyncio
async def test_persist_merges_host_into_scanned_row(db_session) -> None:
    scanned = InventoryDevice(
        id=str(uuid.uuid4()), ip="10.1.1.231", mac="a0:36:9f:77:f9:44",
        discovery_source="arp", discovery_sources=["arp"], status="pending",
    )
    db_session.add(scanned)
    await db_session.commit()

    await _persist_pending_import(db_session, [_host()], [])

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 1
    assert rows[0].ieee_address == HOST
    assert set(rows[0].discovery_sources) == {"arp", "unraid"}


@pytest.mark.asyncio
async def test_host_never_merges_into_an_ipvlan_container_row(db_session) -> None:
    # A scan files an ipvlan container as its own IP with the host's MAC. That
    # row is older than the host's own row, which UniFi already claimed (so the
    # unclaimed-IP step skips it); the host must still find its own row.
    container_row = InventoryDevice(
        id=str(uuid.uuid4()), ip="10.1.1.198", mac="a0:36:9f:77:f9:44",
        discovery_source="arp", discovery_sources=["arp"], status="pending",
    )
    db_session.add(container_row)
    await db_session.commit()
    host_row = InventoryDevice(
        id=str(uuid.uuid4()), ip="10.1.1.231", mac="a0:36:9f:77:f9:44",
        ieee_address="unifi-a0:36:9f:77:f9:44",
        discovery_source="unifi-client", discovery_sources=["unifi-client"], status="pending",
    )
    db_session.add(host_row)
    await db_session.commit()

    await _persist_pending_import(db_session, [_host()], [])

    await db_session.refresh(container_row)
    await db_session.refresh(host_row)
    assert host_row.ieee_address == HOST
    assert container_row.ieee_address is None


@pytest.mark.asyncio
async def test_persist_merges_ipvlan_container_by_ip(db_session) -> None:
    scanned = InventoryDevice(
        id=str(uuid.uuid4()), ip="10.1.1.198", discovery_source="arp",
        discovery_sources=["arp"], status="pending",
    )
    db_session.add(scanned)
    await db_session.commit()

    await _persist_pending_import(db_session, [_ct("netdata", ip="10.1.1.198")], [])

    await db_session.refresh(scanned)
    assert scanned.ieee_address == _ct("netdata")["ieee_address"]
    assert scanned.suggested_type == "docker_container"


@pytest.mark.asyncio
async def test_ip_match_skips_rows_another_importer_owns(db_session) -> None:
    guest = InventoryDevice(
        id=str(uuid.uuid4()), ip="10.1.1.198", ieee_address="pve-pve1-101",
        discovery_source="proxmox", discovery_sources=["proxmox"], status="pending",
    )
    db_session.add(guest)
    await db_session.commit()

    await _persist_pending_import(db_session, [_ct("netdata", ip="10.1.1.198")], [])

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    assert len(rows) == 2
    await db_session.refresh(guest)
    assert guest.ieee_address == "pve-pve1-101"


@pytest.mark.asyncio
async def test_web_ui_service_is_stored_and_a_rename_survives(db_session) -> None:
    plex = {**_ct("plex"), "services": [WEB_UI]}
    await _persist_pending_import(db_session, [plex], [])
    row = (await db_session.execute(select(InventoryDevice))).scalar_one()
    assert row.services == [WEB_UI]

    row.services = [{**WEB_UI, "service_name": "Plex"}]
    await db_session.commit()
    await _persist_pending_import(db_session, [plex], [])

    await db_session.refresh(row)
    assert len(row.services) == 1
    assert row.services[0]["service_name"] == "Plex"


@pytest.mark.asyncio
async def test_reimport_keeps_status(db_session) -> None:
    nodes, edges = _inventory(_ct("plex"))
    await _persist_pending_import(db_session, nodes, edges)
    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    host = next(r for r in rows if r.ieee_address == HOST)
    plex = next(r for r in rows if r.ieee_address != HOST)
    host.status = "approved"
    plex.status = "hidden"
    db_session.add(Node(id=str(uuid.uuid4()), type="docker_host", label="Pearl", device_id=host.id, pos_x=0, pos_y=0))
    await db_session.commit()

    await _persist_pending_import(db_session, nodes, edges)

    await db_session.refresh(host)
    await db_session.refresh(plex)
    assert host.status == "approved"
    assert plex.status == "hidden"


@pytest.mark.asyncio
async def test_approved_but_undrawn_row_is_revived(db_session) -> None:
    nodes, edges = _inventory()
    await _persist_pending_import(db_session, nodes, edges)
    host = (await db_session.execute(select(InventoryDevice))).scalar_one()
    host.status = "approved"
    await db_session.commit()

    await _persist_pending_import(db_session, nodes, edges)

    await db_session.refresh(host)
    assert host.status == "pending"


@pytest.mark.asyncio
async def test_links_replaced_per_host_only(db_session) -> None:
    other = "unraid-host-other"
    db_session.add(InventoryDeviceLink(source_ieee=other, target_ieee="unraid-other-ct-x", discovery_source="unraid"))
    await db_session.commit()

    nodes, edges = _inventory(_ct("plex"))
    await _persist_pending_import(db_session, nodes, edges)
    await _persist_pending_import(db_session, nodes, edges)

    links = (await db_session.execute(select(InventoryDeviceLink))).scalars().all()
    assert {(link.source_ieee, link.target_ieee) for link in links} == {
        (other, "unraid-other-ct-x"),
        (HOST, _ct("plex")["ieee_address"]),
    }
