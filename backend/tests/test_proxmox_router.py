"""API + persistence tests for /api/v1/proxmox/*."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.routes.proxmox import _persist_pending_import
from app.core.config import settings
from app.db.models import Node, PendingDevice


@pytest.fixture
async def headers(client: AsyncClient):
    res = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


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


def _guest_node(vmid: int, ip: str | None, status: str = "online") -> dict:
    return {
        "id": f"pve-pve1-{vmid}", "label": f"vm{vmid}", "type": "vm",
        "ieee_address": f"pve-pve1-{vmid}", "hostname": f"vm{vmid}", "ip": ip,
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
    res = await client.post(
        "/api/v1/proxmox/config",
        json={"host": "pve", "port": 8006, "verify_tls": True, "sync_enabled": True, "sync_interval": 600},
        headers=headers,
    )
    assert res.status_code == 400


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
async def test_persist_never_deletes(db_session) -> None:
    await _persist_pending_import(db_session, [_guest_node(101, "10.0.0.5")], [])
    # A later sync that no longer includes vm101 must not remove it.
    await _persist_pending_import(db_session, [_guest_node(202, "10.0.0.6")], [])
    rows = (await db_session.execute(select(PendingDevice))).scalars().all()
    ieees = {r.ieee_address for r in rows}
    assert "pve-pve1-101" in ieees and "pve-pve1-202" in ieees
