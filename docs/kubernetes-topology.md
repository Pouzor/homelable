# Kubernetes topology

Homelable can observe one Kubernetes cluster and present a **read-only**
topology graph. This is deliberately separate from the editable canvas and
device inventory: Kubernetes resources are reconciled observations, not
objects Homelable creates or controls.

The canonical topology is available to the UI, REST API, and MCP as a
versioned JSON document:

- `GET /api/v1/kubernetes/status` reports whether Kubernetes observation is
  enabled and the freshness of the most recent sync.
- `GET /api/v1/kubernetes/topology` returns the last successful, sanitized
  topology snapshot.
- `homelable://kubernetes/topology` exposes that same snapshot as an MCP
  resource.

The topology route serves the last complete sync; it does not make a
Kubernetes API request for each viewer or MCP read. A failed sync keeps the
last known-good snapshot and marks it stale or errored instead of publishing a
partial graph.

## What is mapped

The graph associates Kubernetes resources using their stable UIDs:

```text
Cluster
  ├─ Namespace
  │   ├─ Ingress ─routes_to→ Service
  │   └─ Service ─has_endpoint→ Pod | External endpoint
  └─ Workload ─owns→ Pod ─scheduled_on→ Node
```

Deployments, StatefulSets, DaemonSets, Jobs, and CronJobs are workloads.
ReplicaSets are used to resolve Deployment ownership. The collector also reads
EndpointSlices (and legacy Endpoints as a compatibility fallback), so a
selectorless Service can accurately point to an external address rather than a
Pod. A missing endpoint is represented as such; it is not treated as proof
that the Service is healthy or unhealthy.

Pods are collapsed in the visual view by default. Expand them when debugging a
specific workload or node placement.

## Enable the collector

Kubernetes observation is disabled by default. Add these settings to the
backend environment and restart the backend:

```env
KUBERNETES_ENABLED=true
KUBERNETES_SOURCE=auto
KUBERNETES_CLUSTER_NAME=production
KUBERNETES_SYNC_INTERVAL=300
```

`KUBERNETES_SOURCE` accepts:

| Value | Behaviour |
|---|---|
| `auto` | Use in-cluster credentials when available; otherwise use the configured kubeconfig path. |
| `in_cluster` | Require projected ServiceAccount credentials. This is the recommended production setting. |
| `kubeconfig` | Use a locally mounted kubeconfig file. This is an advanced option for external installs. |

`KUBERNETES_SYNC_INTERVAL` is in seconds. Use a conservative value: topology
is inventory data, not a real-time health monitor.

### In-cluster deployment (recommended)

Run Homelable's backend with the ServiceAccount below and set
`KUBERNETES_SOURCE=in_cluster`. Kubernetes supplies a short-lived projected
token to the Pod; no Kubernetes credential is placed in Homelable's database,
environment, or UI.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: homelable-topology
  namespace: homelable
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: homelable-topology-reader
rules:
  - apiGroups: [""]
    resources: ["namespaces", "nodes", "pods", "services", "endpoints"]
    verbs: ["list"]
  - apiGroups: ["discovery.k8s.io"]
    resources: ["endpointslices"]
    verbs: ["list"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
    verbs: ["list"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["list"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: homelable-topology-reader
subjects:
  - kind: ServiceAccount
    name: homelable-topology
    namespace: homelable
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: homelable-topology-reader
```

Reference the ServiceAccount from the backend Deployment:

```yaml
spec:
  template:
    spec:
      serviceAccountName: homelable-topology
```

Keep the namespace in the examples consistent with the namespace where the
backend is deployed. Before rollout, verify the exact grant from the backend
ServiceAccount:

```bash
kubectl auth can-i --as=system:serviceaccount:homelable:homelable-topology list pods --all-namespaces
kubectl auth can-i --as=system:serviceaccount:homelable:homelable-topology get secrets --all-namespaces
```

The first command should return `yes`; the second must return `no`.

### External installation with kubeconfig (advanced)

For Docker or bare-metal installs outside Kubernetes, create a kubeconfig for
an identity bound to the same reader ClusterRole. Mount it read-only and store
only its path in the environment:

```yaml
services:
  backend:
    volumes:
      - ./homelable-topology.kubeconfig:/run/secrets/homelable-topology.kubeconfig:ro
    environment:
      KUBERNETES_ENABLED: "true"
      KUBERNETES_SOURCE: kubeconfig
      KUBERNETES_KUBECONFIG_PATH: /run/secrets/homelable-topology.kubeconfig
      KUBERNETES_KUBECONFIG_CONTEXT: homelable-topology
```

Do not paste kubeconfig contents into the web UI, add a token to `.env`, or
commit the kubeconfig. The path is configuration only; the kubeconfig itself
is a credential and must remain outside the repository with restrictive file
permissions.

## Security and data boundaries

The collector requires only `list`. It does **not** request `get`,
`watch`, create, update, patch, delete, exec, attach, port-forward, log, or
impersonation permissions. It must not be granted access to Secrets,
ConfigMaps, Events, `pods/log`, or `pods/exec`.

The published topology intentionally excludes:

- Secret and ConfigMap contents;
- labels and annotations;
- container environment, arguments, image pull credentials, and volumes;
- kubeconfig material, bearer tokens, and API-server credentials;
- logs and events.

Only the minimal identity, kind, namespace/name, safe summary state, and
topology relationships required to draw and query the graph are retained.
Treat hostnames, IP addresses, and exposed route paths as infrastructure
metadata: protect the REST API and MCP service accordingly.

`homelable://kubernetes/topology` is a read-only MCP **resource**; it does not
add a Kubernetes write tool. For an agent that must not receive any canvas or
scan tool, run a separate MCP listener with a different `MCP_API_KEY` and:

```env
MCP_READ_ONLY=true
```

That listener registers resources but no tools, including no tool-call handler.
Do not share its API key with a full-access MCP listener. Process-level
read-only mode intentionally does not provide per-key resource filtering: the
agent can still read the other resources served by that listener. Put strict
topology-only access behind a separate deployment or authorization layer that
filters resources.

For Docker Compose installs, keep the additional API key in an untracked file
such as `mcp-read-only.env`, then add a separate listener in a Compose override:

```env
# mcp-read-only.env — do not commit this file
MCP_API_KEY=mcp_sk_different_read_only_key
```

```yaml
# compose.read-only-mcp.yml
services:
  mcp-read-only:
    image: ghcr.io/pouzor/homelable-mcp:latest
    # Use `build: { context: ./mcp, dockerfile: Dockerfile.mcp }` for a source build.
    restart: unless-stopped
    env_file:
      - .env
      - ./mcp-read-only.env
    environment:
      BACKEND_URL: http://backend:8000
      MCP_READ_ONLY: "true"
    ports:
      - "127.0.0.1:8002:8001"
    depends_on:
      - backend
    networks:
      - homelable
```

Start it alongside the normal Compose file with:

```bash
docker compose -f docker-compose.yml -f compose.read-only-mcp.yml up -d mcp-read-only
```

The read-only listener can share `MCP_SERVICE_KEY` with the normal listener:
that key authenticates the MCP service to the backend. Only `MCP_API_KEY` is
client-facing and must be distinct.

## Sync state

Every topology response includes a sync state:

| State | Meaning |
|---|---|
| `disabled` | Kubernetes observation is disabled by configuration. The topology is empty. |
| `never_synced` | Observation is enabled but no complete snapshot exists yet. Check whether a credential source is configured. |
| `fresh` | The most recent scheduled or manual sync completed successfully. |
| `stale` | The last good snapshot is still available, but a later sync did not complete or the successful snapshot is overdue. |
| `error` | No complete topology snapshot is available; inspect the status endpoint and backend logs. |

Topology represents Kubernetes' declared and discovered routing relationships.
It is not a network-policy analyzer, a request trace, or a health guarantee.
