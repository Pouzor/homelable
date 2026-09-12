"""Persist and serve reconciled, read-only Kubernetes topology snapshots."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import KubernetesCluster, KubernetesRelationship, KubernetesResource, KubernetesSyncState
from app.schemas.kubernetes import KubernetesSyncOut, KubernetesTopologyState
from app.services.kubernetes_client import (
    KubernetesTopologyClient,
    configured_kubernetes_source,
    create_kubernetes_topology_client,
)
from app.services.kubernetes_topology import build_topology

logger = logging.getLogger(__name__)
_sync_lock = asyncio.Lock()


def cluster_id(cluster_name: str | None = None) -> str:
    return f"kubernetes://{cluster_name or settings.kubernetes_cluster_name}"


def disabled_sync() -> KubernetesSyncOut:
    return KubernetesSyncOut(enabled=False, configured=False, state="disabled")


async def sync_kubernetes_topology(
    db: AsyncSession,
    *,
    client: KubernetesTopologyClient | None = None,
) -> KubernetesSyncOut:
    """Collect then atomically replace a snapshot, retaining last-good data on errors."""
    if not settings.kubernetes_enabled:
        return disabled_sync()
    if client is None and not configured_kubernetes_source():
        return await sync_status(db)
    if _sync_lock.locked():
        return await sync_status(db)

    async with _sync_lock:
        started = monotonic()
        attempted_at = _now()
        try:
            collected = await (client or create_kubernetes_topology_client()).collect()
            graph = build_topology(
                cluster_name=settings.kubernetes_cluster_name,
                nodes=collected.get("nodes", []),
                namespaces=collected.get("namespaces", []),
                workloads=[
                    *collected.get("deployments", []),
                    *collected.get("statefulsets", []),
                    *collected.get("daemonsets", []),
                ],
                replicasets=collected.get("replicasets", []),
                jobs=collected.get("jobs", []),
                cronjobs=collected.get("cronjobs", []),
                pods=collected.get("pods", []),
                services=collected.get("services", []),
                ingresses=collected.get("ingresses", []),
                endpoint_slices=collected.get("endpoint_slices", []),
                endpoints=collected.get("endpoints", []),
            )
            _ensure_safe_topology(graph)
            await _replace_snapshot(
                db,
                graph,
                attempted_at=attempted_at,
                duration_ms=_elapsed_ms(started),
            )
        except Exception:
            await db.rollback()
            logger.exception("Kubernetes topology sync failed")
            await _record_failure(db, attempted_at=attempted_at, duration_ms=_elapsed_ms(started))
        return await sync_status(db)


async def _replace_snapshot(
    db: AsyncSession,
    graph: dict[str, Any],
    *,
    attempted_at: datetime,
    duration_ms: int,
) -> None:
    """Replace one cluster snapshot in one transaction after it is fully normalized."""
    cluster = graph["cluster"]
    observed_cluster_id = str(cluster["id"])
    observed_at = _now()
    existing_cluster = await db.get(KubernetesCluster, observed_cluster_id)
    if existing_cluster is None:
        db.add(KubernetesCluster(id=observed_cluster_id, name=str(cluster["name"])))
    else:
        existing_cluster.name = str(cluster["name"])

    await db.execute(delete(KubernetesRelationship).where(KubernetesRelationship.cluster_id == observed_cluster_id))
    await db.execute(delete(KubernetesResource).where(KubernetesResource.cluster_id == observed_cluster_id))
    for item in graph["objects"]:
        db.add(
            KubernetesResource(
                id=str(item["id"]),
                cluster_id=observed_cluster_id,
                kind=str(item["kind"]),
                name=str(item["name"]),
                namespace=item.get("namespace"),
                status=item.get("status"),
                properties=item.get("properties"),
                observed_at=observed_at,
            )
        )
    for item in graph["relationships"]:
        db.add(
            KubernetesRelationship(
                id=_relationship_id(observed_cluster_id, item),
                cluster_id=observed_cluster_id,
                source=str(item["source"]),
                target=str(item["target"]),
                kind=str(item["kind"]),
                properties=item.get("properties"),
            )
        )

    state = await db.get(KubernetesSyncState, observed_cluster_id)
    if state is None:
        state = KubernetesSyncState(cluster_id=observed_cluster_id)
        db.add(state)
    state.status = "fresh"
    state.last_attempted_at = attempted_at
    state.last_successful_at = observed_at
    state.last_error = None
    state.duration_ms = duration_ms
    state.object_count = len(graph["objects"])
    state.relationship_count = len(graph["relationships"])
    await db.commit()


async def _record_failure(db: AsyncSession, *, attempted_at: datetime, duration_ms: int) -> None:
    observed_cluster_id = cluster_id()
    cluster = await db.get(KubernetesCluster, observed_cluster_id)
    if cluster is None:
        db.add(KubernetesCluster(id=observed_cluster_id, name=settings.kubernetes_cluster_name))
    state = await db.get(KubernetesSyncState, observed_cluster_id)
    if state is None:
        state = KubernetesSyncState(cluster_id=observed_cluster_id)
        db.add(state)
    state.status = "error"
    state.last_attempted_at = attempted_at
    # Never return exception text: Kubernetes clients can include URLs and
    # authorization diagnostics. Operators get a stable, non-sensitive state.
    state.last_error = "Kubernetes topology sync failed. Check backend logs."
    state.duration_ms = duration_ms
    await db.commit()


async def sync_status(db: AsyncSession) -> KubernetesSyncOut:
    if not settings.kubernetes_enabled:
        return disabled_sync()
    configured = configured_kubernetes_source()
    state = await db.get(KubernetesSyncState, cluster_id())
    if state is None:
        return KubernetesSyncOut(enabled=True, configured=configured, state="never_synced")
    public_state: KubernetesTopologyState
    if state.status == "fresh" and not _snapshot_overdue(state.last_successful_at):
        public_state = "fresh"
    elif state.last_successful_at is not None:
        public_state = "stale"
    else:
        public_state = "error"
    return KubernetesSyncOut(
        enabled=True,
        configured=configured,
        state=public_state,
        last_success_at=state.last_successful_at,
        last_attempt_at=state.last_attempted_at,
        last_error=state.last_error,
        object_count=state.object_count,
        relationship_count=state.relationship_count,
    )


async def stored_topology(db: AsyncSession) -> dict[str, Any]:
    """Return the last-good graph without making Kubernetes API calls."""
    observed_cluster_id = cluster_id()
    sync = await sync_status(db)
    cluster = {"id": observed_cluster_id, "name": settings.kubernetes_cluster_name}
    if not settings.kubernetes_enabled:
        return {"schemaVersion": 1, "cluster": cluster, "sync": sync.model_dump(), "objects": [], "relationships": []}
    resources = (
        await db.execute(
            select(KubernetesResource)
            .where(KubernetesResource.cluster_id == observed_cluster_id)
            .order_by(KubernetesResource.id)
        )
    ).scalars().all()
    relationships = (
        await db.execute(
            select(KubernetesRelationship)
            .where(KubernetesRelationship.cluster_id == observed_cluster_id)
            .order_by(KubernetesRelationship.source, KubernetesRelationship.kind, KubernetesRelationship.target)
        )
    ).scalars().all()
    return {
        "schemaVersion": 1,
        "cluster": cluster,
        "sync": sync.model_dump(mode="json"),
        "objects": [
            {
                "id": item.id,
                "kind": item.kind,
                "name": item.name,
                "namespace": item.namespace,
                "status": item.status,
                "properties": item.properties,
            }
            for item in resources
        ],
        "relationships": [
            {
                "source": item.source,
                "target": item.target,
                "kind": item.kind,
                "properties": item.properties,
            }
            for item in relationships
        ],
    }


def _relationship_id(observed_cluster_id: str, item: dict[str, Any]) -> str:
    encoded = json.dumps(
        [observed_cluster_id, item["source"], item["target"], item["kind"], item.get("properties")],
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _ensure_safe_topology(graph: dict[str, Any]) -> None:
    """Defence in depth: prevent future mapper additions from persisting secrets."""
    forbidden = {"annotations", "configmap", "env", "label", "password", "secret", "token"}

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if any(part in str(key).lower() for part in forbidden):
                    raise ValueError(f"Unsafe Kubernetes topology field: {key}")
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(graph)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _elapsed_ms(started: float) -> int:
    return int((monotonic() - started) * 1000)


def _snapshot_overdue(last_successful_at: datetime | None) -> bool:
    if last_successful_at is None:
        return False
    if last_successful_at.tzinfo is None:
        last_successful_at = last_successful_at.replace(tzinfo=timezone.utc)
    return _now() - last_successful_at > timedelta(seconds=settings.kubernetes_sync_interval)
