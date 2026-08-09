"""FastAPI router for Zigbee2MQTT import."""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import reschedule_zigbee_sync, set_zigbee_sync_enabled
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import InventoryDevice, InventoryDeviceLink, Node, ScanRun
from app.schemas.scan import ScanRunResponse
from app.schemas.zigbee import (
    ZigbeeConfig,
    ZigbeeCoordinatorOut,
    ZigbeeEdgeOut,
    ZigbeeImportPendingResponse,
    ZigbeeImportRequest,
    ZigbeeImportResponse,
    ZigbeeNodeOut,
    ZigbeeSyncConfig,
    ZigbeeTestConnectionRequest,
    ZigbeeTestConnectionResponse,
)
from app.services.node_dedupe import dedupe_nodes_by_ieee
from app.services.zigbee_service import (
    build_zigbee_properties,
    fetch_networkmap,
    merge_zigbee_properties,
    test_mqtt_connection,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/import", response_model=ZigbeeImportResponse)
async def import_zigbee_network(
    payload: ZigbeeImportRequest,
    _: str = Depends(get_current_user),
) -> ZigbeeImportResponse:
    """Fetch the Zigbee2MQTT network map and return nodes + edges ready for canvas drop.

    Connects to the specified MQTT broker, publishes a networkmap request to
    ``<base_topic>/bridge/request/networkmap``, and waits up to 60 s for the
    response (large meshes can take 30 s+).  The devices are returned as typed homelable nodes with a
    coordinator → router → end-device hierarchy.
    """
    try:
        nodes_raw, edges_raw = await fetch_networkmap(
            mqtt_host=payload.mqtt_host,
            mqtt_port=payload.mqtt_port,
            base_topic=payload.base_topic,
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
        logger.exception("Unexpected error during Zigbee import")
        raise HTTPException(status_code=500, detail="Unexpected error during Zigbee import") from exc

    nodes = [ZigbeeNodeOut(**n) for n in nodes_raw]
    edges = [ZigbeeEdgeOut(**e) for e in edges_raw]
    return ZigbeeImportResponse(nodes=nodes, edges=edges, device_count=len(nodes))


@router.post("/import-pending", response_model=ScanRunResponse)
async def import_zigbee_to_pending(
    payload: ZigbeeImportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Queue a Zigbee2MQTT pending import as a background scan run.

    Returns the ScanRun row immediately so the UI can close the import
    modal and surface progress under Scan History (kind=zigbee). The
    actual MQTT fetch + pending upsert happens in the background.
    """
    run = ScanRun(
        status="running",
        kind="zigbee",
        ranges=[f"{payload.mqtt_host}:{payload.mqtt_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_zigbee_import, run.id, payload)
    return run


def env_import_request() -> ZigbeeImportRequest:
    """Build an import request from the server env config (for auto-sync).

    MQTT credentials live in the env only — never in the request body or any
    API response. The scheduled auto-sync job and ``/sync-now`` both source
    their connection settings here so there is a single source of truth."""
    return ZigbeeImportRequest(
        mqtt_host=settings.zigbee_mqtt_host,
        mqtt_port=settings.zigbee_mqtt_port,
        mqtt_username=settings.zigbee_mqtt_username or None,
        mqtt_password=settings.zigbee_mqtt_password or None,
        base_topic=settings.zigbee_base_topic,
        mqtt_tls=settings.zigbee_mqtt_tls,
        mqtt_tls_insecure=settings.zigbee_mqtt_tls_insecure,
    )


@router.post("/sync-now", response_model=ScanRunResponse)
async def sync_zigbee_now(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> ScanRun:
    """Trigger an immediate Zigbee import using the server env config.

    Same background flow as ``/import-pending`` but sources the MQTT connection
    from ``settings`` (env) rather than the request body — the manual
    counterpart to the scheduled auto-sync job. Requires the env host to be set.
    """
    if not settings.zigbee_mqtt_host:
        raise HTTPException(
            status_code=400,
            detail="Cannot sync: no Zigbee MQTT host configured on the server.",
        )
    payload = env_import_request()
    run = ScanRun(
        status="running",
        kind="zigbee",
        ranges=[f"{payload.mqtt_host}:{payload.mqtt_port}"],
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    background_tasks.add_task(_background_zigbee_import, run.id, payload)
    return run


async def _background_zigbee_import(run_id: str, payload: ZigbeeImportRequest) -> None:
    async with AsyncSessionLocal() as db:
        try:
            nodes_raw, edges_raw = await fetch_networkmap(
                mqtt_host=payload.mqtt_host,
                mqtt_port=payload.mqtt_port,
                base_topic=payload.base_topic,
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
            logger.exception("Zigbee import %s failed", run_id)
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
) -> ZigbeeImportPendingResponse:
    """Upsert nodes/edges into device_inventory + device_inventory_links.

    Coordinator auto-approves to a canvas Node. Other devices upsert by IEEE.
    All zigbee-source links are wiped and re-inserted from the new map.
    """
    # Repair any pre-existing duplicate nodes (same IEEE) before upserting, so
    # the by-IEEE lookups below resolve to a single row.
    await dedupe_nodes_by_ieee(db)

    # Coordinator is no longer auto-placed, so the response's coordinator fields
    # stay unset — retained for backward-compatible response shape.
    coordinator_out: ZigbeeCoordinatorOut | None = None
    coordinator_existed = False
    pending_created = 0
    pending_updated = 0

    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        props = build_zigbee_properties(
            ieee, n.get("vendor"), n.get("model"), n.get("lqi")
        )

        # The coordinator is no longer auto-placed on the canvas — it flows to
        # the pending inventory like every other device, so the user approves it
        # explicitly. Only the shared paths below run for it.

        # If the device has already been approved as a canvas Node, refresh its
        # properties on every canvas it sits on. Still ensure the discovery
        # inventory carries a row for it (status="approved") so it shows in the
        # inventory list with an "In N canvas" badge — legacy auto-placed
        # coordinators never got a pending row, which is why they went missing.
        existing_nodes = (
            await db.execute(
                select(Node).where(Node.ieee_address == ieee).order_by(Node.id)
            )
        ).scalars().all()
        if existing_nodes:
            for existing_node in existing_nodes:
                existing_node.properties = merge_zigbee_properties(
                    existing_node.properties, props
                )
            inv = (
                await db.execute(
                    select(InventoryDevice).where(InventoryDevice.ieee_address == ieee)
                )
            ).scalar_one_or_none()
            if inv is None:
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
                        status="approved",
                        discovery_source="zigbee",
                    )
                )
                pending_created += 1
            else:
                # Refresh metadata but never change the row's status (an approved
                # device stays approved; a hidden one stays hidden).
                inv.friendly_name = n.get("friendly_name") or inv.friendly_name
                inv.suggested_type = n.get("type") or inv.suggested_type
                inv.device_subtype = n.get("device_type") or inv.device_subtype
                inv.model = n.get("model") or inv.model
                inv.vendor = n.get("vendor") or inv.vendor
                if n.get("lqi") is not None:
                    inv.lqi = n.get("lqi")
                pending_updated += 1
            continue

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
                    status="pending",
                    discovery_source="zigbee",
                )
            )
            pending_created += 1
        else:
            pending.friendly_name = n.get("friendly_name") or pending.friendly_name
            pending.suggested_type = n.get("type") or pending.suggested_type
            pending.device_subtype = n.get("device_type") or pending.device_subtype
            pending.model = n.get("model") or pending.model
            pending.vendor = n.get("vendor") or pending.vendor
            if n.get("lqi") is not None:
                pending.lqi = n.get("lqi")
            if pending.status == "approved":
                # The device was approved earlier but its canvas Node no longer
                # exists (no Node matched the IEEE above) — it was deleted. Revive
                # the row to "pending" so it reappears in the Pending list on
                # re-import instead of being silently swallowed. (Issue #167)
                pending.status = "pending"
            elif pending.status == "hidden":
                # Re-imported a hidden device → leave it hidden, just refresh fields.
                pass
            pending_updated += 1

    # Replace all zigbee-source links with the freshly discovered set.
    await db.execute(
        sa_delete(InventoryDeviceLink).where(InventoryDeviceLink.discovery_source == "zigbee")
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
                discovery_source="zigbee",
            )
        )
        links_recorded += 1

    await db.commit()

    return ZigbeeImportPendingResponse(
        pending_created=pending_created,
        pending_updated=pending_updated,
        coordinator=coordinator_out,
        coordinator_already_existed=coordinator_existed,
        links_recorded=links_recorded,
        device_count=len(nodes_raw),
    )


@router.post("/test-connection", response_model=ZigbeeTestConnectionResponse)
async def test_zigbee_connection(
    payload: ZigbeeTestConnectionRequest,
    _: str = Depends(get_current_user),
) -> ZigbeeTestConnectionResponse:
    """Quick MQTT ping to validate broker connection before importing."""
    try:
        await test_mqtt_connection(
            mqtt_host=payload.mqtt_host,
            mqtt_port=payload.mqtt_port,
            username=payload.mqtt_username,
            password=payload.mqtt_password,
            tls=payload.mqtt_tls,
            tls_insecure=payload.mqtt_tls_insecure,
        )
        return ZigbeeTestConnectionResponse(connected=True, message="Connection successful")
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except (ConnectionError, TimeoutError) as exc:
        return ZigbeeTestConnectionResponse(connected=False, message=str(exc))
    except Exception:
        logger.exception("Unexpected error during connection test")
        return ZigbeeTestConnectionResponse(connected=False, message="Unexpected error")


@router.get("/config", response_model=ZigbeeConfig)
async def get_zigbee_config(_: str = Depends(get_current_user)) -> ZigbeeConfig:
    """Return non-secret Zigbee config. Never includes MQTT credentials — only
    whether a host is configured on the server for auto-sync."""
    return ZigbeeConfig(
        mqtt_host=settings.zigbee_mqtt_host,
        mqtt_port=settings.zigbee_mqtt_port,
        base_topic=settings.zigbee_base_topic,
        mqtt_tls=settings.zigbee_mqtt_tls,
        sync_enabled=settings.zigbee_sync_enabled,
        sync_interval=settings.zigbee_sync_interval,
        host_configured=bool(settings.zigbee_mqtt_host),
    )


@router.post("/config", response_model=ZigbeeConfig)
async def save_zigbee_config(
    payload: ZigbeeSyncConfig,
    _: str = Depends(get_current_user),
) -> ZigbeeConfig:
    """Persist the auto-sync activation (enabled + interval) and apply it live.

    This is the ONLY Zigbee config the app writes. Connection settings
    (host/port/credentials/topic/tls) are env-only and are never accepted or
    persisted here — enabling auto-sync requires the MQTT host already set in
    the server env, since the scheduled job reads it from there.
    """
    if payload.sync_enabled and not settings.zigbee_mqtt_host:
        raise HTTPException(
            status_code=400,
            detail="Cannot enable auto-sync: no Zigbee MQTT host configured in the server env.",
        )
    try:
        settings.zigbee_sync_enabled = payload.sync_enabled
        settings.zigbee_sync_interval = payload.sync_interval
        settings.save_overrides()
        set_zigbee_sync_enabled(payload.sync_enabled)
        if payload.sync_enabled:
            reschedule_zigbee_sync(payload.sync_interval)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return await get_zigbee_config()
