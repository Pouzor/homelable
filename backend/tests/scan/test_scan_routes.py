"""Scan API routes: trigger, pending list, canvas-count correlation, timestamps, config."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from app.db.models import InventoryDevice
from tests.scan.helpers import _add_design, _node_for


@pytest.mark.asyncio
async def test_trigger_scan_requires_auth(client: AsyncClient):
    res = await client.post("/api/v1/scan/trigger")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_trigger_scan_creates_run(client: AsyncClient, headers):
    with (
        patch("app.api.routes.scan._background_scan", new_callable=AsyncMock),
        patch("app.api.routes.scan.settings") as mock_settings,
    ):
        mock_settings.scanner_ranges = ["192.168.1.0/24"]
        res = await client.post("/api/v1/scan/trigger", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "running"
    assert data["ranges"] == ["192.168.1.0/24"]
    assert "id" in data


@pytest.mark.asyncio
async def test_list_pending_empty(client: AsyncClient, headers):
    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_list_pending_returns_device(client: AsyncClient, headers, pending_device):
    res = await client.get("/api/v1/scan/pending", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["ip"] == "192.168.1.100"
    assert data[0]["hostname"] == "my-server"
    # No matching node → not on any canvas.
    assert data[0]["canvas_count"] == 0


@pytest.mark.asyncio
async def test_canvas_count_matches_ip_in_comma_list(client, headers, db_session, pending_device):
    # Node.ip holds several comma-separated addresses (IPv6 added first). The
    # device scanned as the plain IPv4 must still correlate (issue #258).
    d1 = await _add_design(db_session, "Home")
    await _node_for(db_session, d1, ip="fe80::1, 192.168.1.100")
    await db_session.commit()

    data = (await client.get("/api/v1/scan/pending", headers=headers)).json()
    assert data[0]["canvas_count"] == 1


@pytest.mark.asyncio
async def test_canvas_count_correlates_by_mac(client, headers, db_session, pending_device):
    # Node's ip differs entirely (user edited it) but the MAC still matches:
    # the device is on the canvas (issue #258, MAC is the stable identifier).
    d1 = await _add_design(db_session, "Home")
    await _node_for(db_session, d1, ip="10.9.9.9", mac="aa:bb:cc:dd:ee:ff")
    await db_session.commit()

    data = (await client.get("/api/v1/scan/pending", headers=headers)).json()
    assert data[0]["canvas_count"] == 1


@pytest.mark.asyncio
async def test_canvas_count_counts_distinct_designs_by_ip(client, headers, db_session, pending_device):
    # Same IP placed on two different canvases → canvas_count == 2.
    d1 = await _add_design(db_session, "Home")
    d2 = await _add_design(db_session, "Lab")
    await _node_for(db_session, d1, ip="192.168.1.100")
    await _node_for(db_session, d2, ip="192.168.1.100")
    await db_session.commit()

    res = await client.get("/api/v1/scan/pending", headers=headers)
    data = res.json()
    assert len(data) == 1
    assert data[0]["canvas_count"] == 2


@pytest.mark.asyncio
async def test_canvas_count_correlates_by_ieee(client, headers, db_session):
    device = InventoryDevice(
        id=str(uuid.uuid4()), ieee_address="0x00124b001", discovery_source="zigbee",
        suggested_type="zigbee_enddevice", services=[], status="pending",
    )
    db_session.add(device)
    d1 = await _add_design(db_session, "Zigbee")
    await _node_for(db_session, d1, ieee="0x00124b001")
    await db_session.commit()

    res = await client.get("/api/v1/scan/pending", headers=headers)
    by_id = {d["id"]: d for d in res.json()}
    assert by_id[device.id]["canvas_count"] == 1


@pytest.mark.asyncio
async def test_pending_device_without_node_has_null_node_timestamps(client, headers, pending_device):
    # No matching canvas node → node_* timestamps are all null; the device still
    # carries its own discovered_at for the "Discovered" fallback on the tile.
    data = (await client.get("/api/v1/scan/pending", headers=headers)).json()[0]
    assert data["discovered_at"] is not None
    assert data["node_created_at"] is None
    assert data["node_last_scan"] is None
    assert data["node_last_modified"] is None
    assert data["node_last_seen"] is None


@pytest.mark.asyncio
async def test_pending_device_exposes_linked_node_timestamps(client, headers, db_session, pending_device):
    d1 = await _add_design(db_session, "Home")
    node = await _node_for(db_session, d1, ip="192.168.1.100")
    # When the scanner last saw the device, and when it last answered, are facts
    # about the device — they live on its row, not on any one drawing of it.
    device = await db_session.get(InventoryDevice, node.device_id)
    assert device is not None
    device.last_scan = datetime(2026, 6, 1, 8, 30, tzinfo=timezone.utc)
    device.last_seen = datetime(2026, 6, 25, 9, 15, tzinfo=timezone.utc)
    await db_session.commit()

    data = (await client.get("/api/v1/scan/pending", headers=headers)).json()[0]
    assert data["node_created_at"] is not None      # defaulted on insert
    assert data["node_last_modified"] is not None    # updated_at defaulted on insert
    assert data["node_last_scan"].startswith("2026-06-01")
    assert data["node_last_seen"].startswith("2026-06-25")


@pytest.mark.asyncio
async def test_node_timestamps_aggregate_across_matches(client, headers, db_session, pending_device):
    # Two canvas nodes share the device IP: created_at takes the OLDEST,
    # last_scan takes the NEWEST.
    d1 = await _add_design(db_session, "Home")
    d2 = await _add_design(db_session, "Lab")
    older = await _node_for(db_session, d1, ip="192.168.1.100")
    older.created_at = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    newer = await _node_for(db_session, d2, ip="192.168.1.100")
    newer.created_at = datetime(2026, 5, 1, 0, 0, tzinfo=timezone.utc)
    # Both nodes draw the one row, which carries the scan observation.
    assert older.device_id == newer.device_id
    device = await db_session.get(InventoryDevice, older.device_id)
    assert device is not None
    device.last_scan = datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc)
    db_session.add_all([older, newer])
    await db_session.commit()

    data = (await client.get("/api/v1/scan/pending", headers=headers)).json()[0]
    assert data["node_created_at"].startswith("2026-01-01")  # oldest node
    assert data["node_last_scan"].startswith("2026-06-01")   # off the device row


@pytest.mark.asyncio
async def test_resolve_deep_scan_falls_back_to_settings():
    from app.api.routes.scan import TriggerScanRequest, _resolve_deep_scan

    with patch("app.api.routes.scan.settings") as mock_settings:
        mock_settings.scanner_http_ranges = ["7000-7100"]
        mock_settings.scanner_http_probe_enabled = True
        mock_settings.scanner_http_verify_tls = False
        # Empty payload → all values come from settings defaults
        ds = _resolve_deep_scan(TriggerScanRequest())
    assert ds.http_ranges == ["7000-7100"]
    assert ds.http_probe_enabled is True
    assert ds.verify_tls is False


@pytest.mark.asyncio
async def test_resolve_deep_scan_override_wins():
    from app.api.routes.scan import TriggerScanRequest, _resolve_deep_scan

    with patch("app.api.routes.scan.settings") as mock_settings:
        mock_settings.scanner_http_ranges = []
        mock_settings.scanner_http_probe_enabled = False
        mock_settings.scanner_http_verify_tls = False
        ds = _resolve_deep_scan(
            TriggerScanRequest(http_ranges=["9000"], http_probe_enabled=True, verify_tls=True)
        )
    assert ds.http_ranges == ["9000"]
    assert ds.http_probe_enabled is True
    assert ds.verify_tls is True


@pytest.mark.asyncio
async def test_trigger_scan_passes_deep_scan_options(client: AsyncClient, headers):
    captured = {}

    async def fake_bg(run_id, ranges, deep_scan):
        captured["deep_scan"] = deep_scan

    with (
        patch("app.api.routes.scan._background_scan", new=fake_bg),
        patch("app.api.routes.scan.settings") as mock_settings,
    ):
        mock_settings.scanner_ranges = ["192.168.1.0/24"]
        mock_settings.scanner_http_ranges = []
        mock_settings.scanner_http_probe_enabled = False
        mock_settings.scanner_http_verify_tls = False
        res = await client.post(
            "/api/v1/scan/trigger",
            json={"http_probe_enabled": True, "http_ranges": ["8000-8100"]},
            headers=headers,
        )
    assert res.status_code == 200
    assert captured["deep_scan"].http_probe_enabled is True
    assert captured["deep_scan"].http_ranges == ["8000-8100"]


@pytest.mark.asyncio
async def test_trigger_scan_rejects_invalid_port_range(client: AsyncClient, headers):
    with patch("app.api.routes.scan.settings") as mock_settings:
        mock_settings.scanner_ranges = ["192.168.1.0/24"]
        res = await client.post(
            "/api/v1/scan/trigger",
            json={"http_ranges": ["70000-80000"]},
            headers=headers,
        )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_get_scan_config_includes_deep_scan(client: AsyncClient, headers):
    with patch("app.api.routes.scan.settings") as mock_settings:
        mock_settings.scanner_ranges = ["192.168.1.0/24"]
        mock_settings.scanner_http_ranges = ["8000-8100"]
        mock_settings.scanner_http_probe_enabled = True
        mock_settings.scanner_http_verify_tls = False
        res = await client.get("/api/v1/scan/config", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["http_ranges"] == ["8000-8100"]
    assert data["http_probe_enabled"] is True


@pytest.mark.asyncio
async def test_update_scan_config_persists_deep_scan(client: AsyncClient, headers):
    saved = {}

    with patch("app.api.routes.scan.settings") as mock_settings:
        mock_settings.scanner_ranges = ["192.168.1.0/24"]
        mock_settings.scanner_http_ranges = []
        mock_settings.scanner_http_probe_enabled = False
        mock_settings.scanner_http_verify_tls = False
        mock_settings.save_overrides = lambda: saved.update(
            http_ranges=mock_settings.scanner_http_ranges,
            probe=mock_settings.scanner_http_probe_enabled,
        )
        res = await client.post(
            "/api/v1/scan/config",
            json={
                "ranges": ["192.168.1.0/24"],
                "http_ranges": ["9000-9100"],
                "http_probe_enabled": True,
                "verify_tls": True,
            },
            headers=headers,
        )
    assert res.status_code == 200
    assert saved == {"http_ranges": ["9000-9100"], "probe": True}


@pytest.mark.asyncio
async def test_create_pending_normalizes_the_mac(client: AsyncClient, headers):
    # Dedup compares MACs by equality, so a hand-typed entry in any other
    # notation would never match the scanned row and approve would build a
    # duplicate node.
    res = await client.post(
        "/api/v1/scan/pending",
        json={
            "hostname": "printer",
            "mac": "AA-BB-CC-11-22-33",
            "discovery_source": "manual",
        },
        headers=headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["mac"] == "aa:bb:cc:11:22:33"


@pytest.mark.asyncio
async def test_create_pending_keeps_a_missing_mac_null(client: AsyncClient, headers):
    res = await client.post(
        "/api/v1/scan/pending",
        json={"hostname": "no-mac", "discovery_source": "manual"},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["mac"] is None


@pytest.mark.asyncio
async def test_create_pending_unhides_the_row_it_merges_into(client: AsyncClient, headers, db_session):
    """Adding a device by hand outranks an earlier hide of the same host.

    One device is one row, hidden ones included — but merging into a hidden row
    and leaving it hidden answers 201 while nothing appears in the inventory, so
    the add reads as a no-op.
    """
    db_session.add(InventoryDevice(id="d-1", ip="192.168.1.50", status="hidden"))
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending",
        json={"ip": "192.168.1.50", "hostname": "printer", "discovery_source": "manual"},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["id"] == "d-1"
    assert res.json()["status"] == "pending"

    listed = (await client.get("/api/v1/scan/pending", headers=headers)).json()
    assert [d["id"] for d in listed] == ["d-1"]


@pytest.mark.asyncio
async def test_create_pending_leaves_an_approved_row_approved(client: AsyncClient, headers, db_session):
    """Only `hidden` is lifted — a merge must not walk a device back down the
    lifecycle and re-queue something already on a canvas."""
    db_session.add(InventoryDevice(id="d-1", ip="192.168.1.51", status="approved"))
    await db_session.commit()

    res = await client.post(
        "/api/v1/scan/pending",
        json={"ip": "192.168.1.51", "hostname": "nas", "discovery_source": "manual"},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "approved"


@pytest.mark.asyncio
async def test_delete_pending_removes_one_entry(client: AsyncClient, headers, pending_device):
    # The rack canvas drops the placeholder it created for a plate once that
    # plate is pointed at a real inventory row.
    res = await client.delete(f"/api/v1/scan/pending/{pending_device.id}", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json() == {"deleted": True}

    listed = (await client.get("/api/v1/scan/pending", headers=headers)).json()
    assert listed == []


@pytest.mark.asyncio
async def test_delete_pending_unknown_is_404(client: AsyncClient, headers):
    res = await client.delete(f"/api/v1/scan/pending/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_delete_pending_requires_auth(client: AsyncClient, pending_device):
    res = await client.delete(f"/api/v1/scan/pending/{pending_device.id}")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_delete_pending_refuses_a_mounted_device(client: AsyncClient, headers, pending_device):
    # `rack_devices.device_id` is ON DELETE SET NULL: without this guard the
    # delete would strip the mount of its device instead of erroring.
    design = (
        await client.post(
            "/api/v1/designs",
            json={"name": "Rack Room", "icon": "server", "design_type": "rack"},
            headers=headers,
        )
    ).json()["id"]
    saved = await client.post(
        "/api/v1/racks/save",
        json={
            "design_id": design,
            "racks": [
                {
                    "id": "rack-1",
                    "name": "Main",
                    "u_height": 12,
                    "width_standard": "19",
                    "numbering": "bottom-up",
                    "style": {},
                    "pos_x": 0,
                    "pos_y": 0,
                }
            ],
            "devices": [
                {
                    "id": "dev-1",
                    "rack_id": "rack-1",
                    "device_id": pending_device.id,
                    "label": "my-server",
                    "u_start": 1,
                    "u_height": 1,
                    "col_start": 0,
                    "col_span": 12,
                    "faceplate_id": "server-1u",
                    "status": "unknown",
                    "ports": [],
                }
            ],
            "cables": [],
            "viewport": {"x": 0, "y": 0, "zoom": 1},
        },
        headers=headers,
    )
    assert saved.status_code == 200, saved.text

    res = await client.delete(f"/api/v1/scan/pending/{pending_device.id}", headers=headers)
    assert res.status_code == 409
    listed = (await client.get("/api/v1/scan/pending", headers=headers)).json()
    assert [d["id"] for d in listed] == [pending_device.id]


# ---------------------------------------------------------------------------
# Per-device deep rescan (issue #350)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rescan_device_requires_auth(client: AsyncClient, pending_device):
    res = await client.post(f"/api/v1/scan/pending/{pending_device.id}/rescan")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_rescan_device_creates_run_for_that_ip(client: AsyncClient, headers, pending_device):
    with patch("app.api.routes.scan._background_device_scan", new_callable=AsyncMock) as bg:
        res = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan", headers=headers
        )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "running"
    assert data["kind"] == "device"
    # One host, not the configured ranges — the scan targets this device only.
    assert data["ranges"] == ["192.168.1.100/32"]
    bg.assert_called_once()
    assert bg.call_args.args[1] == pending_device.id
    # Full range unless the caller says otherwise.
    assert bg.call_args.args[3] is True


@pytest.mark.asyncio
async def test_rescan_device_passes_the_requested_port_range(
    client: AsyncClient, headers, pending_device
):
    """The dialog's range reaches the scanner verbatim."""
    with patch("app.api.routes.scan._background_device_scan", new_callable=AsyncMock) as bg:
        res = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan",
            headers=headers,
            json={"ports": " 80,443,8000-9000 "},
        )
    assert res.status_code == 200, res.text
    assert bg.call_args.args[4] == "80,443,8000-9000"


@pytest.mark.asyncio
async def test_rescan_device_rejects_an_unusable_port_range(
    client: AsyncClient, headers, pending_device
):
    """A bad spec is refused here, not handed to nmap."""
    for bad in ["0", "65536", "100-50", "80,", "http"]:
        res = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan",
            headers=headers,
            json={"ports": bad},
        )
        assert res.status_code == 422, f"{bad}: {res.text}"


@pytest.mark.asyncio
async def test_rescan_device_treats_a_blank_range_as_the_full_sweep(
    client: AsyncClient, headers, pending_device
):
    with patch("app.api.routes.scan._background_device_scan", new_callable=AsyncMock) as bg:
        res = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan",
            headers=headers,
            json={"ports": "   "},
        )
    assert res.status_code == 200, res.text
    assert bg.call_args.args[4] is None
    assert bg.call_args.args[3] is True


@pytest.mark.asyncio
async def test_rescan_device_unknown_id_404(client: AsyncClient, headers):
    res = await client.post(f"/api/v1/scan/pending/{uuid.uuid4()}/rescan", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_rescan_device_without_ip_409(client: AsyncClient, headers, db_session):
    device = InventoryDevice(id=str(uuid.uuid4()), ip=None, hostname="zigbee-lamp", status="pending")
    db_session.add(device)
    await db_session.commit()

    res = await client.post(f"/api/v1/scan/pending/{device.id}/rescan", headers=headers)
    assert res.status_code == 409
    assert "IP" in res.json()["detail"]


@pytest.mark.asyncio
async def test_rescan_device_hidden_409(client: AsyncClient, headers, db_session):
    device = InventoryDevice(id=str(uuid.uuid4()), ip="192.168.1.77", status="hidden")
    db_session.add(device)
    await db_session.commit()

    res = await client.post(f"/api/v1/scan/pending/{device.id}/rescan", headers=headers)
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_rescan_device_serialized_per_device(client: AsyncClient, headers, pending_device):
    """A second rescan while the first still runs is refused, not duplicated."""
    with patch("app.api.routes.scan._background_device_scan", new_callable=AsyncMock):
        first = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan", headers=headers
        )
        second = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan", headers=headers
        )
    assert first.status_code == 200
    assert second.status_code == 409
    assert "already running" in second.json()["detail"]


@pytest.mark.asyncio
async def test_rescan_device_allows_a_new_run_once_the_first_finished(
    client: AsyncClient, headers, pending_device
):
    with patch("app.api.routes.scan._background_device_scan", new_callable=AsyncMock):
        first = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan", headers=headers
        )
        assert first.status_code == 200
        run_id = first.json()["id"]
        stopped = await client.post(f"/api/v1/scan/{run_id}/stop", headers=headers)
        assert stopped.status_code == 200
        again = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan", headers=headers
        )
    assert again.status_code == 200


@pytest.mark.asyncio
async def test_get_run_returns_status(client: AsyncClient, headers, pending_device):
    with patch("app.api.routes.scan._background_device_scan", new_callable=AsyncMock):
        started = await client.post(
            f"/api/v1/scan/pending/{pending_device.id}/rescan", headers=headers
        )
    run_id = started.json()["id"]
    res = await client.get(f"/api/v1/scan/runs/{run_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["id"] == run_id
    assert res.json()["status"] == "running"


@pytest.mark.asyncio
async def test_get_run_unknown_id_404(client: AsyncClient, headers):
    res = await client.get(f"/api/v1/scan/runs/{uuid.uuid4()}", headers=headers)
    assert res.status_code == 404
