from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.models import KubernetesSyncState
from app.services.kubernetes_client import configured_kubernetes_source
from app.services.kubernetes_sync import stored_topology, sync_kubernetes_topology, sync_status


class FakeClient:
    def __init__(self, payload: dict[str, list[dict[str, Any]]]) -> None:
        self.payload = payload

    async def collect(self) -> dict[str, list[dict[str, Any]]]:
        return self.payload


class FailingClient:
    async def collect(self) -> dict[str, list[dict[str, Any]]]:
        raise RuntimeError("token=do-not-expose")


def resource(kind: str, name: str, uid: str, namespace: str | None = None, **extra: Any) -> dict[str, Any]:
    metadata: dict[str, Any] = {"name": name, "uid": uid}
    if namespace:
        metadata["namespace"] = namespace
    return {"kind": kind, "metadata": metadata, **extra}


@pytest.fixture
def kubernetes_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kubernetes_enabled", True)
    monkeypatch.setattr(settings, "kubernetes_source", "in_cluster")
    monkeypatch.setattr(settings, "kubernetes_cluster_name", "test-cluster")


async def test_disabled_topology_is_empty_and_safe(db_session) -> None:
    original = settings.kubernetes_enabled
    settings.kubernetes_enabled = False
    try:
        assert (await sync_status(db_session)).state == "disabled"
        topology = await stored_topology(db_session)
    finally:
        settings.kubernetes_enabled = original

    assert topology["schemaVersion"] == 1
    assert topology["objects"] == []
    assert topology["relationships"] == []


async def test_successful_sync_persists_a_sanitized_snapshot(db_session, kubernetes_enabled) -> None:
    result = await sync_kubernetes_topology(
        db_session,
        client=FakeClient(
            {
                "namespaces": [resource("Namespace", "apps", "namespace-1")],
                "deployments": [resource("Deployment", "api", "deployment-1", "apps")],
                "services": [resource("Service", "api", "service-1", "apps", spec={"ports": [{"port": 80}]})],
                "ingresses": [
                    resource(
                        "Ingress",
                        "api",
                        "ingress-1",
                        "apps",
                        spec={
                            "rules": [
                                {
                                    "host": "api.example.test",
                                    "http": {
                                        "paths": [
                                            {
                                                "path": "/",
                                                "backend": {"service": {"name": "api", "port": {"number": 80}}},
                                            }
                                        ]
                                    },
                                }
                            ]
                        },
                    )
                ],
            }
        ),
    )

    topology = await stored_topology(db_session)

    assert result.state == "fresh"
    assert topology["sync"]["state"] == "fresh"
    assert topology["sync"]["object_count"] == len(topology["objects"])
    assert any(item["kind"] == "Ingress" for item in topology["objects"])
    rendered = str(topology)
    assert "labels" not in rendered
    assert "annotations" not in rendered


async def test_failed_sync_keeps_last_good_graph_and_sanitizes_error(db_session, kubernetes_enabled) -> None:
    first = FakeClient({"namespaces": [resource("Namespace", "apps", "namespace-1")]})
    await sync_kubernetes_topology(db_session, client=first)
    before = await stored_topology(db_session)

    result = await sync_kubernetes_topology(db_session, client=FailingClient())
    after = await stored_topology(db_session)

    assert result.state == "stale"
    assert result.last_error == "Kubernetes topology sync failed. Check backend logs."
    assert "token=" not in (result.last_error or "")
    assert after["objects"] == before["objects"]
    assert after["relationships"] == before["relationships"]


async def test_overdue_successful_snapshot_is_stale(db_session, kubernetes_enabled) -> None:
    await sync_kubernetes_topology(
        db_session,
        client=FakeClient({"namespaces": [resource("Namespace", "apps", "namespace-1")]}),
    )
    state = (await db_session.execute(select(KubernetesSyncState))).scalar_one()
    assert state.last_successful_at is not None
    state.last_successful_at -= timedelta(seconds=settings.kubernetes_sync_interval + 1)
    await db_session.commit()

    assert (await sync_status(db_session)).state == "stale"


async def test_unsafe_topology_is_not_persisted(db_session, kubernetes_enabled, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.kubernetes_sync.build_topology",
        lambda **_: {
            "cluster": {"id": "kubernetes://test-cluster", "name": "test-cluster"},
            "objects": [{"id": "x", "kind": "Pod", "name": "x", "properties": {"token": "nope"}}],
            "relationships": [],
        },
    )

    result = await sync_kubernetes_topology(db_session, client=FakeClient({}))
    topology = await stored_topology(db_session)

    assert result.state == "error"
    assert topology["objects"] == []


def test_kubeconfig_source_requires_only_an_env_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kubernetes_enabled", True)
    monkeypatch.setattr(settings, "kubernetes_source", "kubeconfig")
    monkeypatch.setattr(settings, "kubernetes_kubeconfig_path", "")
    assert not configured_kubernetes_source()

    monkeypatch.setattr(settings, "kubernetes_kubeconfig_path", "/run/kubeconfig/config")
    assert configured_kubernetes_source()
