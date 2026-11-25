"""API + persistence tests for /api/v1/tailscale/*."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.tailscale import _find_existing, _persist_devices
from app.core.config import settings
from app.db.models import InventoryDevice, Node, ScanRun

_SECRETS = ("tailscale_api_key", "tailscale_oauth_client_id", "tailscale_oauth_client_secret")


@pytest.fixture(autouse=True)
def _clear_tailscale_env():
    saved = {name: getattr(settings, name) for name in (*_SECRETS, "tailscale_tailnet", "tailscale_tag_filter")}
    for name in _SECRETS:
        setattr(settings, name, "")
    settings.tailscale_tailnet = "-"
    settings.tailscale_tag_filter = []
    yield
    for name, value in saved.items():
        setattr(settings, name, value)


def _device(
    node: str = "nA1",
    ip: str | None = "100.64.0.5",
    hostname: str = "vps-clone",
    *,
    online: bool = True,
    props: list[dict] | None = None,
) -> dict:
    return {
        "ieee_address": f"tailscale-{node}",
        "ip": ip,
        "mac": None,
        "hostname": hostname,
        "label": hostname,
        "type": "server",
        "os": "ubuntu 24.04",
        "vendor": None,
        "model": None,
        "properties": props if props is not None else [
            {"key": "Tailscale IP", "value": ip, "icon": "Network", "visible": False},
        ],
        "online": online,
    }


async def _rows(db: AsyncSession) -> list[InventoryDevice]:
    return list((await db.execute(select(InventoryDevice))).scalars().all())


# --- auth + config ---------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/v1/tailscale/test-connection"),
        ("post", "/api/v1/tailscale/import-pending"),
        ("post", "/api/v1/tailscale/sync-now"),
        ("get", "/api/v1/tailscale/config"),
        ("post", "/api/v1/tailscale/config"),
    ],
)
async def test_every_endpoint_requires_auth(client: AsyncClient, method: str, path: str) -> None:
    res = await getattr(client, method)(path, **({"json": {}} if method == "post" else {}))
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_config_never_returns_a_credential(client: AsyncClient, headers: dict) -> None:
    settings.tailscale_oauth_client_id = "kCLIENTID"
    settings.tailscale_oauth_client_secret = "tskey-client-supersecret"
    res = await client.get("/api/v1/tailscale/config", headers=headers)
    assert res.status_code == 200
    assert "supersecret" not in res.text
    assert "kCLIENTID" not in res.text
    body = res.json()
    assert body["credentials_configured"] is True
    assert body["tailnet"] == "-"


@pytest.mark.asyncio
async def test_half_an_oauth_client_in_env_is_not_configured(client: AsyncClient, headers: dict) -> None:
    settings.tailscale_oauth_client_id = "kCLIENTID"
    res = await client.get("/api/v1/tailscale/config", headers=headers)
    assert res.json()["credentials_configured"] is False


@pytest.mark.asyncio
async def test_sync_now_rejected_without_credentials(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/tailscale/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_enable_sync_without_credentials_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/tailscale/config", json={"sync_enabled": True, "sync_interval": 3600}, headers=headers
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_save_config_persists_only_sync_fields(client: AsyncClient, headers: dict) -> None:
    settings.tailscale_api_key = "tskey-api-env"
    with patch.object(type(settings), "save_overrides", lambda self: None), \
            patch("app.api.routes.tailscale.set_tailscale_sync_enabled"), \
            patch("app.api.routes.tailscale.reschedule_tailscale_sync"):
        res = await client.post(
            "/api/v1/tailscale/config",
            json={
                "api_key": "tskey-api-attacker",
                "tailnet": "attacker.com",
                "sync_enabled": True,
                "sync_interval": 900,
                "include_shared": True,
                "tags": ["server", " tag:nas ", ""],
            },
            headers=headers,
        )
    assert res.status_code == 200
    assert settings.tailscale_api_key == "tskey-api-env"
    assert settings.tailscale_tailnet == "-"
    assert settings.tailscale_sync_interval == 900
    assert settings.tailscale_include_shared is True
    assert settings.tailscale_tag_filter == ["tag:server", "tag:nas"]
    assert "tskey" not in res.text


@pytest.mark.asyncio
async def test_save_config_rejects_an_interval_out_of_range(client: AsyncClient, headers: dict) -> None:
    for interval in (100, 100_000):
        res = await client.post(
            "/api/v1/tailscale/config", json={"sync_enabled": False, "sync_interval": interval}, headers=headers
        )
        assert res.status_code == 422, interval


@pytest.mark.asyncio
async def test_half_an_oauth_client_in_a_request_is_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/tailscale/test-connection", json={"oauth_client_id": "kONLY"}, headers=headers
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_a_request_credential_wins_over_the_env(client: AsyncClient, headers: dict, monkeypatch) -> None:
    settings.tailscale_api_key = "tskey-api-env"
    seen: dict = {}

    async def _fake_test(**kwargs):
        seen.update(kwargs)
        return True, "Connected — 0 device(s) to import", 0

    monkeypatch.setattr("app.api.routes.tailscale.test_tailscale_connection", _fake_test)
    res = await client.post(
        "/api/v1/tailscale/test-connection",
        json={"oauth_client_id": "kREQ", "oauth_client_secret": "sREQ", "tailnet": "example.com"},
        headers=headers,
    )
    assert res.status_code == 200
    assert seen["api_key"] is None
    assert seen["client_id"] == "kREQ"
    assert seen["tailnet"] == "example.com"


@pytest.mark.asyncio
async def test_the_env_credential_is_the_fallback(client: AsyncClient, headers: dict, monkeypatch) -> None:
    settings.tailscale_oauth_client_id = "kENV"
    settings.tailscale_oauth_client_secret = "sENV"
    seen: dict = {}

    async def _fake_test(**kwargs):
        seen.update(kwargs)
        return True, "ok", 0

    monkeypatch.setattr("app.api.routes.tailscale.test_tailscale_connection", _fake_test)
    res = await client.post("/api/v1/tailscale/test-connection", json={}, headers=headers)
    assert res.status_code == 200
    assert (seen["client_id"], seen["client_secret"], seen["tailnet"]) == ("kENV", "sENV", "-")


# --- import + scan history ---------------------------------------------------


@pytest.mark.asyncio
async def test_import_pending_creates_rows_and_records_a_run(
    client: AsyncClient, headers: dict, db_session: AsyncSession, monkeypatch
) -> None:
    async def _fake_fetch(**_kwargs):
        return [_device("nA1"), _device("nB2", "100.64.0.6", "pixel", online=False)]

    monkeypatch.setattr("app.api.routes.tailscale.fetch_tailscale_inventory", _fake_fetch)
    res = await client.post("/api/v1/tailscale/import-pending", json={"api_key": "tskey-api-x"}, headers=headers)
    assert res.status_code == 200
    assert res.json() == {"device_count": 2, "pending_created": 2, "pending_updated": 0, "online_count": 1}

    rows = await _rows(db_session)
    assert {r.ieee_address for r in rows} == {"tailscale-nA1", "tailscale-nB2"}
    assert all(r.status == "pending" for r in rows)
    assert all(r.discovery_sources == ["tailscale"] for r in rows)

    runs = (await db_session.execute(select(ScanRun))).scalars().all()
    assert len(runs) == 1
    assert (runs[0].kind, runs[0].status, runs[0].devices_found) == ("tailscale", "done", 2)
    assert runs[0].ranges == ["tailnet:-"]
    assert runs[0].finished_at is not None


@pytest.mark.asyncio
async def test_a_failed_import_is_recorded_as_an_error_run(
    client: AsyncClient, headers: dict, db_session: AsyncSession, monkeypatch
) -> None:
    async def _fake_fetch(**_kwargs):
        raise ConnectionError("Tailscale rejected the credential")

    monkeypatch.setattr("app.api.routes.tailscale.fetch_tailscale_inventory", _fake_fetch)
    res = await client.post("/api/v1/tailscale/import-pending", json={"api_key": "tskey-api-x"}, headers=headers)
    assert res.status_code == 502
    assert res.json()["detail"] == "Tailscale rejected the credential"

    runs = (await db_session.execute(select(ScanRun))).scalars().all()
    assert len(runs) == 1
    assert (runs[0].status, runs[0].error, runs[0].devices_found) == ("error", "Tailscale rejected the credential", 0)


@pytest.mark.asyncio
async def test_an_unexpected_error_is_a_500_without_details(
    client: AsyncClient, headers: dict, db_session: AsyncSession, monkeypatch
) -> None:
    async def _fake_fetch(**_kwargs):
        raise RuntimeError("tskey-api-leaked in a traceback")

    monkeypatch.setattr("app.api.routes.tailscale.fetch_tailscale_inventory", _fake_fetch)
    res = await client.post("/api/v1/tailscale/import-pending", json={"api_key": "tskey-api-x"}, headers=headers)
    assert res.status_code == 500
    assert "leaked" not in res.text
    run = (await db_session.execute(select(ScanRun))).scalars().one()
    assert "leaked" not in (run.error or "")


@pytest.mark.asyncio
async def test_sync_now_uses_the_env_and_saved_filters(
    client: AsyncClient, headers: dict, db_session: AsyncSession, monkeypatch
) -> None:
    settings.tailscale_api_key = "tskey-api-env"
    monkeypatch.setattr(settings, "tailscale_include_shared", True)
    settings.tailscale_tag_filter = ["tag:server"]
    seen: dict = {}

    async def _fake_fetch(**kwargs):
        seen.update(kwargs)
        return [_device()]

    monkeypatch.setattr("app.api.routes.tailscale.fetch_tailscale_inventory", _fake_fetch)
    res = await client.post("/api/v1/tailscale/sync-now", headers=headers)
    assert res.status_code == 200
    assert seen["api_key"] == "tskey-api-env"
    assert seen["include_shared"] is True
    assert seen["tags"] == ["tag:server"]
    run = (await db_session.execute(select(ScanRun))).scalars().one()
    assert (run.kind, run.status) == ("tailscale", "done")


# --- matching -------------------------------------------------------------------


@pytest.mark.asyncio
async def test_find_existing_by_ieee(db_session: AsyncSession) -> None:
    db_session.add(InventoryDevice(ieee_address="tailscale-nA1", ip="100.64.0.5", status="pending"))
    await db_session.commit()
    found = await _find_existing(db_session, "tailscale-nA1", "100.64.0.9")
    assert found is not None and found.ip == "100.64.0.5"


@pytest.mark.asyncio
async def test_find_existing_reaches_a_hand_merged_row_by_its_tailnet_address(db_session: AsyncSession) -> None:
    """A guest the user merged by hand keeps its Proxmox id; its tailnet address finds it."""
    db_session.add(InventoryDevice(
        ieee_address="pve-pve1-101", ip="192.168.1.170, 100.64.0.5", status="approved",
    ))
    await db_session.commit()
    found = await _find_existing(db_session, "tailscale-nA1", "100.64.0.5")
    assert found is not None and found.ieee_address == "pve-pve1-101"


@pytest.mark.asyncio
async def test_find_existing_compares_whole_addresses(db_session: AsyncSession) -> None:
    db_session.add(InventoryDevice(ip="100.64.0.55", status="pending"))
    await db_session.commit()
    assert await _find_existing(db_session, "tailscale-nA1", "100.64.0.5") is None


@pytest.mark.asyncio
async def test_find_existing_skips_a_row_of_another_tailscale_node(db_session: AsyncSession) -> None:
    """Tailscale can hand a deleted node's address to a new one: not the same machine."""
    db_session.add(InventoryDevice(ieee_address="tailscale-nOLD", ip="100.64.0.5", status="pending"))
    await db_session.commit()
    assert await _find_existing(db_session, "tailscale-nNEW", "100.64.0.5") is None


@pytest.mark.asyncio
async def test_a_lan_only_row_is_not_matched(db_session: AsyncSession) -> None:
    """No MAC and no hostname matching: a LAN-scanned host is merged by hand once."""
    db_session.add(InventoryDevice(ip="192.168.1.170", hostname="vps-clone", status="pending"))
    await db_session.commit()
    assert await _find_existing(db_session, "tailscale-nA1", "100.64.0.5") is None


# --- persistence ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_resync_is_stable(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device()])
    result = await _persist_devices(db_session, [_device()])
    assert (result.pending_created, result.pending_updated) == (0, 1)
    assert len(await _rows(db_session)) == 1


@pytest.mark.asyncio
async def test_a_merged_row_keeps_its_identity_and_lan_address_first(db_session: AsyncSession) -> None:
    row = InventoryDevice(
        ieee_address="pve-pve1-101",
        ip="192.168.1.170, 100.64.0.5",
        hostname="vps-clone-guest",
        suggested_type="vm",
        status="approved",
        discovery_source="proxmox",
        discovery_sources=["proxmox"],
    )
    db_session.add(row)
    await db_session.commit()

    await _persist_devices(db_session, [_device()])
    await db_session.refresh(row)
    assert row.ieee_address == "pve-pve1-101"
    # LAN first: the status checker probes the first address.
    assert row.ip == "192.168.1.170, 100.64.0.5"
    assert row.discovery_sources == ["proxmox", "tailscale"]
    # Another source owns the description.
    assert (row.hostname, row.suggested_type) == ("vps-clone-guest", "vm")
    assert any(p["key"] == "Tailscale IP" for p in row.properties)


@pytest.mark.asyncio
async def test_a_renumbered_device_drops_its_old_tailnet_address(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device(ip="100.64.0.5")])
    row = (await _rows(db_session))[0]
    row.ip = "192.168.1.170, 100.64.0.5"  # as after a hand merge with a LAN scan
    await db_session.commit()

    await _persist_devices(db_session, [_device(ip="100.64.0.77")])
    await db_session.refresh(row)
    assert row.ip == "192.168.1.170, 100.64.0.77"


@pytest.mark.asyncio
async def test_a_tailscale_owned_row_is_refreshed(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device(hostname="old-name")])
    await _persist_devices(db_session, [_device(hostname="new-name")])
    row = (await _rows(db_session))[0]
    assert (row.hostname, row.friendly_name) == ("new-name", "new-name")


@pytest.mark.asyncio
async def test_property_visibility_chosen_by_the_user_survives_a_resync(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device()])
    row = (await _rows(db_session))[0]
    row.properties = [{**p, "visible": True} for p in row.properties]
    await db_session.commit()

    await _persist_devices(db_session, [_device()])
    await db_session.refresh(row)
    assert all(p["visible"] is True for p in row.properties if p["key"] == "Tailscale IP")


@pytest.mark.asyncio
async def test_hidden_rows_stay_hidden(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device()])
    row = (await _rows(db_session))[0]
    row.status = "hidden"
    await db_session.commit()

    await _persist_devices(db_session, [_device()])
    await db_session.refresh(row)
    assert row.status == "hidden"


@pytest.mark.asyncio
async def test_an_approved_row_on_a_canvas_stays_approved(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device()])
    row = (await _rows(db_session))[0]
    row.status = "approved"
    db_session.add(Node(type="server", label="vps-clone", device_id=row.id))
    await db_session.commit()

    await _persist_devices(db_session, [_device()])
    await db_session.refresh(row)
    assert row.status == "approved"


@pytest.mark.asyncio
async def test_an_approved_row_drawn_nowhere_returns_to_pending(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device()])
    row = (await _rows(db_session))[0]
    row.status = "approved"
    await db_session.commit()

    await _persist_devices(db_session, [_device()])
    await db_session.refresh(row)
    assert row.status == "pending"


@pytest.mark.asyncio
async def test_a_device_without_a_tailnet_ipv4_is_still_imported(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device(ip=None, props=[])])
    row = (await _rows(db_session))[0]
    assert row.ieee_address == "tailscale-nA1"
    assert row.ip is None
