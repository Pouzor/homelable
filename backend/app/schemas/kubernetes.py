"""Public, sanitized Kubernetes topology response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

KubernetesTopologyState = Literal["disabled", "never_synced", "syncing", "fresh", "stale", "error"]


class KubernetesSyncOut(BaseModel):
    enabled: bool
    configured: bool
    state: KubernetesTopologyState
    last_success_at: datetime | None = None
    last_attempt_at: datetime | None = None
    last_error: str | None = None
    object_count: int = 0
    relationship_count: int = 0


class KubernetesClusterOut(BaseModel):
    id: str
    name: str


class KubernetesObjectOut(BaseModel):
    id: str
    kind: str
    name: str
    namespace: str | None = None
    status: str | None = None
    properties: dict[str, Any] | None = None


class KubernetesRelationshipOut(BaseModel):
    source: str
    target: str
    kind: str
    properties: dict[str, Any] | None = None


class KubernetesTopologyOut(BaseModel):
    schema_version: int = Field(1, serialization_alias="schemaVersion")
    cluster: KubernetesClusterOut
    sync: KubernetesSyncOut
    objects: list[KubernetesObjectOut]
    relationships: list[KubernetesRelationshipOut]
