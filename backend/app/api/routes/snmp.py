"""SNMP metrics and LLDP topology discovery endpoints."""
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.scheduler import (
    reschedule_lldp_discovery,
    reschedule_snmp_poll,
    set_lldp_discovery_enabled,
    set_snmp_poll_enabled,
)
from app.db.database import get_db
from app.db.models import Edge, InventoryDevice, Node, SnmpMetric
from app.schemas.snmp import LldpNeighbor, SnmpMetricOut, TopologyDiscoveryResult
from app.services.snmp import poll_device

logger = logging.getLogger(__name__)
router = APIRouter()


class SnmpConfig(BaseModel):
    snmp_poll_enabled: bool = False
    snmp_poll_interval: int = Field(default=300, ge=60)
    lldp_discovery_enabled: bool = False
    lldp_discovery_interval: int = Field(default=3600, ge=300)


@router.get("/config", response_model=SnmpConfig)
async def get_snmp_config(_: str = Depends(get_current_user)) -> SnmpConfig:
    return SnmpConfig(
        snmp_poll_enabled=settings.snmp_poll_enabled,
        snmp_poll_interval=settings.snmp_poll_interval,
        lldp_discovery_enabled=settings.lldp_discovery_enabled,
        lldp_discovery_interval=settings.lldp_discovery_interval,
    )


@router.post("/config", response_model=SnmpConfig)
async def update_snmp_config(
    payload: SnmpConfig, _: str = Depends(get_current_user)
) -> SnmpConfig:
    try:
        settings.snmp_poll_enabled = payload.snmp_poll_enabled
        settings.snmp_poll_interval = payload.snmp_poll_interval
        settings.lldp_discovery_enabled = payload.lldp_discovery_enabled
        settings.lldp_discovery_interval = payload.lldp_discovery_interval
        settings.save_overrides()
        set_snmp_poll_enabled(payload.snmp_poll_enabled)
        if payload.snmp_poll_enabled:
            reschedule_snmp_poll(payload.snmp_poll_interval)
        set_lldp_discovery_enabled(payload.lldp_discovery_enabled)
        if payload.lldp_discovery_enabled:
            reschedule_lldp_discovery(payload.lldp_discovery_interval)
        return payload
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _norm_mac(mac: str) -> str:
    return mac.lower().replace(":", "").replace("-", "").replace(".", "")


async def _match_neighbor_to_device(
    neighbor: dict[str, Any],
    db: AsyncSession,
) -> InventoryDevice | None:
    chassis = neighbor.get("chassis_id") or ""
    sys_name = (neighbor.get("sys_name") or "").lower()

    all_devices = (await db.execute(select(InventoryDevice))).scalars().all()
    norm_chassis = _norm_mac(chassis) if chassis else ""

    for d in all_devices:
        if chassis and d.ip:
            for ip in d.ip.split(","):
                if ip.strip() == chassis:
                    return d
        if norm_chassis and d.mac and _norm_mac(d.mac) == norm_chassis:
            return d
        if sys_name:
            if d.hostname and d.hostname.lower() == sys_name:
                return d
            if d.label and d.label.lower() == sys_name:
                return d
    return None


@router.get("/{device_id}/metrics", response_model=list[SnmpMetricOut])
async def get_snmp_metrics(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[SnmpMetric]:
    device = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id == device_id))
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    rows = (
        await db.execute(select(SnmpMetric).where(SnmpMetric.device_id == device_id))
    ).scalars().all()
    return list(rows)


@router.post("/{device_id}/poll", response_model=list[SnmpMetricOut])
async def poll_snmp_now(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[SnmpMetric]:
    device = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id == device_id))
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.ip:
        raise HTTPException(status_code=422, detail="Device has no IP address")

    results = await poll_device(
        host=device.ip.split(",")[0].strip(),
        community=device.snmp_community or "public",
        version=device.snmp_version or "2c",
        port=device.snmp_port or 161,
        oids=list(device.snmp_oids) if device.snmp_oids else None,
    )

    now = datetime.now(timezone.utc)
    for r in results:
        await db.execute(
            text(
                "INSERT OR REPLACE INTO snmp_metrics "
                "(device_id, oid, label, value, value_type, polled_at) "
                "VALUES (:device_id, :oid, :label, :value, :value_type, :polled_at)"
            ),
            {
                "device_id": device_id,
                "oid": r["oid"],
                "label": r.get("label"),
                "value": r.get("value"),
                "value_type": r.get("value_type"),
                "polled_at": now,
            },
        )
    await db.commit()

    rows = (
        await db.execute(select(SnmpMetric).where(SnmpMetric.device_id == device_id))
    ).scalars().all()
    return list(rows)


@router.get("/{device_id}/neighbors", response_model=list[LldpNeighbor])
async def get_lldp_neighbors(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> list[dict[str, Any]]:
    from app.services.lldp import discover_neighbors

    device = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id == device_id))
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.ip:
        raise HTTPException(status_code=422, detail="Device has no IP address")

    return await discover_neighbors(
        host=device.ip.split(",")[0].strip(),
        community=device.snmp_community or "public",
        port=device.snmp_port or 161,
    )


@router.post("/{device_id}/discover", response_model=TopologyDiscoveryResult)
async def discover_topology(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> TopologyDiscoveryResult:
    from app.services.lldp import discover_neighbors

    device = (
        await db.execute(select(InventoryDevice).where(InventoryDevice.id == device_id))
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.ip:
        raise HTTPException(status_code=422, detail="Device has no IP address")

    neighbors = await discover_neighbors(
        host=device.ip.split(",")[0].strip(),
        community=device.snmp_community or "public",
        port=device.snmp_port or 161,
    )

    src_nodes = (
        await db.execute(select(Node).where(Node.device_id == device_id))
    ).scalars().all()

    edges_created = 0
    for neighbor in neighbors:
        matched = await _match_neighbor_to_device(neighbor, db)
        if not matched or matched.id == device_id:
            continue

        tgt_nodes = (
            await db.execute(select(Node).where(Node.device_id == matched.id))
        ).scalars().all()
        if not src_nodes or not tgt_nodes:
            continue

        src_node_id = src_nodes[0].id
        tgt_node_id = tgt_nodes[0].id

        existing = (
            await db.execute(
                select(Edge).where(
                    or_(
                        (Edge.source == src_node_id) & (Edge.target == tgt_node_id),
                        (Edge.source == tgt_node_id) & (Edge.target == src_node_id),
                    )
                )
            )
        ).scalar_one_or_none()
        if existing:
            continue

        edge = Edge(
            source=src_node_id,
            target=tgt_node_id,
            design_id=src_nodes[0].design_id,
            type="ethernet",
            label="LLDP",
        )
        db.add(edge)
        edges_created += 1

    if edges_created:
        await db.commit()

    return TopologyDiscoveryResult(
        neighbors=[LldpNeighbor(**n) for n in neighbors],
        edges_created=edges_created,
    )
