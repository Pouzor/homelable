"""Several Proxmox endpoints: PROXMOX_ENDPOINTS parsing, the optional endpoint
name that scopes synthetic ids, and sync/import across endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.routes.proxmox import _persist_pending_import
from app.core.config import ProxmoxEndpoint, Settings, proxmox_sync_endpoints, settings
from app.core.scheduler import _run_proxmox_sync
from app.db.database import Base
from app.db.models import InventoryDevice, ScanRun
from app.services import proxmox_service as svc

_FIELDS = (
    "proxmox_host", "proxmox_port", "proxmox_verify_tls", "proxmox_token_id",
    "proxmox_token_secret", "proxmox_endpoints", "proxmox_sync_enabled",
)


@pytest.fixture(autouse=True)
def _restore_proxmox_settings():
    saved = {f: getattr(settings, f) for f in _FIELDS}
    settings.proxmox_host = ""
    settings.proxmox_port = 8006
    settings.proxmox_verify_tls = True
    settings.proxmox_token_id = ""
    settings.proxmox_token_secret = ""
    settings.proxmox_endpoints = []
    yield
    for f, v in saved.items():
        setattr(settings, f, v)


def _endpoint(host: str, name: str = "", **kw) -> ProxmoxEndpoint:
    return ProxmoxEndpoint(
        name=name, host=host, token_id=f"u@pam!{host}", token_secret=f"secret-{host}", **kw
    )


def _legacy(host: str = "pve.lan") -> None:
    settings.proxmox_host = host
    settings.proxmox_token_id = "env@pam!t"
    settings.proxmox_token_secret = "env-secret"


# --- config ----------------------------------------------------------------

def test_endpoints_parsed_from_env_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "PROXMOX_ENDPOINTS",
        '[{"name": " lab1 ", "host": "10.0.0.1", "token_id": "a@pam!t", "token_secret": "s1"},'
        ' {"host": "10.0.0.2", "port": 8007, "token_id": "b@pam!t", "token_secret": "s2",'
        ' "verify_tls": false}]',
    )
    endpoints = Settings().proxmox_endpoints  # type: ignore[call-arg]
    assert [(e.name, e.host, e.port, e.verify_tls) for e in endpoints] == [
        ("lab1", "10.0.0.1", 8006, True),
        ("", "10.0.0.2", 8007, False),
    ]


def test_sync_endpoints_puts_legacy_first_and_drops_repeats() -> None:
    _legacy()
    settings.proxmox_endpoints = [
        _endpoint("PVE.lan."),  # the legacy endpoint again
        _endpoint("pve2.lan", name="lab2"),
        _endpoint("pve2.lan", name="dup"),
    ]
    endpoints = proxmox_sync_endpoints(settings)
    assert [(e.host, e.name) for e in endpoints] == [("pve.lan", ""), ("pve2.lan", "lab2")]
    assert endpoints[0].token_secret == "env-secret"


def test_sync_endpoints_skips_legacy_without_token() -> None:
    settings.proxmox_host = "pve.lan"
    settings.proxmox_endpoints = [_endpoint("pve2.lan")]
    assert [e.host for e in proxmox_sync_endpoints(settings)] == ["pve2.lan"]


# --- id scoping ------------------------------------------------------------

def test_name_scopes_host_and_guest_ids() -> None:
    nodes, edges = svc._parse_inventory(
        [{"node": "pve", "status": "online"}],
        {"pve": [svc._guest_node({"vmid": 100, "status": "running"}, "pve", "qemu", None, scope="lab1")]},
        "lab1",
    )
    host, guest = nodes
    assert host["ieee_address"] == "pve-node-lab1-pve"
    assert host["label"] == "pve"  # the name scopes ids only
    assert guest["ieee_address"] == "pve-lab1-100"
    assert guest["parent_ieee"] == "pve-node-lab1-pve"
    assert edges == [{"source": "pve-node-lab1-pve", "target": "pve-lab1-100"}]


def test_no_name_keeps_the_legacy_ids() -> None:
    nodes, _ = svc._parse_inventory(
        [{"node": "pve", "status": "online"}],
        {"pve": [svc._guest_node({"vmid": 100, "status": "running"}, "pve", "qemu", None)]},
    )
    assert [n["ieee_address"] for n in nodes] == ["pve-node-pve", "pve-pve-100"]


@pytest.mark.asyncio
async def test_fetch_inventory_applies_the_name() -> None:
    async def fake_get_json(client, path: str):
        if path == "/nodes":
            return [{"node": "pve", "status": "online"}]
        if path == "/nodes/pve/qemu":
            return [{"vmid": 100, "name": "web", "status": "stopped"}]
        if path == "/nodes/pve/lxc":
            return []
        return None

    with patch.object(svc, "_get_json", new=AsyncMock(side_effect=fake_get_json)):
        nodes, edges = await svc.fetch_proxmox_inventory("h", 8006, "u@pam!t", "s", name="lab1")
    assert {n["ieee_address"] for n in nodes} == {"pve-node-lab1-pve", "pve-lab1-100"}
    assert edges == [{"source": "pve-node-lab1-pve", "target": "pve-lab1-100"}]


def _server(name: str, ip: str, mac: str) -> tuple[list[dict], list[dict]]:
    guest = svc._guest_node(
        {"vmid": 100, "name": f"web-{name}", "status": "running"}, "pve", "qemu", ip, mac, scope=name
    )
    return svc._parse_inventory([{"node": "pve", "status": "online"}], {"pve": [guest]}, name)


@pytest.mark.asyncio
async def test_named_servers_sharing_node_name_and_vmid_stay_apart(db_session) -> None:
    """Regression: two standalone servers both called ``pve`` filed their VM 100
    under the same ``pve-pve-100`` row, the second import overwriting the first."""
    for name, ip, mac in (("lab1", "10.0.1.5", "02:00:00:00:01:05"),
                          ("lab2", "10.0.2.5", "02:00:00:00:02:05")):
        nodes, edges = _server(name, ip, mac)
        await _persist_pending_import(db_session, nodes, edges)

    rows = (await db_session.execute(select(InventoryDevice))).scalars().all()
    by_ieee = {r.ieee_address: r for r in rows}
    assert set(by_ieee) == {"pve-node-lab1-pve", "pve-lab1-100", "pve-node-lab2-pve", "pve-lab2-100"}
    assert by_ieee["pve-lab1-100"].hostname == "web-lab1"
    assert by_ieee["pve-lab2-100"].hostname == "web-lab2"


@pytest.mark.asyncio
async def test_naming_an_imported_server_moves_its_guest(db_session) -> None:
    """A guest imported before its endpoint had a name keeps one inventory row,
    re-filed under the scoped id through its MAC (what .env.example promises)."""
    mac = "02:00:00:00:01:05"
    nodes, edges = _server("", "10.0.1.5", mac)
    assert nodes[1]["ieee_address"] == "pve-pve-100"
    await _persist_pending_import(db_session, nodes, edges)
    nodes, edges = _server("lab1", "10.0.1.5", mac)
    await _persist_pending_import(db_session, nodes, edges)

    guests = (
        await db_session.execute(select(InventoryDevice).where(InventoryDevice.mac == mac))
    ).scalars().all()
    assert [g.ieee_address for g in guests] == ["pve-lab1-100"]


@pytest.mark.asyncio
async def test_proxmox_children_resolves_named_ids(
    client: AsyncClient, headers: dict, db_session
) -> None:
    """The route behind the MCP ``list_proxmox_children`` tool follows the links
    a named import records, keeping each server's guests apart."""
    for name, ip, mac in (("lab1", "10.0.1.5", "02:00:00:00:01:05"),
                          ("lab2", "10.0.2.5", "02:00:00:00:02:05")):
        nodes, edges = _server(name, ip, mac)
        await _persist_pending_import(db_session, nodes, edges)
    rows = {
        r.ieee_address: r
        for r in (await db_session.execute(select(InventoryDevice))).scalars().all()
    }

    res = await client.get(
        f"/api/v1/scan/pending/{rows['pve-node-lab1-pve'].id}/proxmox-children", headers=headers
    )
    assert res.status_code == 200
    assert [d["id"] for d in res.json()] == [rows["pve-lab1-100"].id]


# --- routes ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_env_token_of_a_listed_endpoint_is_used(client: AsyncClient, headers: dict) -> None:
    settings.proxmox_endpoints = [_endpoint("pve2.lan", name="lab2")]
    probe = AsyncMock(return_value=(True, "ok"))
    with patch("app.api.routes.proxmox.test_proxmox_connection", new=probe):
        res = await client.post(
            "/api/v1/proxmox/test-connection",
            json={"host": "pve2.lan", "port": 8006},
            headers=headers,
        )
    assert res.status_code == 200, res.text
    assert probe.call_args.kwargs["token_secret"] == "secret-pve2.lan"


@pytest.mark.asyncio
async def test_listed_endpoint_tls_setting_is_enforced(client: AsyncClient, headers: dict) -> None:
    settings.proxmox_endpoints = [_endpoint("pve2.lan")]
    res = await client.post(
        "/api/v1/proxmox/test-connection",
        json={"host": "pve2.lan", "port": 8006, "verify_tls": False},
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "The server-configured Proxmox token requires TLS verification"


@pytest.mark.asyncio
@pytest.mark.parametrize("body_token", [{}, {"token_id": "x@pam!t", "token_secret": "x"}])
async def test_gui_import_of_a_configured_host_uses_its_name(
    client: AsyncClient, headers: dict, body_token: dict
) -> None:
    """A GUI import files a configured server under the ids auto-sync uses,
    whether the token comes from the env or from the dialog."""
    settings.proxmox_endpoints = [_endpoint("pve2.lan", name="lab2")]
    fetch = AsyncMock(return_value=([], []))
    with patch("app.api.routes.proxmox.fetch_proxmox_inventory", new=fetch):
        res = await client.post(
            "/api/v1/proxmox/import",
            json={"host": "PVE2.lan", "port": 8006, **body_token},
            headers=headers,
        )
    assert res.status_code == 200, res.text
    assert fetch.call_args.kwargs["name"] == "lab2"


@pytest.mark.asyncio
async def test_gui_import_of_an_unknown_host_has_no_name(client: AsyncClient, headers: dict) -> None:
    settings.proxmox_endpoints = [_endpoint("pve2.lan", name="lab2")]
    fetch = AsyncMock(return_value=([], []))
    with patch("app.api.routes.proxmox.fetch_proxmox_inventory", new=fetch):
        res = await client.post(
            "/api/v1/proxmox/import",
            json={"host": "other.lan", "port": 8006, "token_id": "x@pam!t", "token_secret": "x"},
            headers=headers,
        )
    assert res.status_code == 200, res.text
    assert fetch.call_args.kwargs["name"] == ""


@pytest.mark.asyncio
async def test_sync_now_queues_one_run_per_endpoint(
    client: AsyncClient, headers: dict, db_session
) -> None:
    _legacy()
    settings.proxmox_endpoints = [_endpoint("pve2.lan", name="lab2")]
    with patch("app.api.routes.proxmox._background_proxmox_import", new_callable=AsyncMock) as bg:
        res = await client.post("/api/v1/proxmox/sync-now", headers=headers)
    assert res.status_code == 200, res.text
    assert [r["ranges"] for r in res.json()] == [["pve.lan:8006"], ["pve2.lan:8006"]]

    runs = (await db_session.execute(select(ScanRun))).scalars().all()
    assert sorted(r.ranges[0] for r in runs) == ["pve.lan:8006", "pve2.lan:8006"]
    calls = bg.await_args_list
    assert [c.args[1] for c in calls] == ["pve.lan", "pve2.lan"]
    assert "name" not in calls[0].kwargs
    assert calls[1].kwargs["name"] == "lab2"


@pytest.mark.asyncio
async def test_config_lists_endpoints_without_tokens(client: AsyncClient, headers: dict) -> None:
    _legacy()
    settings.proxmox_endpoints = [_endpoint("pve2.lan", name="lab2", verify_tls=False)]
    res = await client.get("/api/v1/proxmox/config", headers=headers)
    assert res.status_code == 200
    assert "secret" not in res.text
    data = res.json()
    assert data["token_configured"] is True
    assert data["endpoints"] == [
        {"name": "", "host": "pve.lan", "port": 8006, "verify_tls": True},
        {"name": "lab2", "host": "pve2.lan", "port": 8006, "verify_tls": False},
    ]


@pytest.mark.asyncio
async def test_sync_can_be_enabled_with_listed_endpoints_only(
    client: AsyncClient, headers: dict
) -> None:
    settings.proxmox_endpoints = [_endpoint("pve2.lan")]
    with patch.object(type(settings), "save_overrides", lambda self: None), \
            patch("app.api.routes.proxmox.set_proxmox_sync_enabled"), \
            patch("app.api.routes.proxmox.reschedule_proxmox_sync"):
        res = await client.post(
            "/api/v1/proxmox/config",
            json={"sync_enabled": True, "sync_interval": 900},
            headers=headers,
        )
    assert res.status_code == 200, res.text
    assert res.json()["sync_enabled"] is True


# --- scheduler -------------------------------------------------------------

@pytest.fixture
async def mem_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


@pytest.mark.asyncio
async def test_auto_sync_runs_every_endpoint(mem_db) -> None:
    _legacy()
    settings.proxmox_sync_enabled = True
    settings.proxmox_endpoints = [_endpoint("pve2.lan", name="lab2")]
    with patch("app.core.scheduler.AsyncSessionLocal", mem_db), \
            patch("app.api.routes.proxmox._background_proxmox_import", new_callable=AsyncMock) as bg:
        await _run_proxmox_sync()

    async with mem_db() as db:
        runs = (await db.execute(select(ScanRun))).scalars().all()
    assert sorted(r.ranges[0] for r in runs) == ["pve.lan:8006", "pve2.lan:8006"]
    assert [c.args[1] for c in bg.await_args_list] == ["pve.lan", "pve2.lan"]
    assert bg.await_args_list[1].kwargs == {"name": "lab2"}
