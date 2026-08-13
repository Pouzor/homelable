"""FastAPI router for Z-Wave JS UI (zwavejs2mqtt) import."""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_zwave_sync, set_zwave_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, InventoryDeviceLink, Node, ScanRun
from app.schemas.scan import ScanRunResponse
from app.schemas.zwave import (
    ZwaveConfig,
    ZwaveCoordinatorOut,
    ZwaveEdgeOut,
    ZwaveImportPendingResponse,
    ZwaveImportRequest,
    ZwaveImportResponse,
    ZwaveNodeOut,
    ZwaveSyncConfig,
    ZwaveTestConnectionRequest,
    ZwaveTestConnectionResponse,
)
from app.services.node_dedupe import dedupe_nodes_by_device
from app.services.zwave_service import (
    build_zwave_properties,
    fetch_zwave_network,
    merge_zwave_properties,
    test_zwave_connection,
)

logger = logging.getLogger(__name__)


async def _is_drawn(db: AsyncSession, device_id: str) -> bool:
    """True while at least one canvas node still draws this device."""
    return (
        await db.execute(select(Node.id).where(Node.device_id == device_id).limit(1))
    ).scalar_one_or_none() is not None


router = APIRouter()


@router.post("/import", response_model=ZwaveImportResponse)
async def import_zwave_network(
    payload: ZwaveImportRequest,
    _: str = Depends(get_current_user),
) -> ZwaveImportResponse:
    """Fetch the Z-Wave node list and return nodes + edges ready for canvas drop.

    Connects to the broker, publishes a ``getNodes`` request to the Z-Wave JS UI
    gateway, and waits for the response. Devices are returned as typed homelable
    nodes with a coordinator → router → end-device hierarchy.
    """
    try:
        nodes_raw, edges_raw = await fetch_zwave_network(
            mqtt_host=payload.mqtt_host,
            mqtt_port=payload.mqtt_port,
            prefix=payload.prefix,
            gateway_name=payload.gateway_name,
            username=payload.mqtt_username,
            password=payload.mqtt_password,
            tls=payload.mqtt_tls,
            tls_insecure=payload.mqtt_tls_insecure,
        )
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during Z-Wave import")
        raise HTTPException(status_code=500, detail="Unexpected error during Z-Wave import") from exc

    nodes = [ZwaveNodeOut(**n) for n in nodes_raw]
    edges = [ZwaveEdgeOut(**e) for e in edges_raw]
    return ZwaveImportResponse(nodes=nodes, edges=edges, device_count=len(nodes))


@router.post("/import-pending", response_model=ScanRunResponse)
async def import_zwave_to_pending(
    payload: ZwaveImportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Queue a Z-Wave pending import as a background scan run (kind=zwave)."""
    run = ScanRun(
        status="running",
        kind="zwave",
        ranges=[f"{payload.mqtt_host}:{payload.mqtt_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_zwave_import, run.id, payload)
    return run


def env_import_request() -> ZwaveImportRequest:
    """Build an import request from the server env config (for auto-sync).

    MQTT credentials live in the env only — never in the request body or any
    API response. The scheduled auto-sync job and ``/sync-now`` both source
    their connection settings here so there is a single source of truth."""
    return ZwaveImportRequest(
        mqtt_host=settings.zwave_mqtt_host,
        mqtt_port=settings.zwave_mqtt_port,
        mqtt_username=settings.zwave_mqtt_username or None,
        mqtt_password=settings.zwave_mqtt_password or None,
        prefix=settings.zwave_prefix,
        gateway_name=settings.zwave_gateway_name,
        mqtt_tls=settings.zwave_mqtt_tls,
        mqtt_tls_insecure=settings.zwave_mqtt_tls_insecure,
    )


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_zwave_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Trigger an immediate Z-Wave import using the server env config.

    Same background flow as ``/import-pending`` but sources the MQTT connection
    from ``settings`` (env) rather than the request body — the manual
    counterpart to the scheduled auto-sync job. Requires the env host to be set.
    """
    if not settings.zwave_mqtt_host:
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Z-Wave MQTT host configured on the server.",
        )
    payload = env_import_request()
    run = ScanRun(
        status="running",
        kind="zwave",
        ranges=[f"{payload.mqtt_host}:{payload.mqtt_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_zwave_import, run.id, payload)
    return run


async def _background_zwave_import(run_id: str, payload: ZwaveImportRequest) -> None:
    async with AsyncSessionLocal() as db:
        try:
            nodes_raw, edges_raw = await fetch_zwave_network(
                mqtt_host=payload.mqtt_host,
                mqtt_port=payload.mqtt_port,
                prefix=payload.prefix,
                gateway_name=payload.gateway_name,
                username=payload.mqtt_username,
                password=payload.mqtt_password,
                tls=payload.mqtt_tls,
                tls_insecure=payload.mqtt_tls_insecure,
            )
            result = await _persist_pending_import(db, nodes_raw, edges_raw)
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "done"
                run.devices_found = result.device_count
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()
        except Exception as exc:
            logger.exception("Z-Wave import %s failed", run_id)
            await db.rollback()
            run = await db.get(ScanRun, run_id)
            if run:
                run.status = "error"
                run.error = str(exc)[:500]
                run.finished_at = datetime.now(timezone.utc)
                await db.commit()


async def _persist_pending_import(
    db: AsyncSession,
    nodes_raw: list[dict[str, Any]],
    edges_raw: list[dict[str, Any]],
) -> ZwaveImportPendingResponse:
    """Upsert nodes/edges into device_inventory + device_inventory_links.

    Coordinator auto-approves to a canvas Node. Other devices upsert by Z-Wave
    identity. All zwave-source links are wiped and re-inserted from the new map.
    """
    # Repair any pre-existing same-canvas duplicate nodes before upserting, so
    # the by-IEEE lookups below resolve cleanly.
    await dedupe_nodes_by_device(db)

    # Coordinator is no longer auto-placed, so the response's coordinator fields
    # stay unset — retained for backward-compatible response shape.
    coordinator_out: ZwaveCoordinatorOut | None = None
    coordinator_existed = False
    pending_created = 0
    pending_updated = 0

    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        props = build_zwave_properties(ieee, n.get("vendor"), n.get("model"))

        # The coordinator is no longer auto-placed on the canvas — it flows to
        # the pending inventory like every other device, so the user approves it
        # explicitly. Only the shared paths below run for it.

        # Properties belong to the inventory row now, so one upsert serves
        # every canvas drawing this device — there is no per-node refresh left
        # to do. The row's status is never touched here: an approved device
        # stays approved, a hidden one stays hidden.
        result = await db.execute(
            select(InventoryDevice).where(InventoryDevice.ieee_address == ieee)
        )
        pending = result.scalar_one_or_none()
        if pending is None:
            db.add(
                InventoryDevice(
                    ieee_address=ieee,
                    friendly_name=n.get("friendly_name"),
                    hostname=n.get("friendly_name"),
                    suggested_type=n.get("type"),
                    device_subtype=n.get("device_type"),
                    model=n.get("model"),
                    vendor=n.get("vendor"),
                    lqi=n.get("lqi"),
                    properties=props,
                    status="pending",
                    discovery_source="zwave",
                )
            )
            pending_created += 1
        else:
            pending.friendly_name = n.get("friendly_name") or pending.friendly_name
            pending.suggested_type = n.get("type") or pending.suggested_type
            pending.device_subtype = n.get("device_type") or pending.device_subtype
            pending.model = n.get("model") or pending.model
            pending.vendor = n.get("vendor") or pending.vendor
            pending.properties = merge_zwave_properties(list(pending.properties or []), props)
            if pending.status == "approved" and not await _is_drawn(db, pending.id):
                # Approved earlier but no canvas draws it any more (the node was
                # deleted) — revive to "pending" so it reappears in the list.
                pending.status = "pending"
            elif pending.status == "hidden":
                pass
            pending_updated += 1

    # Replace all zwave-source links with the freshly discovered set.
    await db.execute(
        sa_delete(InventoryDeviceLink).where(InventoryDeviceLink.discovery_source == "zwave")
    )

    links_recorded = 0
    seen: set[tuple[str, str]] = set()
    for e in edges_raw:
        src = e.get("source")
        tgt = e.get("target")
        if not src or not tgt or (src, tgt) in seen:
            continue
        seen.add((src, tgt))
        db.add(
            InventoryDeviceLink(
                source_ieee=src,
                target_ieee=tgt,
                discovery_source="zwave",
            )
        )
        links_recorded += 1

    await db.commit()

    return ZwaveImportPendingResponse(
        pending_created=pending_created,
        pending_updated=pending_updated,
        coordinator=coordinator_out,
        coordinator_already_existed=coordinator_existed,
        links_recorded=links_recorded,
        device_count=len(nodes_raw),
    )


@router.post("/test-connection", response_model=ZwaveTestConnectionResponse)
async def test_connection_endpoint(
    payload: ZwaveTestConnectionRequest,
    _: str = Depends(get_current_user),
) -> ZwaveTestConnectionResponse:
    """Quick MQTT ping to validate broker connection before importing."""
    try:
        await test_zwave_connection(
            mqtt_host=payload.mqtt_host,
            mqtt_port=payload.mqtt_port,
            username=payload.mqtt_username,
            password=payload.mqtt_password,
            tls=payload.mqtt_tls,
            tls_insecure=payload.mqtt_tls_insecure,
        )
        return ZwaveTestConnectionResponse(connected=True, message="Connection successful")
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except (ConnectionError, TimeoutError) as exc:
        return ZwaveTestConnectionResponse(connected=False, message=str(exc))
    except Exception:
        logger.exception("Unexpected error during connection test")
        return ZwaveTestConnectionResponse(connected=False, message="Unexpected error")


@router.get("/config", response_model=ZwaveConfig)
async def get_zwave_config(_: str = Depends(get_current_user)) -> ZwaveConfig:
    """Return non-secret Z-Wave config. Never includes MQTT credentials — only
    whether a host is configured on the server for auto-sync."""
    return ZwaveConfig(
        mqtt_host=settings.zwave_mqtt_host,
        mqtt_port=settings.zwave_mqtt_port,
        prefix=settings.zwave_prefix,
        gateway_name=settings.zwave_gateway_name,
        mqtt_tls=settings.zwave_mqtt_tls,
        sync_enabled=settings.zwave_sync_enabled,
        sync_interval=settings.zwave_sync_interval,
        host_configured=bool(settings.zwave_mqtt_host),
    )


@router.post("/config", response_model=ZwaveConfig)
async def save_zwave_config(
    payload: ZwaveSyncConfig,
    _: str = Depends(get_current_user),
) -> ZwaveConfig:
    """Persist the auto-sync activation (enabled + interval) and apply it live.

    This is the ONLY Z-Wave config the app writes. Connection settings
    (host/port/credentials/prefix/gateway/tls) are env-only and are never
    accepted or persisted here — enabling auto-sync requires the MQTT host
    already set in the server env, since the scheduled job reads it from there.
    """
    if payload.sync_enabled and not settings.zwave_mqtt_host:
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Z-Wave MQTT host configured in the server env.",
        )
    try:
        settings.zwave_sync_enabled = payload.sync_enabled
        settings.zwave_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_zwave_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_zwave_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_zwave_config()
