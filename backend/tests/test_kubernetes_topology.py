from app.services.kubernetes_topology import build_topology


def resource(kind: str, name: str, uid: str, namespace: str | None = None, *, metadata=None, **extra):
    resource_metadata = {"name": name, "uid": uid}
    if namespace:
        resource_metadata["namespace"] = namespace
    if metadata:
        resource_metadata.update(metadata)
    return {"kind": kind, "metadata": resource_metadata, **extra}


def object_id(graph, kind, name):
    return next(item["id"] for item in graph["objects"] if item["kind"] == kind and item["name"] == name)


def test_build_topology_connects_ingress_to_ready_pod_through_service():
    graph = build_topology(
        cluster_name="lab",
        namespaces=[resource("Namespace", "monitoring", "ns-1")],
        nodes=[resource("Node", "node1", "node-1", status={"conditions": [{"type": "Ready", "status": "True"}]})],
        workloads=[resource("Deployment", "grafana", "deploy-1", "monitoring", spec={"replicas": 1}, status={"readyReplicas": 1})],
        replicasets=[resource("ReplicaSet", "grafana-abc", "rs-1", "monitoring", metadata={"name": "grafana-abc", "uid": "rs-1", "namespace": "monitoring", "ownerReferences": [{"controller": True, "kind": "Deployment", "name": "grafana"}]})],
        pods=[resource("Pod", "grafana-abc-123", "pod-1", "monitoring", spec={"nodeName": "node1"}, status={"phase": "Running"}, metadata={"name": "grafana-abc-123", "uid": "pod-1", "namespace": "monitoring", "ownerReferences": [{"controller": True, "kind": "ReplicaSet", "name": "grafana-abc"}]})],
        services=[resource("Service", "grafana", "svc-1", "monitoring", spec={"type": "ClusterIP", "ports": [{"name": "http", "port": 3000, "targetPort": 3000}]})],
        ingresses=[resource("Ingress", "grafana", "ing-1", "monitoring", spec={"rules": [{"host": "grafana.example", "http": {"paths": [{"path": "/", "backend": {"service": {"name": "grafana", "port": {"number": 3000}}}}]}}]})],
        endpoint_slices=[resource("EndpointSlice", "grafana-123", "slice-1", "monitoring", metadata={"name": "grafana-123", "uid": "slice-1", "namespace": "monitoring", "labels": {"kubernetes.io/service-name": "grafana"}}, ports=[{"name": "http", "port": 3000}], endpoints=[{"conditions": {"ready": True}, "targetRef": {"kind": "Pod", "name": "grafana-abc-123"}}])],
    )

    ingress_id = object_id(graph, "Ingress", "grafana")
    service_id = object_id(graph, "Service", "grafana")
    deployment_id = object_id(graph, "Deployment", "grafana")
    pod_id = object_id(graph, "Pod", "grafana-abc-123")
    node_id = object_id(graph, "Node", "node1")
    relationships = {(item["source"], item["target"], item["kind"]) for item in graph["relationships"]}

    assert (ingress_id, service_id, "routes_to") in relationships
    assert any(item["kind"] == "routes_to" and item["properties"] == {"host": "grafana.example", "path": "/", "port": 3000} for item in graph["relationships"])
    assert (deployment_id, pod_id, "owns") in relationships
    assert (pod_id, node_id, "scheduled_on") in relationships
    assert any(item["kind"] == "has_endpoint" and item["target"] == pod_id for item in graph["relationships"])


def test_build_topology_excludes_not_ready_endpoints():
    graph = build_topology(
        cluster_name="lab",
        namespaces=[resource("Namespace", "app", "ns-1")],
        pods=[resource("Pod", "starting", "pod-1", "app", status={"phase": "Pending"})],
        services=[resource("Service", "app", "svc-1", "app", spec={"ports": [{"port": 80}]})],
        endpoint_slices=[resource("EndpointSlice", "app-1", "slice-1", "app", metadata={"name": "app-1", "uid": "slice-1", "namespace": "app", "labels": {"kubernetes.io/service-name": "app"}}, endpoints=[{"conditions": {"ready": False}, "targetRef": {"kind": "Pod", "name": "starting"}}])],
    )

    assert not [item for item in graph["relationships"] if item["kind"] == "has_endpoint"]


def test_build_topology_keeps_selectorless_service_endpoint_address():
    graph = build_topology(
        cluster_name="lab",
        namespaces=[resource("Namespace", "home", "ns-1")],
        services=[resource("Service", "home-assistant", "svc-1", "home", spec={"ports": [{"port": 8123}]})],
        endpoint_slices=[resource("EndpointSlice", "ha-1", "slice-1", "home", metadata={"name": "ha-1", "uid": "slice-1", "namespace": "home", "labels": {"kubernetes.io/service-name": "home-assistant"}}, ports=[{"port": 8123}], endpoints=[{"conditions": {"ready": True}, "addresses": ["192.168.40.20"]}])],
    )

    external_id = object_id(graph, "ExternalEndpoint", "192.168.40.20")
    external = next(item for item in graph["objects"] if item["id"] == external_id)
    assert external["status"] is None
    assert any(
        item["target"] == external_id
        and item["kind"] == "has_endpoint"
        and item["properties"]["endpointType"] == "external"
        for item in graph["relationships"]
    )


def test_build_topology_connects_cronjob_to_job_to_pod():
    graph = build_topology(
        cluster_name="lab",
        namespaces=[resource("Namespace", "maintenance", "namespace-1")],
        cronjobs=[resource("CronJob", "nightly", "cronjob-1", "maintenance", spec={"schedule": "0 0 * * *"})],
        jobs=[resource("Job", "nightly-1", "job-1", "maintenance", metadata={"name": "nightly-1", "uid": "job-1", "namespace": "maintenance", "ownerReferences": [{"controller": True, "kind": "CronJob", "name": "nightly"}]})],
        pods=[resource("Pod", "nightly-1-pod", "pod-1", "maintenance", metadata={"name": "nightly-1-pod", "uid": "pod-1", "namespace": "maintenance", "ownerReferences": [{"controller": True, "kind": "Job", "name": "nightly-1"}]})],
    )

    cronjob_id = object_id(graph, "CronJob", "nightly")
    job_id = object_id(graph, "Job", "nightly-1")
    pod_id = object_id(graph, "Pod", "nightly-1-pod")
    relationships = {(item["source"], item["target"], item["kind"]) for item in graph["relationships"]}

    assert (cronjob_id, job_id, "owns") in relationships
    assert (job_id, pod_id, "owns") in relationships


def test_build_topology_uses_legacy_endpoints_only_when_no_endpoint_slice_exists():
    graph = build_topology(
        cluster_name="lab",
        namespaces=[resource("Namespace", "home", "namespace-1")],
        services=[resource("Service", "home-assistant", "service-1", "home", spec={"ports": [{"port": 8123}]})],
        endpoints=[resource("Endpoints", "home-assistant", "endpoints-1", "home", subsets=[{"addresses": [{"ip": "192.168.40.20"}], "ports": [{"port": 8123}]}])],
    )

    external_id = object_id(graph, "ExternalEndpoint", "192.168.40.20")
    assert any(item["kind"] == "has_endpoint" and item["target"] == external_id for item in graph["relationships"])

    with_slice = build_topology(
        cluster_name="lab",
        namespaces=[resource("Namespace", "home", "namespace-1")],
        services=[resource("Service", "home-assistant", "service-1", "home", spec={"ports": [{"port": 8123}]})],
        endpoint_slices=[resource("EndpointSlice", "ha-1", "slice-1", "home", metadata={"name": "ha-1", "uid": "slice-1", "namespace": "home", "labels": {"kubernetes.io/service-name": "home-assistant"}}, endpoints=[{"addresses": ["192.168.40.20"]}])],
        endpoints=[resource("Endpoints", "home-assistant", "endpoints-1", "home", subsets=[{"addresses": [{"ip": "192.168.40.21"}]}])],
    )
    external_addresses = {item["name"] for item in with_slice["objects"] if item["kind"] == "ExternalEndpoint"}
    assert external_addresses == {"192.168.40.20"}
