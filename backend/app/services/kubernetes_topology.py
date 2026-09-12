"""Normalize selected Kubernetes API lists into a safe topology graph.

This is deliberately a pure transformation layer.  It accepts the JSON-shaped
``items`` returned by the Kubernetes API and emits a graph without requiring a
kubeconfig, a Kubernetes client, or any write permission.  A future importer
can supply the lists with an in-cluster ServiceAccount or a user-selected
kubeconfig.

The graph excludes Secrets, ConfigMaps, container environment variables,
annotations, labels, and pod logs.  Those are not necessary to explain the
network path and would make the agent-facing representation needlessly risky.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import quote

Json = Mapping[str, Any]


@dataclass(frozen=True)
class TopologyObject:
    id: str
    kind: str
    name: str
    namespace: str | None = None
    status: str | None = None
    properties: dict[str, Any] | None = None


@dataclass(frozen=True)
class TopologyRelationship:
    source: str
    target: str
    kind: str
    properties: dict[str, Any] | None = None


def build_topology(
    *,
    cluster_name: str,
    nodes: Iterable[Json] = (),
    namespaces: Iterable[Json] = (),
    workloads: Iterable[Json] = (),
    replicasets: Iterable[Json] = (),
    jobs: Iterable[Json] = (),
    cronjobs: Iterable[Json] = (),
    pods: Iterable[Json] = (),
    services: Iterable[Json] = (),
    ingresses: Iterable[Json] = (),
    endpoint_slices: Iterable[Json] = (),
    endpoints: Iterable[Json] = (),
) -> dict[str, Any]:
    """Build a stable graph of the runtime routing path.

    The initial scope intentionally models only resources needed to answer
    ``hostname -> ingress -> service -> ready endpoint -> workload -> node``.
    Kubernetes UIDs anchor object IDs, so names can change without accidentally
    colliding with a separately imported device.
    """
    graph_objects: dict[str, TopologyObject] = {}
    relationships: dict[tuple[str, str, str, str], TopologyRelationship] = {}

    def add_relationship(
        source: str,
        target: str,
        kind: str,
        properties: dict[str, Any] | None = None,
    ) -> None:
        relationship = TopologyRelationship(source, target, kind, properties)
        relationships[_relationship_key(relationship)] = relationship

    def object_id(resource: Json) -> str | None:
        metadata = _mapping(resource.get("metadata"))
        uid = _string(metadata.get("uid"))
        if not uid:
            return None
        return f"kubernetes://{cluster_name}/{uid}"

    def add_object(
        resource: Json,
        *,
        kind: str | None = None,
        properties: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> str | None:
        resource_id = object_id(resource)
        metadata = _mapping(resource.get("metadata"))
        name = _string(metadata.get("name"))
        if not resource_id or not name:
            return None
        graph_objects[resource_id] = TopologyObject(
            id=resource_id,
            kind=kind or _string(resource.get("kind")) or "Unknown",
            name=name,
            namespace=_string(metadata.get("namespace")),
            status=status,
            properties=properties,
        )
        return resource_id

    cluster_id = f"kubernetes://{cluster_name}"
    graph_objects[cluster_id] = TopologyObject(
        id=cluster_id,
        kind="Cluster",
        name=cluster_name,
    )

    namespace_ids: dict[str, str] = {}
    for namespace_resource in namespaces:
        namespace_id = add_object(namespace_resource, kind="Namespace")
        name = _string(_mapping(namespace_resource.get("metadata")).get("name"))
        if namespace_id and name:
            namespace_ids[name] = namespace_id
            add_relationship(cluster_id, namespace_id, "contains")

    node_ids: dict[str, str] = {}
    for node in nodes:
        node_id = add_object(
            node,
            kind="Node",
            status=_node_status(node),
            properties={"roles": _node_roles(node)},
        )
        name = _string(_mapping(node.get("metadata")).get("name"))
        if node_id and name:
            node_ids[name] = node_id
            add_relationship(cluster_id, node_id, "contains")

    workload_ids: dict[tuple[str, str, str], str] = {}
    for workload in workloads:
        kind = _string(workload.get("kind"))
        if kind not in {"Deployment", "StatefulSet", "DaemonSet"}:
            continue
        workload_id = add_object(workload, properties=_workload_properties(workload))
        resource_metadata = _mapping(workload.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        if workload_id and namespace and name:
            workload_ids[(kind, namespace, name)] = workload_id
            _add_namespace_contains(namespace_ids, namespace, workload_id, relationships)

    cronjob_ids: dict[tuple[str, str], str] = {}
    for cronjob in cronjobs:
        cronjob_id = add_object(cronjob, kind="CronJob", properties=_cronjob_properties(cronjob))
        resource_metadata = _mapping(cronjob.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        if cronjob_id and namespace and name:
            cronjob_ids[(namespace, name)] = cronjob_id
            _add_namespace_contains(namespace_ids, namespace, cronjob_id, relationships)

    for job in jobs:
        job_id = add_object(job, kind="Job", properties=_job_properties(job))
        resource_metadata = _mapping(job.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        if not job_id or not namespace or not name:
            continue
        workload_ids[("Job", namespace, name)] = job_id
        _add_namespace_contains(namespace_ids, namespace, job_id, relationships)
        owner = _controller_owner(job)
        if owner and owner[0] == "CronJob":
            cronjob_id = cronjob_ids.get((namespace, owner[1]))
            if cronjob_id:
                add_relationship(cronjob_id, job_id, "owns")

    replicaset_owners: dict[tuple[str, str], str] = {}
    for replicaset in replicasets:
        resource_metadata = _mapping(replicaset.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        owner = _controller_owner(replicaset)
        if namespace and name and owner and owner[0] == "Deployment":
            owner_id = workload_ids.get((owner[0], namespace, owner[1]))
            if owner_id:
                replicaset_owners[(namespace, name)] = owner_id

    pod_ids: dict[tuple[str, str], str] = {}
    for pod in pods:
        pod_id = add_object(pod, kind="Pod", status=_pod_status(pod))
        resource_metadata = _mapping(pod.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        if not pod_id or not namespace or not name:
            continue
        pod_ids[(namespace, name)] = pod_id
        _add_namespace_contains(namespace_ids, namespace, pod_id, relationships)

        owner = _controller_owner(pod)
        if owner:
            owner_id = workload_ids.get((owner[0], namespace, owner[1]))
            if owner[0] == "ReplicaSet":
                owner_id = replicaset_owners.get((namespace, owner[1]))
            if owner_id:
                add_relationship(owner_id, pod_id, "owns")

        node_name = _string(_mapping(pod.get("spec")).get("nodeName"))
        if node_name in node_ids:
            add_relationship(pod_id, node_ids[node_name], "scheduled_on")

    service_ids: dict[tuple[str, str], str] = {}
    for service in services:
        service_id = add_object(service, kind="Service", properties=_service_properties(service))
        resource_metadata = _mapping(service.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        if service_id and namespace and name:
            service_ids[(namespace, name)] = service_id
            _add_namespace_contains(namespace_ids, namespace, service_id, relationships)

    for ingress in ingresses:
        ingress_id = add_object(ingress, kind="Ingress", properties=_ingress_properties(ingress))
        namespace = _string(_mapping(ingress.get("metadata")).get("namespace"))
        if not ingress_id or not namespace:
            continue
        _add_namespace_contains(namespace_ids, namespace, ingress_id, relationships)
        for backend in _ingress_backends(ingress):
            service_id = service_ids.get((namespace, backend["service"]))
            if service_id:
                add_relationship(
                    ingress_id,
                    service_id,
                    "routes_to",
                    {key: value for key, value in backend.items() if key != "service"},
                )

    slice_service_keys: set[tuple[str, str]] = set()
    for endpoint_slice in endpoint_slices:
        resource_metadata = _mapping(endpoint_slice.get("metadata"))
        namespace = _string(resource_metadata.get("namespace"))
        labels = _mapping(resource_metadata.get("labels"))
        service_name = _string(labels.get("kubernetes.io/service-name"))
        service_id = service_ids.get((namespace or "", service_name or ""))
        if not service_id or not namespace:
            continue
        slice_service_keys.add((namespace, service_name or ""))
        for endpoint in _list(endpoint_slice.get("endpoints")):
            conditions = _mapping(_mapping(endpoint).get("conditions"))
            if conditions.get("ready") is False:
                continue
            target_ref = _mapping(_mapping(endpoint).get("targetRef"))
            if _string(target_ref.get("kind")) == "Pod":
                pod_id = pod_ids.get((namespace, _string(target_ref.get("name")) or ""))
                if not pod_id:
                    continue
                add_relationship(
                    service_id,
                    pod_id,
                    "has_endpoint",
                    {"ports": _endpoint_ports(endpoint_slice), "endpointType": "pod"},
                )
                continue

            for address in _list(_mapping(endpoint).get("addresses")):
                if not isinstance(address, str) or not address:
                    continue
                external_id = f"{cluster_id}/external/{quote(namespace, safe='')}/{quote(address, safe='')}"
                graph_objects[external_id] = TopologyObject(
                    id=external_id,
                    kind="ExternalEndpoint",
                    name=address,
                    namespace=namespace,
                    # Topology sees an address, not a health probe. Do not
                    # imply that an external HAOS endpoint is reachable.
                    status=None,
                )
                add_relationship(
                    service_id,
                    external_id,
                    "has_endpoint",
                    {"ports": _endpoint_ports(endpoint_slice), "endpointType": "external"},
                )

    # EndpointSlice is the modern source of truth. Older clusters, and some
    # controllers, still publish core/v1 Endpoints, so use it only when the
    # Service had no EndpointSlice at all. This prevents duplicate edges.
    for endpoint in endpoints:
        resource_metadata = _mapping(endpoint.get("metadata"))
        namespace, name = _string(resource_metadata.get("namespace")), _string(resource_metadata.get("name"))
        if not namespace or not name or (namespace, name) in slice_service_keys:
            continue
        service_id = service_ids.get((namespace, name))
        if not service_id:
            continue
        for subset in _list(_mapping(endpoint).get("subsets")):
            subset_map = _mapping(subset)
            ports = _legacy_endpoint_ports(subset_map)
            for address_item in _list(subset_map.get("addresses")):
                address_map = _mapping(address_item)
                target_ref = _mapping(address_map.get("targetRef"))
                if _string(target_ref.get("kind")) == "Pod":
                    pod_id = pod_ids.get((namespace, _string(target_ref.get("name")) or ""))
                    if pod_id:
                        add_relationship(
                            service_id,
                            pod_id,
                            "has_endpoint",
                            {"ports": ports, "endpointType": "pod"},
                        )
                    continue
                address = _string(address_map.get("ip"))
                if not address:
                    continue
                external_id = f"{cluster_id}/external/{quote(namespace, safe='')}/{quote(address, safe='')}"
                graph_objects[external_id] = TopologyObject(
                    id=external_id,
                    kind="ExternalEndpoint",
                    name=address,
                    namespace=namespace,
                    status=None,
                )
                add_relationship(
                    service_id,
                    external_id,
                    "has_endpoint",
                    {"ports": ports, "endpointType": "external"},
                )

    return {
        "schemaVersion": 1,
        "cluster": {"id": cluster_id, "name": cluster_name},
        "objects": [asdict(graph_objects[key]) for key in sorted(graph_objects)],
        "relationships": [
            asdict(relationship)
            for relationship in sorted(
                relationships.values(),
                key=lambda item: (item.source, item.kind, item.target, str(item.properties)),
            )
        ],
    }


def _add_namespace_contains(
    namespace_ids: dict[str, str],
    namespace: str,
    target: str,
    relationships: dict[tuple[str, str, str, str], TopologyRelationship],
) -> None:
    namespace_id = namespace_ids.get(namespace)
    if namespace_id:
        relationship = TopologyRelationship(namespace_id, target, "contains")
        relationships[_relationship_key(relationship)] = relationship


def _relationship_key(relationship: TopologyRelationship) -> tuple[str, str, str, str]:
    return (
        relationship.source,
        relationship.target,
        relationship.kind,
        repr(relationship.properties),
    )


def _controller_owner(resource: Json) -> tuple[str, str] | None:
    owners = _list(_mapping(resource.get("metadata")).get("ownerReferences"))
    for owner in owners:
        owner_map = _mapping(owner)
        if owner_map.get("controller") is True:
            kind, name = _string(owner_map.get("kind")), _string(owner_map.get("name"))
            if kind and name:
                return kind, name
    return None


def _node_roles(node: Json) -> list[str]:
    labels = _mapping(_mapping(node.get("metadata")).get("labels"))
    return sorted(
        key.removeprefix("node-role.kubernetes.io/")
        for key in labels
        if key.startswith("node-role.kubernetes.io/")
    )


def _node_status(node: Json) -> str:
    conditions = _list(_mapping(node.get("status")).get("conditions"))
    ready = next((condition for condition in conditions if _mapping(condition).get("type") == "Ready"), None)
    return "online" if _mapping(ready).get("status") == "True" else "offline"


def _pod_status(pod: Json) -> str:
    phase = _string(_mapping(pod.get("status")).get("phase"))
    return "online" if phase == "Running" else "offline" if phase in {"Failed", "Unknown"} else "pending"


def _workload_properties(workload: Json) -> dict[str, Any]:
    spec = _mapping(workload.get("spec"))
    status = _mapping(workload.get("status"))
    return {
        "desiredReplicas": spec.get("replicas", 1),
        "readyReplicas": status.get("readyReplicas", 0),
    }


def _job_properties(job: Json) -> dict[str, Any]:
    status = _mapping(job.get("status"))
    return {
        "active": status.get("active", 0),
        "succeeded": status.get("succeeded", 0),
        "failed": status.get("failed", 0),
    }


def _cronjob_properties(cronjob: Json) -> dict[str, Any]:
    return {"schedule": _string(_mapping(cronjob.get("spec")).get("schedule"))}


def _service_properties(service: Json) -> dict[str, Any]:
    spec = _mapping(service.get("spec"))
    return {
        "type": _string(spec.get("type")) or "ClusterIP",
        "ports": _service_ports(spec),
    }


def _service_ports(spec: Json) -> list[dict[str, Any]]:
    ports: list[dict[str, Any]] = []
    for port in _list(spec.get("ports")):
        item = _mapping(port)
        ports.append(
            {
                "name": _string(item.get("name")),
                "port": item.get("port"),
                "targetPort": item.get("targetPort"),
                "protocol": _string(item.get("protocol")) or "TCP",
            }
        )
    return ports


def _endpoint_ports(endpoint_slice: Json) -> list[dict[str, Any]]:
    ports: list[dict[str, Any]] = []
    for port in _list(endpoint_slice.get("ports")):
        item = _mapping(port)
        ports.append(
            {
                "name": _string(item.get("name")),
                "port": item.get("port"),
                "protocol": _string(item.get("protocol")) or "TCP",
            }
        )
    return ports


def _legacy_endpoint_ports(subset: Json) -> list[dict[str, Any]]:
    ports: list[dict[str, Any]] = []
    for port in _list(subset.get("ports")):
        item = _mapping(port)
        ports.append(
            {
                "name": _string(item.get("name")),
                "port": item.get("port"),
                "protocol": _string(item.get("protocol")) or "TCP",
            }
        )
    return ports


def _ingress_properties(ingress: Json) -> dict[str, Any]:
    hosts = sorted(
        host
        for rule in _list(_mapping(ingress.get("spec")).get("rules"))
        if (host := _string(_mapping(rule).get("host")))
    )
    return {"hosts": hosts}


def _ingress_backends(ingress: Json) -> list[dict[str, Any]]:
    spec = _mapping(ingress.get("spec"))
    backends: list[dict[str, Any]] = []
    default_backend = _backend(_mapping(spec.get("defaultBackend")), host=None, path=None)
    if default_backend:
        backends.append(default_backend)
    for rule in _list(spec.get("rules")):
        rule_map = _mapping(rule)
        host = _string(rule_map.get("host"))
        http = _mapping(rule_map.get("http"))
        for path in _list(http.get("paths")):
            path_map = _mapping(path)
            backend = _backend(_mapping(path_map.get("backend")), host=host, path=_string(path_map.get("path")))
            if backend:
                backends.append(backend)
    return backends


def _backend(backend: Json, *, host: str | None, path: str | None) -> dict[str, Any] | None:
    service = _mapping(backend.get("service"))
    name = _string(service.get("name"))
    if not name:
        return None
    port = _mapping(service.get("port"))
    result: dict[str, Any] = {"service": name}
    if host:
        result["host"] = host
    if path:
        result["path"] = path
    if port.get("number") is not None:
        result["port"] = port["number"]
    elif _string(port.get("name")):
        result["port"] = _string(port.get("name"))
    return result


def _mapping(value: object) -> Json:
    return value if isinstance(value, Mapping) else {}


def _list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
