"""API tests for /api/v1/snmp/* endpoints."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.snmp import _match_neighbor_to_device, _norm_mac
from app.core.config import settings
from app.db.models import Edge, InventoryDevice, Node, SnmpMetric


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_snmp_settings():
    orig = {
        "snmp_poll_enabled": settings.snmp_poll_enabled,
        "snmp_poll_interval": settings.snmp_poll_interval,
        "lldp_discovery_enabled": settings.lldp_discovery_enabled,
        "lldp_discovery_interval": settings.lldp_discovery_interval,
    }
    yield
    for k, v in orig.items():
        setattr(settings, k, v)


def _device(
    id: str,
    *,
    ip: str | None = None,
    mac: str | None = None,
    hostname: str | None = None,
    label: str | None = None,
    snmp_community: str = "public",
    snmp_version: str = "2c",
    snmp_port: int = 161,
) -> InventoryDevice:
    d = InventoryDevice()
    d.id = id
    d.ip = ip
    d.mac = mac
    d.hostname = hostname
    d.label = label
    d.snmp_community = snmp_community
    d.snmp_version = snmp_version
    d.snmp_port = snmp_port
    d.snmp_oids = []
    return d


# ---------------------------------------------------------------------------
# Auth guards
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_config_get_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/api/v1/snmp/config")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_config_post_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/snmp/config", json={})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_metrics_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/api/v1/snmp/dev1/metrics")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_poll_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/snmp/dev1/poll")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_neighbors_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/api/v1/snmp/dev1/neighbors")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_discover_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/api/v1/snmp/dev1/discover")
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# GET /config
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_config_get_returns_defaults(client: AsyncClient, headers: dict) -> None:
    settings.snmp_poll_enabled = False
    settings.lldp_discovery_enabled = False
    res = await client.get("/api/v1/snmp/config", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["snmp_poll_enabled"] is False
    assert body["lldp_discovery_enabled"] is False
    assert body["snmp_poll_interval"] >= 60
    assert body["lldp_discovery_interval"] >= 300


@pytest.mark.asyncio
async def test_config_get_reflects_enabled_state(client: AsyncClient, headers: dict) -> None:
    settings.snmp_poll_enabled = True
    settings.lldp_discovery_enabled = True
    res = await client.get("/api/v1/snmp/config", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["snmp_poll_enabled"] is True
    assert body["lldp_discovery_enabled"] is True


# ---------------------------------------------------------------------------
# POST /config
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_config_post_updates_settings(client: AsyncClient, headers: dict) -> None:
    with (
        patch("app.api.routes.snmp.set_snmp_poll_enabled"),
        patch("app.api.routes.snmp.set_lldp_discovery_enabled"),
        patch("app.api.routes.snmp.reschedule_snmp_poll"),
        patch("app.api.routes.snmp.reschedule_lldp_discovery"),
        patch.object(type(settings), "save_overrides", lambda self: None, create=True),
    ):
        res = await client.post(
            "/api/v1/snmp/config",
            json={
                "snmp_poll_enabled": True,
                "snmp_poll_interval": 120,
                "lldp_discovery_enabled": True,
                "lldp_discovery_interval": 600,
            },
            headers=headers,
        )
    assert res.status_code == 200
    body = res.json()
    assert body["snmp_poll_enabled"] is True
    assert body["snmp_poll_interval"] == 120
    assert body["lldp_discovery_enabled"] is True
    assert body["lldp_discovery_interval"] == 600


@pytest.mark.asyncio
async def test_config_post_rejects_too_short_poll_interval(
    client: AsyncClient, headers: dict
) -> None:
    res = await client.post(
        "/api/v1/snmp/config",
        json={"snmp_poll_enabled": False, "snmp_poll_interval": 30,
              "lldp_discovery_enabled": False, "lldp_discovery_interval": 300},
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_config_post_rejects_too_short_lldp_interval(
    client: AsyncClient, headers: dict
) -> None:
    res = await client.post(
        "/api/v1/snmp/config",
        json={"snmp_poll_enabled": False, "snmp_poll_interval": 300,
              "lldp_discovery_enabled": False, "lldp_discovery_interval": 100},
        headers=headers,
    )
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# GET /{device_id}/metrics
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_metrics_404_when_device_missing(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/snmp/nonexistent/metrics", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_metrics_empty_list_when_no_metrics(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-no-metrics", ip="10.0.0.1")
    db_session.add(dev)
    await db_session.flush()

    res = await client.get("/api/v1/snmp/dev-no-metrics/metrics", headers=headers)
    assert res.status_code == 200
    assert res.json() == []


@pytest.mark.asyncio
async def test_metrics_returns_stored_rows(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-has-metrics", ip="10.0.0.2")
    db_session.add(dev)
    await db_session.flush()

    metric = SnmpMetric(
        device_id="dev-has-metrics",
        oid="1.3.6.1.2.1.1.1.0",
        label="sysDescr",
        value="Linux router",
        value_type="OctetString",
        polled_at=datetime.now(timezone.utc),
    )
    db_session.add(metric)
    await db_session.flush()

    res = await client.get("/api/v1/snmp/dev-has-metrics/metrics", headers=headers)
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["oid"] == "1.3.6.1.2.1.1.1.0"
    assert rows[0]["label"] == "sysDescr"
    assert rows[0]["value"] == "Linux router"


# ---------------------------------------------------------------------------
# POST /{device_id}/poll
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_poll_404_when_device_missing(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/snmp/ghost/poll", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_poll_422_when_no_ip(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-no-ip")  # ip=None
    db_session.add(dev)
    await db_session.flush()

    res = await client.post("/api/v1/snmp/dev-no-ip/poll", headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_poll_stores_metrics(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-poll", ip="192.168.1.1")
    db_session.add(dev)
    await db_session.flush()

    fake_results = [
        {"oid": "1.3.6.1.2.1.1.1.0", "label": "sysDescr", "value": "RouterOS", "value_type": "OctetString"},
        {"oid": "1.3.6.1.2.1.1.5.0", "label": "sysName", "value": "sw-core", "value_type": "OctetString"},
    ]
    with patch("app.api.routes.snmp.poll_device", new=AsyncMock(return_value=fake_results)):
        res = await client.post("/api/v1/snmp/dev-poll/poll", headers=headers)

    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 2
    oids = {r["oid"] for r in rows}
    assert "1.3.6.1.2.1.1.1.0" in oids
    assert "1.3.6.1.2.1.1.5.0" in oids


@pytest.mark.asyncio
async def test_poll_replaces_existing_metric(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    """Second poll on same OID replaces the row (INSERT OR REPLACE)."""
    dev = _device("dev-repoll", ip="10.0.0.10")
    db_session.add(dev)
    await db_session.flush()

    oid = "1.3.6.1.2.1.1.5.0"
    fake_v1 = [{"oid": oid, "label": "sysName", "value": "old-name", "value_type": "OctetString"}]
    fake_v2 = [{"oid": oid, "label": "sysName", "value": "new-name", "value_type": "OctetString"}]

    with patch("app.api.routes.snmp.poll_device", new=AsyncMock(return_value=fake_v1)):
        await client.post("/api/v1/snmp/dev-repoll/poll", headers=headers)
    with patch("app.api.routes.snmp.poll_device", new=AsyncMock(return_value=fake_v2)):
        res = await client.post("/api/v1/snmp/dev-repoll/poll", headers=headers)

    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["value"] == "new-name"


# ---------------------------------------------------------------------------
# GET /{device_id}/neighbors
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_neighbors_404_when_device_missing(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/snmp/ghost/neighbors", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_neighbors_422_when_no_ip(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-nbr-noip")
    db_session.add(dev)
    await db_session.flush()

    res = await client.get("/api/v1/snmp/dev-nbr-noip/neighbors", headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_neighbors_returns_list(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-nbr", ip="10.1.1.1")
    db_session.add(dev)
    await db_session.flush()

    fake_neighbors = [
        {"chassis_id": "aa:bb:cc:dd:ee:ff", "sys_name": "sw2", "port_id": "ge-0/0/1",
         "port_desc": None, "sys_desc": None, "local_port_num": None},
    ]
    with patch(
        "app.services.lldp.discover_neighbors",
        new=AsyncMock(return_value=fake_neighbors),
    ):
        res = await client.get("/api/v1/snmp/dev-nbr/neighbors", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["chassis_id"] == "aa:bb:cc:dd:ee:ff"
    assert body[0]["sys_name"] == "sw2"


# ---------------------------------------------------------------------------
# POST /{device_id}/discover
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_discover_404_when_device_missing(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/snmp/ghost/discover", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_discover_422_when_no_ip(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-disc-noip")
    db_session.add(dev)
    await db_session.flush()

    res = await client.post("/api/v1/snmp/dev-disc-noip/discover", headers=headers)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_discover_no_neighbors_returns_zero_edges(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev = _device("dev-disc-empty", ip="10.2.2.2")
    db_session.add(dev)
    await db_session.flush()

    with patch(
        "app.services.lldp.discover_neighbors", new=AsyncMock(return_value=[])
    ):
        res = await client.post("/api/v1/snmp/dev-disc-empty/discover", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body["edges_created"] == 0
    assert body["neighbors"] == []


@pytest.mark.asyncio
async def test_discover_creates_edge_when_neighbor_matched(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev_a = _device("dev-disc-a", ip="10.3.0.1", mac="aa:00:00:00:00:01")
    dev_b = _device("dev-disc-b", ip="10.3.0.2", mac="aa:00:00:00:00:02")
    db_session.add(dev_a)
    db_session.add(dev_b)
    await db_session.flush()

    node_a = Node(id="n-disc-a", device_id="dev-disc-a", design_id="d-disc", label="a",
                  type="switch", pos_x=0.0, pos_y=0.0)
    node_b = Node(id="n-disc-b", device_id="dev-disc-b", design_id="d-disc", label="b",
                  type="switch", pos_x=100.0, pos_y=0.0)
    db_session.add(node_a)
    db_session.add(node_b)
    await db_session.flush()

    neighbor = {"chassis_id": "aa:00:00:00:00:02", "sys_name": None,
                "port_id": None, "port_desc": None, "sys_desc": None, "local_port_num": None}

    with patch(
        "app.services.lldp.discover_neighbors", new=AsyncMock(return_value=[neighbor])
    ):
        res = await client.post("/api/v1/snmp/dev-disc-a/discover", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body["edges_created"] == 1


@pytest.mark.asyncio
async def test_discover_skips_duplicate_edge(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    dev_a = _device("dev-dup-a", ip="10.4.0.1", mac="bb:00:00:00:00:01")
    dev_b = _device("dev-dup-b", ip="10.4.0.2", mac="bb:00:00:00:00:02")
    db_session.add(dev_a)
    db_session.add(dev_b)
    await db_session.flush()

    node_a = Node(id="n-dup-a", device_id="dev-dup-a", design_id="d-dup", label="a",
                  type="switch", pos_x=0.0, pos_y=0.0)
    node_b = Node(id="n-dup-b", device_id="dev-dup-b", design_id="d-dup", label="b",
                  type="switch", pos_x=100.0, pos_y=0.0)
    db_session.add(node_a)
    db_session.add(node_b)
    await db_session.flush()

    neighbor = {"chassis_id": "bb:00:00:00:00:02", "sys_name": None,
                "port_id": None, "port_desc": None, "sys_desc": None, "local_port_num": None}

    with patch(
        "app.services.lldp.discover_neighbors", new=AsyncMock(return_value=[neighbor])
    ):
        r1 = await client.post("/api/v1/snmp/dev-dup-a/discover", headers=headers)
        r2 = await client.post("/api/v1/snmp/dev-dup-a/discover", headers=headers)

    assert r1.json()["edges_created"] == 1
    assert r2.json()["edges_created"] == 0


# ---------------------------------------------------------------------------
# _norm_mac (pure function)
# ---------------------------------------------------------------------------

class TestNormMac:
    def test_colon_format(self):
        assert _norm_mac("aa:bb:cc:dd:ee:ff") == "aabbccddeeff"

    def test_dash_format(self):
        assert _norm_mac("AA-BB-CC-DD-EE-FF") == "aabbccddeeff"

    def test_dot_format(self):
        assert _norm_mac("aabb.ccdd.eeff") == "aabbccddeeff"

    def test_already_normalized(self):
        assert _norm_mac("aabbccddeeff") == "aabbccddeeff"

    def test_uppercased_normalized(self):
        assert _norm_mac("AABBCCDDEEFF") == "aabbccddeeff"


# ---------------------------------------------------------------------------
# _match_neighbor_to_device (DB helper)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_match_by_mac(db_session: AsyncSession) -> None:
    dev = _device("match-mac", mac="cc:dd:ee:ff:00:01")
    db_session.add(dev)
    await db_session.flush()

    neighbor = {"chassis_id": "cc:dd:ee:ff:00:01", "sys_name": None}
    result = await _match_neighbor_to_device(neighbor, db_session)
    assert result is not None
    assert result.id == "match-mac"


@pytest.mark.asyncio
async def test_match_by_ip_as_chassis(db_session: AsyncSession) -> None:
    dev = _device("match-ip", ip="172.16.0.1")
    db_session.add(dev)
    await db_session.flush()

    neighbor = {"chassis_id": "172.16.0.1", "sys_name": None}
    result = await _match_neighbor_to_device(neighbor, db_session)
    assert result is not None
    assert result.id == "match-ip"


@pytest.mark.asyncio
async def test_match_by_hostname(db_session: AsyncSession) -> None:
    dev = _device("match-hostname", hostname="core-switch")
    db_session.add(dev)
    await db_session.flush()

    neighbor = {"chassis_id": "", "sys_name": "core-switch"}
    result = await _match_neighbor_to_device(neighbor, db_session)
    assert result is not None
    assert result.id == "match-hostname"


@pytest.mark.asyncio
async def test_match_by_label(db_session: AsyncSession) -> None:
    dev = _device("match-label", label="dist-sw-01")
    db_session.add(dev)
    await db_session.flush()

    neighbor = {"chassis_id": "", "sys_name": "dist-sw-01"}
    result = await _match_neighbor_to_device(neighbor, db_session)
    assert result is not None
    assert result.id == "match-label"


@pytest.mark.asyncio
async def test_match_returns_none_when_no_match(db_session: AsyncSession) -> None:
    dev = _device("no-match", mac="ff:ff:ff:ff:ff:ff", hostname="unknown")
    db_session.add(dev)
    await db_session.flush()

    neighbor = {"chassis_id": "00:00:00:00:00:00", "sys_name": "ghost"}
    result = await _match_neighbor_to_device(neighbor, db_session)
    assert result is None
