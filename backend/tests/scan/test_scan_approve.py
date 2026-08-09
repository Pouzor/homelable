"""Approve / hide / restore / ignore / bulk device flows and conflict handling."""
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models import Design, InventoryDevice, Node
from tests.scan.helpers import _add_design, _node


@pytest.mark.asyncio
async def test_canvas_count_ignores_nodes_without_design(client, headers, db_session, pending_device):
    # A node with no design_id is not "on a canvas".
    db_session.add(_node(None, ip="192.168.1.100"))
    await db_session.commit()

    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.json()[0]["canvas_count"] == 0


@pytest.mark.asyncio
async def test_approve_device(client: AsyncClient, headers, pending_device):
    node_payload = {
        "label": "My Server",
        "type": "server",
        "ip": "192.168.1.100",
        "hostname": "my-server",
        "status": "unknown",
        "services": [],
    }
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json=node_payload,
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] is True
    assert "node_id" in data

    # Approved devices stay in the inventory (status != "hidden") so they keep
    # showing with an "In N canvas" badge — they are no longer dropped.
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    inventory = pending_res.json()
    assert len(inventory) == 1
    assert inventory[0]["id"] == pending_device.id
    assert inventory[0]["status"] == "approved"


@pytest.mark.asyncio
async def test_approve_device_conflicts_on_existing_ieee_same_design(
    client: AsyncClient, headers, db_session
):
    """Approving a device whose IEEE is already on the target design prompts the
    user (409) instead of silently merging/replacing — same UX as ip/mac."""
    design = Design(name="d1")
    db_session.add(design)
    await db_session.flush()
    existing = Node(
        label="sensor", type="zigbee_enddevice", ieee_address="0xZZZ",
        services=[], design_id=design.id,
    )
    db_session.add(existing)
    device = InventoryDevice(
        id=str(uuid.uuid4()), ieee_address="0xZZZ", suggested_type="zigbee_enddevice",
        status="pending", discovery_source="zigbee",
    )
    db_session.add(device)
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{device.id}/approve",
        json={
            "label": "sensor", "type": "zigbee_enddevice",
            "status": "online", "services": [], "design_id": design.id,
        },
        headers=headers,
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["duplicate"] is True
    assert detail["existing_node_id"] == existing.id
    assert detail["match"] == "ieee"
    assert detail["value"] == "0xZZZ"

    # No second node created; device stays pending until the user decides.
    nodes = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xZZZ"))
    ).scalars().all()
    assert len(nodes) == 1


@pytest.mark.asyncio
async def test_approve_device_force_creates_duplicate_ieee(
    client: AsyncClient, headers, db_session
):
    """force=True lets the user place a second card for the same IEEE."""
    design = Design(name="d1")
    db_session.add(design)
    await db_session.flush()
    db_session.add(Node(
        label="sensor", type="zigbee_enddevice", ieee_address="0xZZZ",
        services=[], design_id=design.id,
    ))
    device = InventoryDevice(
        id=str(uuid.uuid4()), ieee_address="0xZZZ", suggested_type="zigbee_enddevice",
        status="pending", discovery_source="zigbee",
    )
    db_session.add(device)
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{device.id}/approve",
        json={
            "label": "sensor", "type": "zigbee_enddevice", "status": "online",
            "services": [], "design_id": design.id, "force": True,
        },
        headers=headers,
    )
    assert res.status_code == 200
    nodes = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xZZZ"))
    ).scalars().all()
    assert len(nodes) == 2


@pytest.mark.asyncio
async def test_approve_device_conflicts_on_existing_ip(
    client: AsyncClient, headers, db_session, pending_device
):
    """An ordinary host whose ip already sits on the target design is NOT
    silently duplicated: the approve returns 409 with the existing node so the
    UI can ask the user."""
    design = await _add_design(db_session, "Home")
    existing = _node(design, ip="192.168.1.100")
    db_session.add(existing)
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "dup", "type": "server", "ip": "192.168.1.100",
              "status": "unknown", "services": [], "design_id": design},
        headers=headers,
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["duplicate"] is True
    assert detail["existing_node_id"] == existing.id
    assert detail["match"] == "ip"
    assert detail["value"] == "192.168.1.100"

    # No node created, device left pending (user hasn't decided yet).
    nodes = (await db_session.execute(select(Node).where(Node.design_id == design))).scalars().all()
    assert len(nodes) == 1
    await db_session.refresh(pending_device)
    assert pending_device.status == "pending"


@pytest.mark.asyncio
async def test_approve_device_conflicts_on_existing_mac(
    client: AsyncClient, headers, db_session, pending_device
):
    """MAC match (device re-IP'd via DHCP) also triggers the duplicate guard."""
    design = await _add_design(db_session, "Home")
    existing = Node(id=str(uuid.uuid4()), label="n", type="server", status="online",
                    ip="10.0.0.9", mac="aa:bb:cc:dd:ee:ff", services=[], design_id=design)
    db_session.add(existing)
    await db_session.commit()

    # pending_device carries mac aa:bb:cc:dd:ee:ff but a different ip.
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "dup", "type": "server", "ip": "192.168.1.55",
              "mac": "aa:bb:cc:dd:ee:ff", "status": "unknown", "services": [],
              "design_id": design},
        headers=headers,
    )
    assert res.status_code == 409
    assert res.json()["detail"]["match"] == "mac"


@pytest.mark.asyncio
async def test_approve_device_conflicts_on_ip_in_comma_list(
    client: AsyncClient, headers, db_session, pending_device
):
    """The existing node's ip holds an IPv6 before the IPv4 the device scanned
    as. Exact-string matching missed it (issue #258); per-token matching catches
    the duplicate."""
    design = await _add_design(db_session, "Home")
    existing = _node(design, ip="fe80::1, 192.168.1.100")
    db_session.add(existing)
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "dup", "type": "server", "ip": "192.168.1.100",
              "status": "unknown", "services": [], "design_id": design},
        headers=headers,
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["existing_node_id"] == existing.id
    assert detail["match"] == "ip"
    assert detail["value"] == "192.168.1.100"


@pytest.mark.asyncio
async def test_approve_device_no_conflict_on_ip_substring(
    client: AsyncClient, headers, db_session, pending_device
):
    """The ip guard must match whole addresses, not substrings: a node at
    10.0.0.40 is not a duplicate of a device at 10.0.0.4."""
    design = await _add_design(db_session, "Home")
    db_session.add(_node(design, ip="10.0.0.40"))
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "new", "type": "server", "ip": "10.0.0.4",
              "mac": None, "status": "unknown", "services": [], "design_id": design},
        headers=headers,
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_approve_device_force_creates_duplicate(
    client: AsyncClient, headers, db_session, pending_device
):
    """force=True (user confirmed) bypasses the guard and creates the node."""
    design = await _add_design(db_session, "Home")
    db_session.add(_node(design, ip="192.168.1.100"))
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "dup", "type": "server", "ip": "192.168.1.100",
              "status": "unknown", "services": [], "design_id": design, "force": True},
        headers=headers,
    )
    assert res.status_code == 200
    nodes = (await db_session.execute(select(Node).where(Node.design_id == design))).scalars().all()
    assert len(nodes) == 2  # duplicate deliberately created


@pytest.mark.asyncio
async def test_approve_device_allows_same_ip_on_other_design(
    client: AsyncClient, headers, db_session, pending_device
):
    """The guard is per-design: the same host on a different canvas is fine."""
    other = await _add_design(db_session, "Lab")
    target = await _add_design(db_session, "Home")
    db_session.add(_node(other, ip="192.168.1.100"))  # exists on a DIFFERENT design
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "ok", "type": "server", "ip": "192.168.1.100",
              "status": "unknown", "services": [], "design_id": target},
        headers=headers,
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_approve_device_places_already_approved_on_another_design(
    client: AsyncClient, headers, db_session
):
    """A device already approved on ANOTHER canvas (global status="approved")
    must still be placeable on a new design — status is global, canvas
    membership is per-design (mirrors bulk_approve)."""
    other = await _add_design(db_session, "Other")
    target = await _add_design(db_session, "Network Topology")
    # Device is on `other` already (its global status is "approved").
    db_session.add(_node(other, ieee="0x00158d0005292b83"))
    device = InventoryDevice(
        id=str(uuid.uuid4()), ieee_address="0x00158d0005292b83",
        suggested_type="zigbee_enddevice", status="approved",
        discovery_source="zigbee",
    )
    db_session.add(device)
    await db_session.commit()

    res = await client.post(
        f"/api/v1/scan/pending/{device.id}/approve",
        json={"label": "sensor", "type": "zigbee_enddevice", "status": "online",
              "services": [], "design_id": target},
        headers=headers,
    )
    assert res.status_code == 200
    # A node now exists on the target design too (one per canvas).
    nodes = (
        await db_session.execute(
            select(Node).where(Node.ieee_address == "0x00158d0005292b83")
        )
    ).scalars().all()
    assert {n.design_id for n in nodes} == {other, target}


@pytest.mark.asyncio
async def test_approve_device_rejects_hidden(client: AsyncClient, headers, db_session, pending_device):
    """A user-hidden device is not approvable via this endpoint."""
    pending_device.status = "hidden"
    db_session.add(pending_device)
    await db_session.commit()
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "x", "type": "server", "status": "unknown", "services": []},
        headers=headers,
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_approve_nonexistent_device(client: AsyncClient, headers):
    node_payload = {
        "label": "Ghost",
        "type": "generic",
        "ip": "10.0.0.1",
        "status": "unknown",
        "services": [],
    }
    res = await client.post(
        "/api/v1/scan/pending/nonexistent-id/approve",
        json=node_payload,
        headers=headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_hide_device(client: AsyncClient, headers, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/hide", headers=headers)
    assert res.status_code == 200
    assert res.json()["hidden"] is True

    # Should no longer appear in pending
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending_res.json() == []

    # Should appear in hidden
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert len(hidden_res.json()) == 1


@pytest.mark.asyncio
async def test_restore_device(client: AsyncClient, headers, pending_device):
    # Hide first
    await client.post(f"/api/v1/scan/pending/{pending_device.id}/hide", headers=headers)

    # Restore
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/restore", headers=headers)
    assert res.status_code == 200
    assert res.json()["restored"] is True

    # Now back in pending, gone from hidden
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert len(pending_res.json()) == 1
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert hidden_res.json() == []


@pytest.mark.asyncio
async def test_restore_device_rejects_non_hidden(client: AsyncClient, headers, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/restore", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_bulk_restore_devices(client: AsyncClient, headers, pending_device):
    # Hide
    await client.post(f"/api/v1/scan/pending/{pending_device.id}/hide", headers=headers)

    res = await client.post(
        "/api/v1/scan/pending/bulk-restore",
        headers=headers,
        json={"device_ids": [pending_device.id]},
    )
    assert res.status_code == 200
    assert res.json()["restored"] == 1
    assert res.json()["skipped"] == 0

    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert len(pending_res.json()) == 1


@pytest.mark.asyncio
async def test_ignore_device(client: AsyncClient, headers, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/ignore", headers=headers)
    assert res.status_code == 200
    assert res.json()["ignored"] is True

    # Device should be gone from both pending and hidden
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    assert pending_res.json() == []
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert hidden_res.json() == []


@pytest.mark.asyncio
async def test_bulk_approve_approves_devices(client: AsyncClient, headers, two_device_inventory):
    ids = [d.id for d in two_device_inventory]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] == 2
    assert len(data["node_ids"]) == 2
    assert all(nid is not None for nid in data["node_ids"]), "node_ids must be non-null UUIDs"
    assert len(data["device_ids"]) == 2
    assert data["skipped"] == 0
    # Approved devices stay in the inventory, now marked "approved".
    pending_res = await client.get("/api/v1/scan/pending", headers=headers)
    inventory = pending_res.json()
    assert len(inventory) == 2
    assert all(d["status"] == "approved" for d in inventory)


@pytest.mark.asyncio
async def test_bulk_approve_places_already_approved_device_on_another_design(
    client: AsyncClient, headers, db_session, two_device_inventory
):
    """Regression: a device already approved (status='approved', e.g. placed on
    another canvas) must still get a node on the design being approved onto.

    Previously bulk-approve filtered status=='pending', so selecting an
    already-approved device created no node — the user saw fewer nodes than
    they selected."""
    ids = [d.id for d in two_device_inventory]
    design_a = await _add_design(db_session, "Canvas A")
    design_b = await _add_design(db_session, "Canvas B")

    # Approve both onto design A.
    res_a = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": ids, "design_id": design_a},
        headers=headers,
    )
    assert res_a.json()["approved"] == 2

    # Re-approve the same (now status='approved') devices onto design B.
    res_b = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": ids, "design_id": design_b},
        headers=headers,
    )
    data_b = res_b.json()
    assert data_b["approved"] == 2, "already-approved devices must place onto the new canvas"
    assert data_b["skipped"] == 0

    # Two nodes now exist on each design.
    from app.db.models import Node as NodeModel
    nodes_b = (
        await db_session.execute(select(NodeModel).where(NodeModel.design_id == design_b))
    ).scalars().all()
    assert len(nodes_b) == 2


@pytest.mark.asyncio
async def test_bulk_approve_skips_device_already_on_target_design(
    client: AsyncClient, headers, db_session, two_device_inventory
):
    """A device already on the target canvas (same ip) is not placed twice."""
    ids = [d.id for d in two_device_inventory]
    design = await _add_design(db_session, "Canvas")
    # First device already sits on the canvas (matched by ip).
    db_session.add(_node(design, ip="192.168.1.10"))
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": ids, "design_id": design},
        headers=headers,
    )
    data = res.json()
    assert data["approved"] == 1   # only the second device (192.168.1.11)
    assert data["skipped"] == 1

    from app.db.models import Node as NodeModel
    nodes = (
        await db_session.execute(select(NodeModel).where(NodeModel.design_id == design))
    ).scalars().all()
    # The pre-existing node plus the one newly approved — no duplicate for .10.
    assert len(nodes) == 2
    assert sorted(n.ip for n in nodes) == ["192.168.1.10", "192.168.1.11"]


@pytest.mark.asyncio
async def test_bulk_approve_skips_device_matching_ip_in_comma_list(
    client: AsyncClient, headers, db_session, two_device_inventory
):
    """The on-canvas node's ip holds an IPv6 before the IPv4; the device scanned
    as the plain IPv4 is still recognised as already placed (issue #258)."""
    ids = [d.id for d in two_device_inventory]
    design = await _add_design(db_session, "Canvas")
    db_session.add(_node(design, ip="fe80::1, 192.168.1.10"))
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": ids, "design_id": design},
        headers=headers,
    )
    data = res.json()
    assert data["approved"] == 1   # only the second device (192.168.1.11)
    assert data["skipped"] == 1
    assert data["skipped_devices"][0]["value"] == "192.168.1.10"


@pytest.mark.asyncio
async def test_bulk_approve_reports_skipped_devices(
    client: AsyncClient, headers, db_session, two_device_inventory
):
    """Bulk can't prompt per-device, so it reports each duplicate it skipped
    (with the existing node id) instead of silently dropping it."""
    ids = [d.id for d in two_device_inventory]
    design = await _add_design(db_session, "Canvas")
    existing = _node(design, ip="192.168.1.10")
    db_session.add(existing)
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": ids, "design_id": design},
        headers=headers,
    )
    data = res.json()
    assert data["approved"] == 1
    skipped = data["skipped_devices"]
    assert len(skipped) == 1
    entry = skipped[0]
    assert entry["match"] == "ip"
    assert entry["value"] == "192.168.1.10"
    assert entry["existing_node_id"] == existing.id
    assert entry["device_id"] in ids


@pytest.mark.asyncio
async def test_approve_device_copies_mac_to_node_and_properties(
    client: AsyncClient, headers, pending_device, db_session
):
    """Approving a scanned device must carry its MAC onto the node + properties."""
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    # Payload intentionally omits mac — it must come from the pending device.
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "My Server", "type": "server", "ip": "192.168.1.100", "status": "unknown", "services": []},
        headers=headers,
    )
    assert res.status_code == 200
    node = (
        await db_session.execute(select(NodeModel).where(NodeModel.ip == "192.168.1.100"))
    ).scalar_one()
    assert node.mac == "aa:bb:cc:dd:ee:ff"
    mac_props = [p for p in node.properties if p["key"] == "MAC"]
    assert mac_props == [
        {"key": "MAC", "value": "aa:bb:cc:dd:ee:ff", "icon": None, "visible": False}
    ]


@pytest.mark.asyncio
async def test_bulk_approve_copies_mac_to_node_and_properties(
    client: AsyncClient, headers, db_session
):
    """Bulk approve must also propagate the scanned MAC to node + properties."""
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    device = InventoryDevice(
        id=str(uuid.uuid4()),
        ip="192.168.1.55",
        mac="11:22:33:44:55:66",
        hostname="host-mac",
        services=[],
        suggested_type="generic",
        status="pending",
    )
    db_session.add(device)
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": [device.id]},
        headers=headers,
    )
    assert res.status_code == 200
    node = (
        await db_session.execute(select(NodeModel).where(NodeModel.ip == "192.168.1.55"))
    ).scalar_one()
    assert node.mac == "11:22:33:44:55:66"
    mac_props = [p for p in node.properties if p["key"] == "MAC"]
    assert mac_props == [
        {"key": "MAC", "value": "11:22:33:44:55:66", "icon": None, "visible": False}
    ]


@pytest.mark.asyncio
async def test_bulk_approve_sets_default_check_method(client: AsyncClient, headers, two_device_inventory, db_session):
    """Approved devices with an IP must default to ping; otherwise scheduler skips them."""
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    ids = [d.id for d in two_device_inventory]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    nodes = (await db_session.execute(select(NodeModel))).scalars().all()
    for n in nodes:
        if n.ip:
            assert n.check_method == "ping", f"node {n.id} created without check_method"


@pytest.mark.asyncio
async def test_approve_device_sets_default_check_method(client: AsyncClient, headers, pending_device, db_session):
    from sqlalchemy import select

    from app.db.models import Node as NodeModel
    res = await client.post(
        f"/api/v1/scan/pending/{pending_device.id}/approve",
        json={"label": "h", "type": "generic", "ip": "192.168.1.10", "status": "unknown", "services": []},
        headers=headers,
    )
    assert res.status_code == 200
    node = (await db_session.execute(select(NodeModel))).scalars().first()
    assert node is not None
    assert node.check_method == "ping"


@pytest.mark.asyncio
async def test_bulk_approve_skips_already_approved(client: AsyncClient, headers, two_device_inventory):
    ids = [d.id for d in two_device_inventory]
    # Approve first device individually first
    await client.post(
        f"/api/v1/scan/pending/{ids[0]}/approve",
        json={"label": "h", "type": "generic", "ip": "192.168.1.10", "status": "unknown", "services": []},
        headers=headers,
    )
    # Bulk approve both — first one is already approved (not pending), should be skipped
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["approved"] == 1
    assert data["skipped"] == 1


@pytest.mark.asyncio
async def test_bulk_approve_requires_auth(client: AsyncClient, two_device_inventory):
    ids = [d.id for d in two_device_inventory]
    res = await client.post("/api/v1/scan/pending/bulk-approve", json={"device_ids": ids})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_bulk_hide_hides_devices(client: AsyncClient, headers, two_device_inventory):
    ids = [d.id for d in two_device_inventory]
    res = await client.post("/api/v1/scan/pending/bulk-hide", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["hidden"] == 2
    assert data["skipped"] == 0
    # Should appear in hidden list
    hidden_res = await client.get("/api/v1/scan/hidden", headers=headers)
    assert len(hidden_res.json()) == 2


@pytest.mark.asyncio
async def test_bulk_hide_skips_non_pending(client: AsyncClient, headers, two_device_inventory):
    ids = [d.id for d in two_device_inventory]
    # Hide first device individually first
    await client.post(f"/api/v1/scan/pending/{ids[0]}/hide", headers=headers)
    # Bulk hide both — first is already hidden (not pending anymore)
    res = await client.post("/api/v1/scan/pending/bulk-hide", json={"device_ids": ids}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["hidden"] == 1
    assert data["skipped"] == 1


@pytest.mark.asyncio
async def test_bulk_hide_requires_auth(client: AsyncClient, two_device_inventory):
    ids = [d.id for d in two_device_inventory]
    res = await client.post("/api/v1/scan/pending/bulk-hide", json={"device_ids": ids})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_bulk_approve_targets_requested_design(client, headers, db_session):
    """bulk-approve must place nodes on the design_id sent by the UI, not the
    first design — otherwise approved devices land on the wrong canvas."""
    first = await _add_design(db_session, "Default")  # first design (fallback)
    active = await _add_design(db_session, "zwave")    # the design the user is on
    dev = InventoryDevice(
        id=str(uuid.uuid4()),
        ieee_address="zwave-H-2",
        friendly_name="Living Room Plug",
        suggested_type="zwave_router",
        device_subtype="Router",
        vendor="Aeotec",
        model="ZW096",
        status="pending",
        discovery_source="zwave",
    )
    db_session.add(dev)
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending/bulk-approve",
        json={"device_ids": [dev.id], "design_id": active},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["approved"] == 1

    node = (
        await db_session.execute(select(Node).where(Node.ieee_address == "zwave-H-2"))
    ).scalar_one()
    assert node.design_id == active
    assert node.design_id != first
    # Z-Wave device → online + Z-Wave property rows, no ICMP check.
    assert node.status == "online"
    assert node.check_method == "none"
    assert {p["key"] for p in node.properties} == {"Z-Wave ID", "Vendor", "Model"}
