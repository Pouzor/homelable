"""API + persistence tests for /api/v1/omada/*."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.omada import _persist_devices
from app.core.config import settings
from app.db.models import InventoryDevice, ScanRun

_ENV_URL = "https://omada.lan:8043"


@pytest.fixture(autouse=True)
def _clear_omada_env():
    saved = {
        key: getattr(settings, key)
        for key in (
            "omada_url", "omada_id", "omada_client_id", "omada_client_secret", "omada_site",
            "omada_sync_enabled", "omada_sync_interval",
            "omada_import_infrastructure", "omada_import_clients",
        )
    }
    settings.omada_url = ""
    settings.omada_id = ""
    settings.omada_client_id = ""
    settings.omada_client_secret = ""
    settings.omada_site = ""
    yield
    for key, value in saved.items():
        setattr(settings, key, value)


def _configure_env() -> None:
    settings.omada_url = _ENV_URL
    settings.omada_id = "env-cid"
    settings.omada_client_id = "env-client"
    settings.omada_client_secret = "env-secret"


def _device(mac: str, **over: Any) -> dict[str, Any]:
    dev: dict[str, Any] = {
        "ieee_address": f"omada-{mac}",
        "mac": mac,
        "ip": "192.168.0.3",
        "hostname": "Living Room AP",
        "label": "Living Room AP",
        "type": "ap",
        "vendor": "TP-Link",
        "model": "EAP653",
        "properties": [{"key": "Model", "value": "EAP653", "icon": "Box", "visible": False}],
        "source": "omada",
    }
    dev.update(over)
    return dev


_FETCH = "app.api.routes.omada.fetch_omada_inventory"


# --- auth ------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/v1/omada/test-connection"),
        ("post", "/api/v1/omada/import-pending"),
        ("post", "/api/v1/omada/sync-now"),
        ("get", "/api/v1/omada/config"),
        ("post", "/api/v1/omada/config"),
    ],
)
async def test_every_route_requires_auth(client: AsyncClient, method: str, path: str) -> None:
    res = await getattr(client, method)(path)
    assert res.status_code == 401


# --- config ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_config_never_returns_the_secret(client: AsyncClient, headers: dict) -> None:
    _configure_env()
    res = await client.get("/api/v1/omada/config", headers=headers)
    assert res.status_code == 200
    assert "env-secret" not in res.text
    body = res.json()
    assert body["url"] == _ENV_URL
    assert body["omada_id"] == "env-cid"
    assert body["credentials_configured"] is True
    assert body["modes"] == {"infrastructure": True, "clients": False}


@pytest.mark.asyncio
async def test_config_credentials_configured_false_when_empty(client: AsyncClient, headers: dict) -> None:
    res = await client.get("/api/v1/omada/config", headers=headers)
    assert res.json()["credentials_configured"] is False


@pytest.mark.asyncio
async def test_enable_sync_without_env_config_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/omada/config",
        json={"sync_enabled": True, "sync_interval": 3600},
        headers=headers,
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_save_config_persists_activation_and_modes(client: AsyncClient, headers: dict) -> None:
    _configure_env()
    with patch.object(type(settings), "save_overrides") as save, \
         patch("app.api.routes.omada.set_omada_sync_enabled") as enable, \
         patch("app.api.routes.omada.reschedule_omada_sync") as reschedule:
        res = await client.post(
            "/api/v1/omada/config",
            json={
                "sync_enabled": True,
                "sync_interval": 900,
                "modes": {"infrastructure": False, "clients": True},
            },
            headers=headers,
        )
    assert res.status_code == 200
    save.assert_called_once()
    enable.assert_called_once_with(True)
    reschedule.assert_called_once_with(900)
    assert res.json()["sync_interval"] == 900
    assert res.json()["modes"] == {"infrastructure": False, "clients": True}


@pytest.mark.asyncio
async def test_save_config_rejects_no_source(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/omada/config",
        json={"sync_enabled": False, "modes": {"infrastructure": False, "clients": False}},
        headers=headers,
    )
    assert res.status_code == 422


# --- credentials -----------------------------------------------------------

@pytest.mark.asyncio
async def test_env_secret_is_used_for_the_configured_controller(client: AsyncClient, headers: dict) -> None:
    _configure_env()
    with patch(_FETCH, new_callable=AsyncMock, return_value=[]) as fetch:
        res = await client.post(
            "/api/v1/omada/import-pending",
            json={"url": "OMADA.lan:8043/"},
            headers=headers,
        )
    assert res.status_code == 200
    kwargs = fetch.call_args.kwargs
    assert kwargs["url"] == _ENV_URL
    assert kwargs["omada_id"] == "env-cid"
    assert kwargs["client_id"] == "env-client"
    assert kwargs["client_secret"] == "env-secret"


@pytest.mark.asyncio
async def test_env_secret_is_never_sent_to_another_controller(client: AsyncClient, headers: dict) -> None:
    _configure_env()
    with patch(_FETCH, new_callable=AsyncMock) as fetch:
        res = await client.post(
            "/api/v1/omada/import-pending",
            json={"url": "https://attacker.example"},
            headers=headers,
        )
    assert res.status_code == 400
    fetch.assert_not_called()


@pytest.mark.asyncio
async def test_request_credentials_reach_any_controller(client: AsyncClient, headers: dict) -> None:
    with patch(_FETCH, new_callable=AsyncMock, return_value=[]) as fetch:
        res = await client.post(
            "/api/v1/omada/import-pending",
            json={
                "url": "https://euw1-omada-northbound.tplinkcloud.com",
                "omada_id": "cloud-cid",
                "client_id": "mine",
                "client_secret": "s3cret",
                "site": "Home",
                "modes": {"infrastructure": True, "clients": True},
            },
            headers=headers,
        )
    assert res.status_code == 200
    kwargs = fetch.call_args.kwargs
    assert kwargs["omada_id"] == "cloud-cid"
    assert kwargs["client_secret"] == "s3cret"
    assert kwargs["site"] == "Home"
    assert kwargs["clients"] is True


@pytest.mark.asyncio
async def test_an_invalid_url_is_rejected(client: AsyncClient, headers: dict) -> None:
    res = await client.post(
        "/api/v1/omada/test-connection",
        json={"url": "ftp://omada.lan", "client_id": "a", "client_secret": "b"},
        headers=headers,
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_test_connection_returns_the_counts(client: AsyncClient, headers: dict) -> None:
    with patch(
        "app.api.routes.omada.test_omada_connection",
        new_callable=AsyncMock,
        return_value=(True, "Connected — 3 device(s) found in 1 site(s)", {"infrastructure": 3}),
    ):
        res = await client.post(
            "/api/v1/omada/test-connection",
            json={"url": _ENV_URL, "client_id": "a", "client_secret": "b"},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json() == {
        "connected": True,
        "message": "Connected — 3 device(s) found in 1 site(s)",
        "counts": {"infrastructure": 3},
    }


# --- import + Scan History ---------------------------------------------------

@pytest.mark.asyncio
async def test_import_records_a_done_run(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    devices = [
        _device("50:c7:bf:00:00:03"),
        _device("aa:bb:cc:00:00:01", type="computer", source="omada-client"),
    ]
    with patch(_FETCH, new_callable=AsyncMock, return_value=devices):
        res = await client.post(
            "/api/v1/omada/import-pending",
            json={"url": _ENV_URL, "client_id": "a", "client_secret": "b"},
            headers=headers,
        )
    assert res.status_code == 200
    assert res.json() == {
        "device_count": 2, "pending_created": 2, "pending_updated": 0,
        "infra_count": 1, "client_count": 1,
    }
    run = (await db_session.execute(select(ScanRun))).scalars().one()
    assert run.kind == "omada"
    assert run.status == "done"
    assert run.ranges == ["omada.lan:8043"]
    assert run.devices_found == 2


@pytest.mark.asyncio
async def test_a_failed_import_is_a_502_and_an_error_run(
    client: AsyncClient, headers: dict, db_session: AsyncSession
) -> None:
    with patch(_FETCH, new_callable=AsyncMock, side_effect=ConnectionError("Authorization failed")):
        res = await client.post(
            "/api/v1/omada/import-pending",
            json={"url": _ENV_URL, "client_id": "a", "client_secret": "b"},
            headers=headers,
        )
    assert res.status_code == 502
    assert res.json()["detail"] == "Authorization failed"
    run = (await db_session.execute(select(ScanRun))).scalars().one()
    assert run.status == "error"
    assert run.error == "Authorization failed"


@pytest.mark.asyncio
async def test_sync_now_rejected_without_env_config(client: AsyncClient, headers: dict) -> None:
    res = await client.post("/api/v1/omada/sync-now", headers=headers)
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_sync_now_uses_the_env_controller_and_modes(client: AsyncClient, headers: dict) -> None:
    _configure_env()
    settings.omada_site = "Home"
    settings.omada_import_infrastructure = True
    settings.omada_import_clients = True
    with patch(_FETCH, new_callable=AsyncMock, return_value=[_device("50:c7:bf:00:00:03")]) as fetch:
        res = await client.post("/api/v1/omada/sync-now", headers=headers)
    assert res.status_code == 200
    assert res.json()["pending_created"] == 1
    kwargs = fetch.call_args.kwargs
    assert kwargs["url"] == _ENV_URL
    assert kwargs["site"] == "Home"
    assert kwargs["clients"] is True


# --- persistence -------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_reimport_updates_in_place_and_keeps_approval(db_session: AsyncSession) -> None:
    await _persist_devices(db_session, [_device("50:c7:bf:00:00:03")])
    row = (await db_session.execute(select(InventoryDevice))).scalars().one()
    row.status = "approved"
    await db_session.commit()

    result = await _persist_devices(
        db_session, [_device("50:c7:bf:00:00:03", ip="192.168.0.30", hostname="Hall AP")]
    )
    assert (result.pending_created, result.pending_updated) == (0, 1)
    row = (await db_session.execute(select(InventoryDevice))).scalars().one()
    await db_session.refresh(row)
    assert row.status == "approved"
    assert row.ip == "192.168.0.30"
    assert row.hostname == "Hall AP"


@pytest.mark.asyncio
async def test_a_hidden_device_comes_back_pending(db_session: AsyncSession) -> None:
    db_session.add(InventoryDevice(
        ieee_address="omada-50:c7:bf:00:00:03", mac="50:c7:bf:00:00:03", status="hidden",
        discovery_source="omada", discovery_sources=["omada"],
    ))
    await db_session.commit()
    await _persist_devices(db_session, [_device("50:c7:bf:00:00:03")])
    row = (await db_session.execute(select(InventoryDevice))).scalars().one()
    await db_session.refresh(row)
    assert row.status == "pending"


@pytest.mark.asyncio
async def test_a_scanned_device_is_merged_by_mac_and_keeps_its_description(
    db_session: AsyncSession,
) -> None:
    """A machine an IP scan found first is the same row, and Omada's thin client
    record does not retype it or rename it."""
    db_session.add(InventoryDevice(
        ip="192.168.0.10", mac="aa:bb:cc:00:00:01", hostname="nas.lan",
        suggested_type="nas", status="pending",
        discovery_source="arp", discovery_sources=["arp"],
    ))
    await db_session.commit()

    await _persist_devices(db_session, [
        _device(
            "aa:bb:cc:00:00:01", hostname="nas", label="nas", type="computer",
            vendor="Synology", model=None, source="omada-client",
            properties=[{"key": "Port", "value": "3", "icon": "EthernetPort", "visible": False}],
        ),
    ])
    row = (await db_session.execute(select(InventoryDevice))).scalars().one()
    await db_session.refresh(row)
    assert row.suggested_type == "nas"
    assert row.hostname == "nas.lan"
    assert row.ieee_address == "omada-aa:bb:cc:00:00:01"
    assert row.discovery_sources == ["arp", "omada-client"]
    assert row.vendor == "Synology"
    assert [p["key"] for p in row.properties] == ["Port"]
