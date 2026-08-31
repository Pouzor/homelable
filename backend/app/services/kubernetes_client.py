"""Read-only asynchronous Kubernetes API client used by topology sync.

The client uses a projected in-cluster ServiceAccount by default, or an
operator-mounted read-only kubeconfig in explicitly configured external mode.
A Homelable browser can never submit a kubeconfig or bearer token.
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping
from contextlib import suppress
from typing import Any, Protocol

TopologyLists = dict[str, list[dict[str, Any]]]


class KubernetesClientError(RuntimeError):
    """A safe, operator-facing Kubernetes collection error."""


class KubernetesTopologyClient(Protocol):
    """Boundary that lets sync tests use a deterministic, credential-free fake."""

    async def collect(self) -> TopologyLists: ...


class _KubernetesTopologyClientBase:
    """Shared API collection for the two server-side credential sources."""

    def __init__(self, *, request_timeout_seconds: float = 20.0) -> None:
        self.request_timeout_seconds = request_timeout_seconds

    async def collect(self) -> TopologyLists:
        try:
            from kubernetes_asyncio import client, config
        except ImportError as exc:  # pragma: no cover - exercised in deployed image
            raise KubernetesClientError("Kubernetes support is not installed") from exc

        try:
            await self._load_config(config)
            api_client = client.ApiClient()
            core = client.CoreV1Api(api_client)
            apps = client.AppsV1Api(api_client)
            batch = client.BatchV1Api(api_client)
            networking = client.NetworkingV1Api(api_client)
            calls = {
                "nodes": core.list_node,
                "namespaces": core.list_namespace,
                "pods": core.list_pod_for_all_namespaces,
                "services": core.list_service_for_all_namespaces,
                "endpoint_slices": core.list_endpoint_slice_for_all_namespaces,
                "endpoints": core.list_endpoints_for_all_namespaces,
                "replicasets": apps.list_replica_set_for_all_namespaces,
                "deployments": apps.list_deployment_for_all_namespaces,
                "statefulsets": apps.list_stateful_set_for_all_namespaces,
                "daemonsets": apps.list_daemon_set_for_all_namespaces,
                "jobs": batch.list_job_for_all_namespaces,
                "cronjobs": batch.list_cron_job_for_all_namespaces,
                "ingresses": networking.list_ingress_for_all_namespaces,
            }
            results = await asyncio.gather(*[
                self._list(name, call) for name, call in calls.items()
            ])
            return dict(results)
        except KubernetesClientError:
            raise
        except Exception as exc:  # HTTP errors and token/config failures are intentionally sanitized.
            raise KubernetesClientError("Kubernetes API collection failed") from exc
        finally:
            # ApiClient.close() is async in kubernetes-asyncio.  It is deliberately
            # best-effort so a close failure cannot turn a successful graph stale.
            if "api_client" in locals():
                with suppress(Exception):
                    await api_client.close()

    async def _load_config(self, config: Any) -> None:
        raise NotImplementedError

    async def _list(self, name: str, call: Any) -> tuple[str, list[dict[str, Any]]]:
        try:
            response = await asyncio.wait_for(
                call(_request_timeout=self.request_timeout_seconds),
                timeout=self.request_timeout_seconds + 1,
            )
        except Exception as exc:
            raise KubernetesClientError(f"Unable to list Kubernetes {name}") from exc
        items = getattr(response, "items", [])
        output: list[dict[str, Any]] = []
        for item in items:
            if hasattr(item, "to_dict"):
                value = item.to_dict()
            elif isinstance(item, Mapping):
                value = dict(item)
            else:
                continue
            output.append(value)
        return name, output


class InClusterKubernetesTopologyClient(_KubernetesTopologyClientBase):
    """Use the backend Pod's projected ServiceAccount token."""

    async def _load_config(self, config: Any) -> None:
        config.load_incluster_config()


class KubeconfigKubernetesTopologyClient(_KubernetesTopologyClientBase):
    """Use an operator-mounted read-only kubeconfig; never API-provided data."""

    def __init__(self, *, path: str, context: str = "", request_timeout_seconds: float = 20.0) -> None:
        super().__init__(request_timeout_seconds=request_timeout_seconds)
        self.path = path
        self.context = context or None

    async def _load_config(self, config: Any) -> None:
        if not self.path:
            raise KubernetesClientError("Kubernetes kubeconfig path is not configured")
        await config.load_kube_config(config_file=self.path, context=self.context)


def configured_kubernetes_source() -> bool:
    """Whether the configured source has enough server-side information to run."""
    from app.core.config import settings

    if not settings.kubernetes_enabled:
        return False
    if settings.kubernetes_source == "kubeconfig":
        return bool(settings.kubernetes_kubeconfig_path)
    if settings.kubernetes_source == "auto":
        return bool(os.environ.get("KUBERNETES_SERVICE_HOST") or settings.kubernetes_kubeconfig_path)
    return True


def create_kubernetes_topology_client() -> KubernetesTopologyClient:
    """Select a credential source without loading either until sync actually runs."""
    from app.core.config import settings

    source = settings.kubernetes_source
    if source == "in_cluster":
        return InClusterKubernetesTopologyClient()
    if source == "kubeconfig":
        return KubeconfigKubernetesTopologyClient(
            path=settings.kubernetes_kubeconfig_path,
            context=settings.kubernetes_kubeconfig_context,
        )
    if os.environ.get("KUBERNETES_SERVICE_HOST"):
        return InClusterKubernetesTopologyClient()
    if settings.kubernetes_kubeconfig_path:
        return KubeconfigKubernetesTopologyClient(
            path=settings.kubernetes_kubeconfig_path,
            context=settings.kubernetes_kubeconfig_context,
        )
    # auto outside a cluster with no path has no implicit host configuration.
    # Return the in-cluster client only so its normal, sanitized error handles
    # the state consistently if an operator enabled it by mistake.
    return InClusterKubernetesTopologyClient()
