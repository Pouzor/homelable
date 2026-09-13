"""APScheduler setup for background scan and status check jobs."""
import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.db.models import InventoryDevice, Node
from app.services.kubernetes_sync import sync_kubernetes_topology
from app.services.status_checker import check_node, check_services

if TYPE_CHECKING:
    from app.schemas.zigbee import ZigbeeImportRequest
    from app.schemas.zwave import ZwaveImportRequest

logger = logging.getLogger(__name__)

scheduler: AsyncIOScheduler = AsyncIOScheduler()


async def _nodes_by_device(db: AsyncSession) -> dict[str, list[str]]:
    """Map each device id to the nodes drawing it, across every canvas."""
    rows = (await db.execute(select(Node.id, Node.device_id).where(Node.device_id.is_not(None)))).all()
    out: dict[str, list[str]] = {}
    for node_id, device_id in rows:
        out.setdefault(device_id, []).append(node_id)
    return out


async def _check_single_device(
    device_id: str,
    node_ids: list[str],
    check_method: str,
    check_target: str | None,
    ip: str | None,
) -> tuple[str, dict[str, object] | None]:
    """Run a single device check; returns (device_id, result_or_None).

    Accepts plain scalars — not an ORM object — so there is no risk of
    DetachedInstanceError when the originating session has already closed.
    """
    from app.api.routes.status import broadcast_status  # avoid circular import

    try:
        check_result = await check_node(check_method, check_target, ip)
        raw_ms = check_result["response_time_ms"]
        response_ms = raw_ms if isinstance(raw_ms, int) else None
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            device = await db.get(InventoryDevice, device_id)
            if device:
                device.status_live = str(check_result["status"])
                device.response_time_ms = response_ms
                if check_result["status"] == "online":
                    device.last_seen = now
                await db.commit()
        await broadcast_status(
            device_id=device_id,
            node_ids=node_ids,
            status=str(check_result["status"]),
            checked_at=now.isoformat(),
            response_time_ms=response_ms,
        )
        return device_id, check_result
    except Exception as exc:
        logger.error("Status check failed for device %s: %s", device_id, exc)
        return device_id, None


async def _run_status_checks() -> None:
    """Check every device once and broadcast the result to every canvas.

    Device-scoped, not node-scoped: a host drawn on three canvases used to be
    pinged three times and could report three different states. Hidden devices
    are skipped — hiding one is how a user says "stop showing me this".

    A device with no node at all is still checked, deliberately. The inventory
    row owns the device and shows its live status in the list and the detail
    modal, so a rack mount or an inventory-only entry reports state without
    being drawn anywhere — and deleting a node no longer silently stops
    monitoring the host. `hide` (or clearing the check method) is what ends the
    checks; the broadcast simply carries an empty `node_ids`.
    """
    async with AsyncSessionLocal() as db:
        devices = (
            await db.execute(
                select(InventoryDevice).where(
                    InventoryDevice.check_method.is_not(None),
                    InventoryDevice.check_method != "",
                    InventoryDevice.status != "hidden",
                )
            )
        ).scalars().all()
        node_map = await _nodes_by_device(db)
        # Extract scalars while the session is open to avoid DetachedInstanceError
        checkable = [
            (d.id, node_map.get(d.id, []), d.check_method or "ping", d.check_target, d.ip)
            for d in devices
        ]

    if not checkable:
        return

    await asyncio.gather(*[
        _check_single_device(device_id, node_ids, method, target, ip)
        for device_id, node_ids, method, target, ip in checkable
    ])


def _node_host(ip: str | None, hostname: str | None) -> str | None:
    """Pick the address to probe services on: first IP, else hostname."""
    if ip:
        first = ip.split(",")[0].strip()
        if first:
            return first
    return hostname or None


async def _run_service_checks() -> None:
    """Check every service of every device and broadcast per-service results.

    Device-scoped for the same reason as the status check: the services belong
    to the device, so one pass serves every canvas showing it.
    """
    if not settings.service_check_enabled:
        return
    from app.api.routes.status import broadcast_service_status  # avoid circular import

    async with AsyncSessionLocal() as db:
        devices = (
            await db.execute(select(InventoryDevice).where(InventoryDevice.status != "hidden"))
        ).scalars().all()
        node_map = await _nodes_by_device(db)
        checkable = [
            (d.id, node_map.get(d.id, []), _node_host(d.ip, d.hostname), list(d.services or []))
            for d in devices
            if d.services
        ]

    now = datetime.now(timezone.utc).isoformat()
    for device_id, node_ids, host, services in checkable:
        try:
            statuses = await check_services(host, services)
            await broadcast_service_status(
                device_id=device_id, node_ids=node_ids, services=statuses, checked_at=now
            )
        except Exception as exc:
            logger.error("Service checks failed for device %s: %s", device_id, exc)


async def _run_proxmox_sync() -> None:
    """Fetch the Proxmox inventory and upsert it into pending (auto-sync).

    Records a ScanRun (kind=proxmox) so the scheduled sync shows in Scan
    history, exactly like the manual /sync-now and /import-pending paths.
    """
    if not settings.proxmox_sync_enabled:
        return
    if not (settings.proxmox_host and settings.proxmox_token_id and settings.proxmox_token_secret):
        logger.warning("Proxmox auto-sync enabled but host/token not configured — skipping")
        return
    # Lazy import to avoid a circular import at module load.
    from app.api.routes.proxmox import _background_proxmox_import
    from app.db.models import ScanRun

    async with AsyncSessionLocal() as db:
        run = ScanRun(
            status="running",
            kind="proxmox",
            ranges=[f"{settings.proxmox_host}:{settings.proxmox_port}"],
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    # Shares the manual-sync flow: fetch + persist + mark the run done/error +
    # broadcast the inventory-reload signal.
    await _background_proxmox_import(
        run_id,
        settings.proxmox_host,
        settings.proxmox_port,
        settings.proxmox_token_id,
        settings.proxmox_token_secret,
        settings.proxmox_verify_tls,
    )


async def _run_mesh_sync(kind: str) -> None:
    """Shared auto-sync for the MQTT mesh imports (Zigbee / Z-Wave).

    Records a ScanRun (kind=zigbee|zwave) so the scheduled sync shows in Scan
    history, then delegates to the exact same background import the manual
    /sync-now and /import-pending paths use. Connection config comes from the
    server env only (credentials never leave it).
    """
    from app.db.models import ScanRun

    payload: ZigbeeImportRequest | ZwaveImportRequest
    background: Callable[[str, Any], Awaitable[None]]

    if kind == "zigbee":
        if not settings.zigbee_sync_enabled:
            return
        if not settings.zigbee_mqtt_host:
            logger.warning("Zigbee auto-sync enabled but MQTT host not configured — skipping")
            return
        from app.api.routes.zigbee import _background_zigbee_import
        from app.api.routes.zigbee import env_import_request as _zigbee_env_request
        host, port = settings.zigbee_mqtt_host, settings.zigbee_mqtt_port
        payload = _zigbee_env_request()
        background = _background_zigbee_import
    else:
        if not settings.zwave_sync_enabled:
            return
        if not settings.zwave_mqtt_host:
            logger.warning("Z-Wave auto-sync enabled but MQTT host not configured — skipping")
            return
        from app.api.routes.zwave import _background_zwave_import
        from app.api.routes.zwave import env_import_request as _zwave_env_request
        host, port = settings.zwave_mqtt_host, settings.zwave_mqtt_port
        payload = _zwave_env_request()
        background = _background_zwave_import
    async with AsyncSessionLocal() as db:
        run = ScanRun(status="running", kind=kind, ranges=[f"{host}:{port}"])
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

    await background(run_id, payload)


async def _run_zigbee_sync() -> None:
    await _run_mesh_sync("zigbee")


async def _run_zwave_sync() -> None:
    await _run_mesh_sync("zwave")


async def _run_kubernetes_sync() -> None:
    """Refresh the observed graph; failures retain the last successful snapshot."""
    # Strict opt-in avoids a MagicMock (or another non-boolean config adapter)
    # unexpectedly scheduling API traffic in test and embedded deployments.
    if settings.kubernetes_enabled is not True:
        return
    async with AsyncSessionLocal() as db:
        await sync_kubernetes_topology(db)


def _add_service_check_job() -> None:
    scheduler.add_job(
        _run_service_checks,
        "interval",
        seconds=settings.service_check_interval,
        id="service_checks",
        max_instances=1,
        coalesce=True,
    )


def _add_proxmox_sync_job() -> None:
    scheduler.add_job(
        _run_proxmox_sync,
        "interval",
        seconds=settings.proxmox_sync_interval,
        id="proxmox_sync",
        max_instances=1,
        coalesce=True,
    )


def _add_zigbee_sync_job() -> None:
    scheduler.add_job(
        _run_zigbee_sync,
        "interval",
        seconds=settings.zigbee_sync_interval,
        id="zigbee_sync",
        max_instances=1,
        coalesce=True,
    )


def _add_zwave_sync_job() -> None:
    scheduler.add_job(
        _run_zwave_sync,
        "interval",
        seconds=settings.zwave_sync_interval,
        id="zwave_sync",
        max_instances=1,
        coalesce=True,
    )


def _add_kubernetes_sync_job() -> None:
    scheduler.add_job(
        _run_kubernetes_sync,
        "interval",
        seconds=settings.kubernetes_sync_interval,
        id="kubernetes_sync",
        max_instances=1,
        coalesce=True,
    )


def start_scheduler() -> None:
    global scheduler
    if scheduler.running:
        try:
            scheduler.shutdown(wait=False)
        except Exception as exc:
            logger.warning("Failed to shut down previous scheduler instance: %s", exc)
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_status_checks,
        "interval",
        seconds=settings.status_checker_interval,
        id="status_checks",
        max_instances=1,
        coalesce=True,
    )
    if settings.service_check_enabled:
        _add_service_check_job()
    if settings.proxmox_sync_enabled:
        _add_proxmox_sync_job()
    if settings.zigbee_sync_enabled:
        _add_zigbee_sync_job()
    if settings.zwave_sync_enabled:
        _add_zwave_sync_job()
    if settings.kubernetes_enabled is True:
        _add_kubernetes_sync_job()
    scheduler.start()
    logger.info("Scheduler started — status checks every %ds", settings.status_checker_interval)


def reschedule_status_checks(interval_seconds: int) -> None:
    """Update the status check interval on the running scheduler."""
    if interval_seconds < 10:
        raise ValueError(f"interval_seconds must be >= 10, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    scheduler.reschedule_job("status_checks", trigger="interval", seconds=interval_seconds)
    logger.info("Status checks rescheduled to every %ds", interval_seconds)


def reschedule_service_checks(interval_seconds: int) -> None:
    """Update the service-check interval on the running scheduler (if enabled)."""
    if interval_seconds < 30:
        raise ValueError(f"interval_seconds must be >= 30, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    if scheduler.get_job("service_checks"):
        scheduler.reschedule_job("service_checks", trigger="interval", seconds=interval_seconds)
        logger.info("Service checks rescheduled to every %ds", interval_seconds)


def set_service_checks_enabled(enabled: bool) -> None:
    """Add or remove the service-check job on the running scheduler."""
    if not scheduler.running:
        return
    job = scheduler.get_job("service_checks")
    if enabled and not job:
        _add_service_check_job()
        logger.info("Service checks enabled — every %ds", settings.service_check_interval)
    elif not enabled and job:
        scheduler.remove_job("service_checks")
        logger.info("Service checks disabled")


def reschedule_proxmox_sync(interval_seconds: int) -> None:
    """Update the Proxmox auto-sync interval on the running scheduler (if enabled)."""
    if interval_seconds < 300:
        raise ValueError(f"interval_seconds must be >= 300, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    if scheduler.get_job("proxmox_sync"):
        scheduler.reschedule_job("proxmox_sync", trigger="interval", seconds=interval_seconds)
        logger.info("Proxmox auto-sync rescheduled to every %ds", interval_seconds)


def set_proxmox_sync_enabled(enabled: bool) -> None:
    """Add or remove the Proxmox auto-sync job on the running scheduler."""
    if not scheduler.running:
        return
    job = scheduler.get_job("proxmox_sync")
    if enabled and not job:
        _add_proxmox_sync_job()
        logger.info("Proxmox auto-sync enabled — every %ds", settings.proxmox_sync_interval)
    elif not enabled and job:
        scheduler.remove_job("proxmox_sync")
        logger.info("Proxmox auto-sync disabled")


def reschedule_zigbee_sync(interval_seconds: int) -> None:
    """Update the Zigbee auto-sync interval on the running scheduler (if enabled)."""
    if interval_seconds < 300:
        raise ValueError(f"interval_seconds must be >= 300, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    if scheduler.get_job("zigbee_sync"):
        scheduler.reschedule_job("zigbee_sync", trigger="interval", seconds=interval_seconds)
        logger.info("Zigbee auto-sync rescheduled to every %ds", interval_seconds)


def set_zigbee_sync_enabled(enabled: bool) -> None:
    """Add or remove the Zigbee auto-sync job on the running scheduler."""
    if not scheduler.running:
        return
    job = scheduler.get_job("zigbee_sync")
    if enabled and not job:
        _add_zigbee_sync_job()
        logger.info("Zigbee auto-sync enabled — every %ds", settings.zigbee_sync_interval)
    elif not enabled and job:
        scheduler.remove_job("zigbee_sync")
        logger.info("Zigbee auto-sync disabled")


def reschedule_zwave_sync(interval_seconds: int) -> None:
    """Update the Z-Wave auto-sync interval on the running scheduler (if enabled)."""
    if interval_seconds < 300:
        raise ValueError(f"interval_seconds must be >= 300, got {interval_seconds}")
    if not scheduler.running:
        logger.warning("Scheduler not running, skipping reschedule")
        return
    if scheduler.get_job("zwave_sync"):
        scheduler.reschedule_job("zwave_sync", trigger="interval", seconds=interval_seconds)
        logger.info("Z-Wave auto-sync rescheduled to every %ds", interval_seconds)


def set_zwave_sync_enabled(enabled: bool) -> None:
    """Add or remove the Z-Wave auto-sync job on the running scheduler."""
    if not scheduler.running:
        return
    job = scheduler.get_job("zwave_sync")
    if enabled and not job:
        _add_zwave_sync_job()
        logger.info("Z-Wave auto-sync enabled — every %ds", settings.zwave_sync_interval)
    elif not enabled and job:
        scheduler.remove_job("zwave_sync")
        logger.info("Z-Wave auto-sync disabled")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
