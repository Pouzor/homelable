from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import settings
from app.services.kubernetes_client import (
    InClusterKubernetesTopologyClient,
    KubeconfigKubernetesTopologyClient,
    KubernetesClientError,
    create_kubernetes_topology_client,
)


class _FakeApiClient:
    closed = False

    async def close(self) -> None:
        self.closed = True


class _FakeApi:
    calls: list[tuple[str, dict[str, Any]]] = []

    def __init__(self, _: _FakeApiClient) -> None:
        pass

    def __getattr__(self, name: str):
        async def call(**kwargs: Any) -> Any:
            self.calls.append((name, kwargs))
            return SimpleNamespace(items=[SimpleNamespace(to_dict=lambda: {"kind": "Pod", "metadata": {}})])

        return call


class _FailingApi(_FakeApi):
    def __getattr__(self, _: str):
        async def call(**__: Any) -> Any:
            raise RuntimeError("unavailable")

        return call


async def test_in_cluster_client_lists_every_required_resource_and_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    api_client = _FakeApiClient()
    _FakeApi.calls = []
    fake_client = SimpleNamespace(
        ApiClient=lambda: api_client,
        CoreV1Api=_FakeApi,
        AppsV1Api=_FakeApi,
        BatchV1Api=_FakeApi,
        NetworkingV1Api=_FakeApi,
    )
    fake_config = SimpleNamespace(load_incluster_config=lambda: None)
    monkeypatch.setitem(sys.modules, "kubernetes_asyncio", SimpleNamespace(client=fake_client, config=fake_config))

    collected = await InClusterKubernetesTopologyClient().collect()

    assert set(collected) == {
        "nodes", "namespaces", "pods", "services", "endpoint_slices", "endpoints", "replicasets",
        "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "ingresses",
    }
    assert {name for name, _ in _FakeApi.calls} == {
        "list_node",
        "list_namespace",
        "list_pod_for_all_namespaces",
        "list_service_for_all_namespaces",
        "list_endpoint_slice_for_all_namespaces",
        "list_endpoints_for_all_namespaces",
        "list_replica_set_for_all_namespaces",
        "list_deployment_for_all_namespaces",
        "list_stateful_set_for_all_namespaces",
        "list_daemon_set_for_all_namespaces",
        "list_job_for_all_namespaces",
        "list_cron_job_for_all_namespaces",
        "list_ingress_for_all_namespaces",
    }
    assert all("_request_timeout" in kwargs for _, kwargs in _FakeApi.calls)
    assert api_client.closed


async def test_client_closes_api_connection_after_collection_error(monkeypatch: pytest.MonkeyPatch) -> None:
    api_client = _FakeApiClient()
    fake_client = SimpleNamespace(
        ApiClient=lambda: api_client,
        CoreV1Api=_FailingApi,
        AppsV1Api=_FailingApi,
        BatchV1Api=_FailingApi,
        NetworkingV1Api=_FailingApi,
    )
    fake_config = SimpleNamespace(load_incluster_config=lambda: None)
    monkeypatch.setitem(sys.modules, "kubernetes_asyncio", SimpleNamespace(client=fake_client, config=fake_config))

    with pytest.raises(KubernetesClientError, match="Unable to list Kubernetes"):
        await InClusterKubernetesTopologyClient().collect()

    assert api_client.closed


async def test_client_timeout_is_sanitized() -> None:
    client = InClusterKubernetesTopologyClient(request_timeout_seconds=0.001)

    async def never_returns(**_: Any) -> Any:
        await asyncio.Event().wait()

    with pytest.raises(KubernetesClientError, match="Unable to list Kubernetes pods"):
        await client._list("pods", never_returns)


def test_auto_source_prefers_in_cluster_then_read_only_kubeconfig(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "kubernetes_source", "auto")
    monkeypatch.setattr(settings, "kubernetes_kubeconfig_path", "/run/kubeconfig/config")
    monkeypatch.setattr(settings, "kubernetes_kubeconfig_context", "test")
    monkeypatch.setenv("KUBERNETES_SERVICE_HOST", "10.0.0.1")
    assert isinstance(create_kubernetes_topology_client(), InClusterKubernetesTopologyClient)

    monkeypatch.delenv("KUBERNETES_SERVICE_HOST")
    selected = create_kubernetes_topology_client()
    assert isinstance(selected, KubeconfigKubernetesTopologyClient)
    assert selected.path == "/run/kubeconfig/config"
    assert selected.context == "test"
