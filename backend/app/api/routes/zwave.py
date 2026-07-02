"""FastAPI router for Z-Wave JS UI (zwavejs2mqtt) import."""

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import AsyncSessionLocal, get_db
from app.db.models import Design, Node, PendingDevice, PendingDeviceLink, ScanRun
from app.schemas.scan import ScanRunResponse
from app.schemas.zwave import (
    ZwaveCoordinatorOut,
    ZwaveEdgeOut,
    ZwaveImportPendingResponse,
    ZwaveImportRequest,
    ZwaveImportResponse,
    ZwaveNodeOut,
    ZwaveTestConnectionRequest,
    ZwaveTestConnectionResponse,
)
from app.services.zwave_service import (
    build_zwave_properties,
    fetch_zwave_network,
    merge_zwave_properties,
    test_zwave_connection,
)

logger = logging.getLogger(__name__)
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
    """Upsert nodes/edges into pending_devices + pending_device_links.

    Coordinator auto-approves to a canvas Node. Other devices upsert by Z-Wave
    identity. All zwave-source links are wiped and re-inserted from the new map.
    """
    first_design = (await db.execute(select(Design).order_by(Design.created_at).limit(1))).scalar()
    default_design_id = first_design.id if first_design else None

    coordinator_out: ZwaveCoordinatorOut | None = None
    coordinator_existed = False
    pending_created = 0
    pending_updated = 0

    for n in nodes_raw:
        ieee = n.get("ieee_address")
        if not ieee:
            continue
        props = build_zwave_properties(ieee, n.get("vendor"), n.get("model"))

        if n.get("type") == "zwave_coordinator":
            existing = await db.execute(select(Node).where(Node.ieee_address == ieee))
            existing_node = existing.scalar_one_or_none()
            if existing_node:
                existing_node.properties = merge_zwave_properties(
                    existing_node.properties, props
                )
                coordinator_out = ZwaveCoordinatorOut(
                    id=existing_node.id,
                    label=existing_node.label,
                    ieee_address=ieee,
                )
                coordinator_existed = True
                continue
            label = n.get("friendly_name") or ieee
            node = Node(
                label=label,
                type=n.get("type") or "zwave_coordinator",
                status="online",
                check_method="none",
                ieee_address=ieee,
                services=[],
                properties=props,
                design_id=default_design_id,
            )
            db.add(node)
            await db.flush()
            coordinator_out = ZwaveCoordinatorOut(
                id=node.id, label=label, ieee_address=ieee
            )
            continue

        # Already approved as a canvas Node → refresh props, skip pending row.
        existing_node_q = await db.execute(
            select(Node).where(Node.ieee_address == ieee)
        )
        existing_node = existing_node_q.scalar_one_or_none()
        if existing_node:
            existing_node.properties = merge_zwave_properties(
                existing_node.properties, props
            )
            continue

        result = await db.execute(
            select(PendingDevice).where(PendingDevice.ieee_address == ieee)
        )
        pending = result.scalar_one_or_none()
        if pending is None:
            db.add(
                PendingDevice(
                    ieee_address=ieee,
                    friendly_name=n.get("friendly_name"),
                    hostname=n.get("friendly_name"),
                    suggested_type=n.get("type"),
                    device_subtype=n.get("device_type"),
                    model=n.get("model"),
                    vendor=n.get("vendor"),
                    lqi=n.get("lqi"),
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
            if pending.status == "approved":
                # Approved earlier but the canvas Node is gone (deleted) — revive
                # to "pending" so it reappears in the list instead of vanishing.
                pending.status = "pending"
            elif pending.status == "hidden":
                pass
            pending_updated += 1

    # Replace all zwave-source links with the freshly discovered set.
    await db.execute(
        sa_delete(PendingDeviceLink).where(PendingDeviceLink.discovery_source == "zwave")
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
            PendingDeviceLink(
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
