"""API endpoint tests for /api/v1/zigbee/*."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# /api/v1/zigbee/test-connection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_test_connection_success(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.test_mqtt_connection") as mock_conn:
        mock_conn.return_value = True
        res = await client.post(
            "/api/v1/zigbee/test-connection",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["connected"] is True
    assert "success" in data["message"].lower()


@pytest.mark.asyncio
async def test_test_connection_failure(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.test_mqtt_connection") as mock_conn:
        mock_conn.side_effect = ConnectionError("Connection refused")
        res = await client.post(
            "/api/v1/zigbee/test-connection",
            json={"mqtt_host": "bad-host", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["connected"] is False
    assert "refused" in data["message"].lower()


@pytest.mark.asyncio
async def test_test_connection_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zigbee/test-connection",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_test_connection_invalid_port(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zigbee/test-connection",
        json={"mqtt_host": "localhost", "mqtt_port": 99999},
        headers=headers,
    )
    assert res.status_code == 422  # pydantic validation error


# ---------------------------------------------------------------------------
# /api/v1/zigbee/import
# ---------------------------------------------------------------------------

_SAMPLE_NODES = [
    {
        "id": "0x00000000",
        "label": "Coordinator",
        "type": "zigbee_coordinator",
        "ieee_address": "0x00000000",
        "friendly_name": "Coordinator",
        "device_type": "Coordinator",
        "model": None,
        "vendor": None,
        "lqi": None,
        "parent_id": None,
    },
    {
        "id": "0x00000001",
        "label": "router_1",
        "type": "zigbee_router",
        "ieee_address": "0x00000001",
        "friendly_name": "router_1",
        "device_type": "Router",
        "model": "CC2530",
        "vendor": "Texas Instruments",
        "lqi": 230,
        "parent_id": "0x00000000",
    },
]

_SAMPLE_EDGES = [
    {"source": "0x00000000", "target": "0x00000001"},
]


@pytest.mark.asyncio
async def test_import_success(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = (_SAMPLE_NODES, _SAMPLE_EDGES)
        res = await client.post(
            "/api/v1/zigbee/import",
            json={
                "mqtt_host": "localhost",
                "mqtt_port": 1883,
                "base_topic": "zigbee2mqtt",
            },
            headers=headers,
        )

    assert res.status_code == 200
    data = res.json()
    assert data["device_count"] == 2
    assert len(data["nodes"]) == 2
    assert len(data["edges"]) == 1
    coordinator = next(n for n in data["nodes"] if n["type"] == "zigbee_coordinator")
    assert coordinator["ieee_address"] == "0x00000000"


@pytest.mark.asyncio
async def test_import_with_credentials(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zigbee/import",
            json={
                "mqtt_host": "localhost",
                "mqtt_port": 1883,
                "mqtt_username": "admin",
                "mqtt_password": "secret",
                "base_topic": "z2m",
            },
            headers=headers,
        )
    assert res.status_code == 200
    mock_fetch.assert_called_once_with(
        mqtt_host="localhost",
        mqtt_port=1883,
        base_topic="z2m",
        username="admin",
        password="secret",
        tls=False,
        tls_insecure=False,
    )


@pytest.mark.asyncio
async def test_import_connection_error_returns_502(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.side_effect = ConnectionError("broker unreachable")
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "bad-host", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 502
    assert "broker unreachable" in res.json()["detail"]


@pytest.mark.asyncio
async def test_import_timeout_returns_504(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.side_effect = TimeoutError("timed out")
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 504


@pytest.mark.asyncio
async def test_import_malformed_payload_returns_422(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.side_effect = ValueError("malformed response")
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_import_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zigbee/import",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_import_empty_network(client: AsyncClient, headers: dict) -> None:
    """An empty Zigbee network (coordinator only) is a valid response."""
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zigbee/import",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    data = res.json()
    assert data["device_count"] == 0
    assert data["nodes"] == []
    assert data["edges"] == []


@pytest.mark.asyncio
async def test_import_missing_mqtt_host(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zigbee/import",
        json={"mqtt_port": 1883},
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_import_with_tls_passes_flags(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.fetch_networkmap") as mock_fetch:
        mock_fetch.return_value = ([], [])
        res = await client.post(
            "/api/v1/zigbee/import",
            json={
                "mqtt_host": "broker.example.com",
                "mqtt_port": 8883,
                "mqtt_tls": True,
            },
            headers=headers,
        )
    assert res.status_code == 200
    kwargs = mock_fetch.call_args.kwargs
    assert kwargs["tls"] is True
    assert kwargs["tls_insecure"] is False


@pytest.mark.asyncio
async def test_import_tls_insecure_requires_tls(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/zigbee/import",
        json={
            "mqtt_host": "broker.example.com",
            "mqtt_port": 1883,
            "mqtt_tls": False,
            "mqtt_tls_insecure": True,
        },
        headers=headers,
    )
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# /api/v1/zigbee/import-pending
# ---------------------------------------------------------------------------

_PENDING_NODES = [
    {
        "id": "0xCOORD",
        "label": "Coordinator",
        "type": "zigbee_coordinator",
        "ieee_address": "0xCOORD",
        "friendly_name": "Coordinator",
        "device_type": "Coordinator",
        "model": None,
        "vendor": None,
        "lqi": None,
        "parent_id": None,
    },
    {
        "id": "0xR1",
        "label": "router_1",
        "type": "zigbee_router",
        "ieee_address": "0xR1",
        "friendly_name": "router_1",
        "device_type": "Router",
        "model": "CC2530",
        "vendor": "TI",
        "lqi": 220,
        "parent_id": "0xCOORD",
    },
    {
        "id": "0xE1",
        "label": "bulb_kitchen",
        "type": "zigbee_enddevice",
        "ieee_address": "0xE1",
        "friendly_name": "bulb_kitchen",
        "device_type": "EndDevice",
        "model": "TRADFRI",
        "vendor": "IKEA",
        "lqi": 180,
        "parent_id": "0xR1",
    },
]

_PENDING_EDGES = [
    {"source": "0xCOORD", "target": "0xR1"},
    {"source": "0xR1", "target": "0xE1"},
]


@pytest.mark.asyncio
async def test_import_pending_endpoint_creates_zigbee_scan_run(
    client: AsyncClient, headers: dict
) -> None:
    """Endpoint returns a ScanRun (kind=zigbee, status=running) immediately;
    the actual networkmap fetch + pending persist runs in the background."""
    from unittest.mock import AsyncMock

    with patch(
        "app.api.routes.zigbee._background_zigbee_import",
        new_callable=AsyncMock,
    ):
        res = await client.post(
            "/api/v1/zigbee/import-pending",
            json={"mqtt_host": "localhost", "mqtt_port": 1883},
            headers=headers,
        )
    assert res.status_code == 200
    run = res.json()
    assert run["kind"] == "zigbee"
    assert run["status"] == "running"
    assert run["ranges"] == ["localhost:1883"]


@pytest.mark.asyncio
async def test_persist_pending_import_coordinator_goes_to_pending(
    db_session,
) -> None:
    """Coordinator is no longer auto-placed — it lands in pending like the rest."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node, PendingDevice

    result = await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)
    assert result.device_count == 3
    assert result.pending_created == 3          # coordinator included now
    assert result.pending_updated == 0
    assert result.coordinator is None           # not auto-placed
    assert result.coordinator_already_existed is False
    assert result.links_recorded == 2

    # No canvas Node auto-created for the coordinator.
    nodes = (await db_session.execute(select(Node))).scalars().all()
    assert nodes == []
    # Coordinator sits in the pending inventory.
    coord = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xCOORD")
        )
    ).scalar_one()
    assert coord.status == "pending"
    assert coord.suggested_type == "zigbee_coordinator"
    assert coord.device_subtype == "Coordinator"


@pytest.mark.asyncio
async def test_persist_pending_import_idempotent_updates_existing(
    db_session,
) -> None:
    from app.api.routes.zigbee import _persist_pending_import

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["lqi"] = 99
    result = await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    assert result.pending_created == 0
    assert result.pending_updated == 3          # coordinator upserts too
    assert result.coordinator_already_existed is False
    assert result.links_recorded == 2


@pytest.mark.asyncio
async def test_persist_pending_import_replaces_links(db_session) -> None:
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import PendingDeviceLink

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    new_edges = [{"source": "0xCOORD", "target": "0xR1"}]
    await _persist_pending_import(db_session, _PENDING_NODES[:2], new_edges)

    rows = (await db_session.execute(select(PendingDeviceLink))).scalars().all()
    assert len(rows) == 1
    assert (rows[0].source_ieee, rows[0].target_ieee) == ("0xCOORD", "0xR1")


@pytest.mark.asyncio
async def test_persist_pending_import_sets_coordinator_pending_fields(db_session) -> None:
    """Coordinator lands in pending carrying its vendor/model metadata."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import PendingDevice

    nodes_with_meta = [dict(n) for n in _PENDING_NODES]
    nodes_with_meta[0]["vendor"] = "TI"
    nodes_with_meta[0]["model"] = "CC2652"

    await _persist_pending_import(db_session, nodes_with_meta, _PENDING_EDGES)

    coord = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xCOORD")
        )
    ).scalar_one()
    assert coord.vendor == "TI"
    assert coord.model == "CC2652"
    assert coord.suggested_type == "zigbee_coordinator"


@pytest.mark.asyncio
async def test_persist_pending_import_backfills_inventory_for_approved_node(
    db_session,
) -> None:
    """A device on canvas but missing its inventory row gets one backfilled
    (status="approved"), so it shows in the inventory list. Node props still
    refresh with the latest Vendor/Model/LQI.
    """
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node, PendingDevice

    # Simulate: router was approved earlier → exists as a canvas Node, but with
    # no matching pending_devices row (e.g. a legacy auto-placed device).
    approved = Node(
        label="router_1",
        type="zigbee_router",
        status="online",
        check_method="none",
        ieee_address="0xR1",
        services=[],
        properties=[],
    )
    db_session.add(approved)
    await db_session.commit()

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["lqi"] = 250  # new LQI from re-import
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    # An inventory row is backfilled as "approved" (it is on a canvas).
    inv = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xR1")
        )
    ).scalar_one()
    assert inv.status == "approved"
    assert inv.suggested_type == "zigbee_router"
    assert inv.device_subtype == "Router"

    # Node properties got refreshed.
    refreshed = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xR1"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in refreshed.properties}
    assert keys == {"IEEE": "0xR1", "Vendor": "TI", "Model": "CC2530", "LQI": "250"}
    # Brand-new props on an existing Node start hidden.
    assert all(p["visible"] is False for p in refreshed.properties)


@pytest.mark.asyncio
async def test_persist_pending_import_preserves_hidden_inventory_for_approved_node(
    db_session,
) -> None:
    """If the on-canvas device already has a hidden inventory row, re-import
    refreshes its metadata but must NOT flip it back to approved/visible."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node, PendingDevice

    db_session.add(Node(
        label="router_1", type="zigbee_router", status="online",
        check_method="none", ieee_address="0xR1", services=[], properties=[],
    ))
    db_session.add(PendingDevice(
        ieee_address="0xR1", friendly_name="router_1", suggested_type="zigbee_router",
        device_subtype="Router", status="hidden", discovery_source="zigbee",
    ))
    await db_session.commit()

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    inv = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xR1")
        )
    ).scalar_one()
    assert inv.status == "hidden"  # stays hidden


@pytest.mark.asyncio
async def test_persist_pending_import_revives_orphaned_approved_device(
    db_session,
) -> None:
    """Regression for #167: approve → delete node → re-import must re-list device.

    When a device was approved (PendingDevice.status="approved") and its canvas
    Node was later deleted, the orphaned "approved" row must be reset to
    "pending" on re-import so it shows up in the Pending list again — instead of
    being silently swallowed (re-import reports "found" but Pending stays empty).
    """
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import PendingDevice

    # Simulate prior approve: a PendingDevice marked approved, but NO matching
    # Node exists (the user deleted the canvas node afterwards).
    orphan = PendingDevice(
        ieee_address="0xR1",
        friendly_name="router_1",
        hostname="router_1",
        suggested_type="zigbee_router",
        device_subtype="Router",
        model="CC2530",
        vendor="TI",
        lqi=220,
        status="approved",
        discovery_source="zigbee",
    )
    db_session.add(orphan)
    await db_session.commit()

    result = await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    # No new row created for 0xR1 — the existing one was updated/revived.
    revived = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xR1")
        )
    ).scalar_one()
    assert revived.status == "pending"
    # Coordinator + end device 0xE1 are brand new → created; router was revived.
    assert result.pending_created == 2
    assert result.pending_updated == 1

    # It is now visible to the Pending list (status filter == "pending").
    listed = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.status == "pending")
        )
    ).scalars().all()
    assert {p.ieee_address for p in listed} == {"0xCOORD", "0xR1", "0xE1"}


@pytest.mark.asyncio
async def test_persist_pending_import_keeps_hidden_hidden_on_reimport(
    db_session,
) -> None:
    """A user-hidden device must stay hidden on re-import (not revived like #167)."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import PendingDevice

    hidden = PendingDevice(
        ieee_address="0xR1",
        friendly_name="router_1",
        suggested_type="zigbee_router",
        device_subtype="Router",
        status="hidden",
        discovery_source="zigbee",
    )
    db_session.add(hidden)
    await db_session.commit()

    await _persist_pending_import(db_session, _PENDING_NODES, _PENDING_EDGES)

    still_hidden = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xR1")
        )
    ).scalar_one()
    assert still_hidden.status == "hidden"


@pytest.mark.asyncio
async def test_persist_pending_import_preserves_user_visibility(db_session) -> None:
    """If user has already made props visible, re-import must not flip them back."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node

    approved = Node(
        label="router_1",
        type="zigbee_router",
        status="online",
        check_method="none",
        ieee_address="0xR1",
        services=[],
        properties=[
            {"key": "IEEE", "value": "0xR1", "icon": None, "visible": True},
            {"key": "Vendor", "value": "TI", "icon": None, "visible": True},
            {"key": "Custom", "value": "kept", "icon": None, "visible": True},
        ],
    )
    db_session.add(approved)
    await db_session.commit()

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["lqi"] = 99
    bumped[1]["model"] = "CC2530"
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    refreshed = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xR1"))
    ).scalar_one()
    by_key = {p["key"]: p for p in refreshed.properties}
    # Existing keys keep their visibility (True).
    assert by_key["IEEE"]["visible"] is True
    assert by_key["Vendor"]["visible"] is True
    # New key arrives hidden.
    assert by_key["Model"]["visible"] is False
    assert by_key["LQI"]["visible"] is False
    assert by_key["LQI"]["value"] == "99"
    # Non-zigbee user-added prop is preserved untouched.
    assert by_key["Custom"]["value"] == "kept"
    assert by_key["Custom"]["visible"] is True


@pytest.mark.asyncio
async def test_persist_pending_import_refreshes_approved_coordinator_node(
    db_session,
) -> None:
    """An already-approved coordinator Node gets its props refreshed on
    re-import, and a backfilled inventory row (approved) so it shows in the
    inventory list — this is the legacy auto-placed coordinator scenario."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Node, PendingDevice

    # Legacy: coordinator auto-placed as a canvas Node, no pending_devices row.
    db_session.add(Node(
        label="Coordinator", type="zigbee_coordinator", status="online",
        check_method="none", ieee_address="0xCOORD", services=[], properties=[],
    ))
    await db_session.commit()

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[0]["vendor"] = "TI"
    bumped[0]["model"] = "CC2652"
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    coord = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xCOORD"))
    ).scalar_one()
    keys = {p["key"]: p["value"] for p in coord.properties}
    assert keys["Vendor"] == "TI"
    assert keys["Model"] == "CC2652"
    by_key = {p["key"]: p for p in coord.properties}
    assert by_key["Vendor"]["visible"] is False
    # Inventory row backfilled as approved → now visible in the inventory list.
    inv = (
        await db_session.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == "0xCOORD")
        )
    ).scalar_one()
    assert inv.status == "approved"
    assert inv.suggested_type == "zigbee_coordinator"


@pytest.mark.asyncio
async def test_persist_pending_import_device_on_multiple_canvases(
    db_session,
) -> None:
    """Regression: a device approved onto TWO designs (one Node each) must not
    crash re-import with MultipleResultsFound — props refresh on both nodes."""
    from sqlalchemy import select

    from app.api.routes.zigbee import _persist_pending_import
    from app.db.models import Design, Node

    d1 = Design(name="d1")
    d2 = Design(name="d2")
    db_session.add_all([d1, d2])
    await db_session.flush()
    for d in (d1, d2):
        db_session.add(Node(
            label="router_1", type="zigbee_router", status="online",
            check_method="none", ieee_address="0xR1", services=[],
            properties=[], design_id=d.id,
        ))
    await db_session.commit()

    bumped = [dict(n) for n in _PENDING_NODES]
    bumped[1]["lqi"] = 240
    # Must not raise.
    await _persist_pending_import(db_session, bumped, _PENDING_EDGES)

    nodes = (
        await db_session.execute(select(Node).where(Node.ieee_address == "0xR1"))
    ).scalars().all()
    assert len(nodes) == 2  # both canvas placements preserved
    for n in nodes:
        lqi = {p["key"]: p["value"] for p in n.properties}.get("LQI")
        assert lqi == "240"  # refreshed on every canvas


@pytest.mark.asyncio
async def test_import_pending_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/zigbee/import-pending",
        json={"mqtt_host": "localhost", "mqtt_port": 1883},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_test_connection_with_tls(client: AsyncClient, headers: dict) -> None:
    with patch("app.api.routes.zigbee.test_mqtt_connection") as mock_conn:
        mock_conn.return_value = True
        res = await client.post(
            "/api/v1/zigbee/test-connection",
            json={
                "mqtt_host": "broker.example.com",
                "mqtt_port": 8883,
                "mqtt_tls": True,
                "mqtt_tls_insecure": True,
            },
            headers=headers,
        )
    assert res.status_code == 200
    kwargs = mock_conn.call_args.kwargs
    assert kwargs["tls"] is True
    assert kwargs["tls_insecure"] is True
