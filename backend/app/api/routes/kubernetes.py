"""Read-only API for reconciled Kubernetes topology snapshots."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.schemas.kubernetes import KubernetesSyncOut, KubernetesTopologyOut
from app.services.kubernetes_sync import stored_topology, sync_kubernetes_topology, sync_status

router = APIRouter()


@router.get("/status", response_model=KubernetesSyncOut)
async def get_kubernetes_status(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> KubernetesSyncOut:
    """Return sync freshness without contacting the Kubernetes API."""
    return await sync_status(db)


@router.get("/topology", response_model=KubernetesTopologyOut)
async def get_kubernetes_topology(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> dict[str, object]:
    """Return the last known-good, sanitized graph without contacting Kubernetes."""
    return await stored_topology(db)


@router.post("/sync", response_model=KubernetesSyncOut)
async def sync_kubernetes(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
) -> KubernetesSyncOut:
    """Request a serialized refresh using configured server-side credentials only."""
    return await sync_kubernetes_topology(db)
