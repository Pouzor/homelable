"""GET /api/v1/scan/pending/{id}/proxmox-children.

Resolves the host -> guest links the Proxmox import records into the inventory
rows the UI needs to offer "add the guests too" when a host reaches a canvas.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InventoryDevice, InventoryDeviceLink


async def _seed(db: AsyncSession) -> dict[str, str]:
    host = InventoryDevice(
        ieee_address="pve-node-pve1", hostname="pve1", suggested_type="proxmox", status="pending"
    )
    vm = InventoryDevice(
        ieee_address="pve-pve1-101", hostname="web", suggested_type="vm", status="pending"
    )
    lxc = InventoryDevice(
        ieee_address="pve-pve1-102", hostname="dns", suggested_type="lxc", status="pending"
    )
    other = InventoryDevice(ip="192.168.1.9", hostname="nas", status="pending")
    db.add_all([host, vm, lxc, other])
    await db.flush()
    db.add_all([
        InventoryDeviceLink(
            source_ieee="pve-node-pve1", target_ieee="pve-pve1-101", discovery_source="proxmox"
        ),
        InventoryDeviceLink(
            source_ieee="pve-node-pve1", target_ieee="pve-pve1-102", discovery_source="proxmox"
        ),
    ])
    await db.commit()
    return {"host": host.id, "vm": vm.id, "lxc": lxc.id, "other": other.id}


@pytest.mark.asyncio
async def test_returns_the_guests_of_a_host(client: AsyncClient, headers, db_session):
    ids = await _seed(db_session)
    res = await client.get(f"/api/v1/scan/pending/{ids['host']}/proxmox-children", headers=headers)
    assert res.status_code == 200
    assert {d["id"] for d in res.json()} == {ids["vm"], ids["lxc"]}


@pytest.mark.asyncio
async def test_empty_for_a_guest(client: AsyncClient, headers, db_session):
    ids = await _seed(db_session)
    res = await client.get(f"/api/v1/scan/pending/{ids['vm']}/proxmox-children", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_empty_for_a_device_with_no_ieee(client: AsyncClient, headers, db_session):
    ids = await _seed(db_session)
    res = await client.get(f"/api/v1/scan/pending/{ids['other']}/proxmox-children", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_skips_hidden_guests(client: AsyncClient, headers, db_session):
    ids = await _seed(db_session)
    lxc = await db_session.get(InventoryDevice, ids["lxc"])
    lxc.status = "hidden"
    await db_session.commit()
    res = await client.get(f"/api/v1/scan/pending/{ids['host']}/proxmox-children", headers=headers)
    assert [d["id"] for d in res.json()] == [ids["vm"]]


@pytest.mark.asyncio
async def test_ignores_cluster_links(client: AsyncClient, headers, db_session):
    """A host↔host cluster link is not a parent/child relation."""
    ids = await _seed(db_session)
    peer = InventoryDevice(
        ieee_address="pve-node-pve2", hostname="pve2", suggested_type="proxmox", status="pending"
    )
    db_session.add(peer)
    db_session.add(
        InventoryDeviceLink(
            source_ieee="pve-node-pve1",
            target_ieee="pve-node-pve2",
            discovery_source="proxmox_cluster",
        )
    )
    await db_session.commit()
    res = await client.get(f"/api/v1/scan/pending/{ids['host']}/proxmox-children", headers=headers)
    assert {d["id"] for d in res.json()} == {ids["vm"], ids["lxc"]}


@pytest.mark.asyncio
async def test_404_for_an_unknown_device(client: AsyncClient, headers):
    res = await client.get("/api/v1/scan/pending/nope/proxmox-children", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_requires_auth(client: AsyncClient, db_session):
    ids = await _seed(db_session)
    res = await client.get(f"/api/v1/scan/pending/{ids['host']}/proxmox-children")
    assert res.status_code == 401
