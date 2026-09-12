/**
 * The deliberately small, read-only contract served by `/kubernetes/topology`.
 *
 * These are observed Kubernetes resources, not editable Homelable canvas nodes.
 * Keep this contract free of labels, annotations, manifests, and credentials so
 * the same payload is safe to use in the visual view and the agent-facing MCP
 * resource.
 */
export type KubernetesSyncState =
  | 'disabled'
  | 'never_synced'
  | 'syncing'
  | 'fresh'
  | 'stale'
  | 'error'

export interface KubernetesCluster {
  id: string
  name: string
}

export interface KubernetesSync {
  state: KubernetesSyncState
  last_success_at?: string | null
  last_attempt_at?: string | null
  last_error?: string | null
  object_count?: number
  relationship_count?: number
}

export interface KubernetesTopologyObject {
  id: string
  kind: string
  name: string
  namespace?: string | null
  status?: string | null
  /** A bounded set of safe summary facts (for example ingress host/path/port). */
  properties?: Record<string, unknown> | null
}

export interface KubernetesTopologyRelationship {
  source: string
  target: string
  kind: 'contains' | 'owns' | 'scheduled_on' | 'routes_to' | 'has_endpoint' | string
  properties?: Record<string, unknown> | null
}

export interface KubernetesTopology {
  schemaVersion: number
  cluster: KubernetesCluster
  sync: KubernetesSync
  objects: KubernetesTopologyObject[]
  relationships: KubernetesTopologyRelationship[]
}

export interface KubernetesStatus extends KubernetesSync {
  enabled: boolean
  configured: boolean
}
