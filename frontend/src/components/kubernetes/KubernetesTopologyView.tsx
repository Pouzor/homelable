import { useCallback, useEffect, useMemo, useState } from 'react'
import { kubernetesApi } from '@/api/kubernetes'
import type {
  KubernetesStatus,
  KubernetesSync,
  KubernetesSyncState,
  KubernetesTopology,
  KubernetesTopologyObject,
  KubernetesTopologyRelationship,
} from '@/types/kubernetes'

const PRIMARY_KINDS = new Set(['Ingress', 'Service', 'Deployment', 'StatefulSet', 'DaemonSet'])
const WORKLOAD_KINDS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'])
const SAFE_PROPERTY_KEYS = new Set(['host', 'path', 'port', 'ports', 'endpointType', 'type', 'clusterIP', 'externalName'])

type LoadState = 'loading' | 'ready' | 'disabled' | 'error'

function syncTone(state: KubernetesSyncState | undefined): string {
  switch (state) {
    case 'fresh': return 'border-[#39d353]/40 bg-[#39d353]/10 text-[#7ee787]'
    case 'stale': return 'border-[#e3b341]/40 bg-[#e3b341]/10 text-[#e3b341]'
    case 'error': return 'border-[#f85149]/40 bg-[#f85149]/10 text-[#ffa198]'
    case 'syncing': return 'border-[#00d4ff]/40 bg-[#00d4ff]/10 text-[#00d4ff]'
    default: return 'border-border bg-[#21262d] text-muted-foreground'
  }
}

function syncLabel(state: KubernetesSyncState | undefined): string {
  return (state ?? 'never_synced').replace('_', ' ')
}

function formatTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function isVisibleObject(
  object: KubernetesTopologyObject,
  namespace: string,
  kind: string,
  search: string,
): boolean {
  if (namespace !== 'all' && object.namespace !== namespace) return false
  if (kind !== 'all' && object.kind !== kind) return false
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [object.name, object.namespace, object.kind, object.status]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle))
}

function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(', ')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

function relationshipProperty(relationship: KubernetesTopologyRelationship, key: string): string {
  return propertyText(relationship.properties?.[key])
}

function routeLabel(relationship: KubernetesTopologyRelationship): string {
  const host = relationshipProperty(relationship, 'host')
  const path = relationshipProperty(relationship, 'path') || '/'
  const port = relationshipProperty(relationship, 'port')
  return [host && `${host}${path}`, port && `:${port}`].filter(Boolean).join(' ') || 'default backend'
}

function relationTargets(
  relationships: KubernetesTopologyRelationship[],
  source: string,
  kind: string,
): string[] {
  return relationships
    .filter((relationship) => relationship.source === source && relationship.kind === kind)
    .map((relationship) => relationship.target)
}

interface ResourceCardProps {
  object: KubernetesTopologyObject
  selected: boolean
  onSelect: (object: KubernetesTopologyObject) => void
  children?: React.ReactNode
  testId?: string
}

function ResourceCard({ object, selected, onSelect, children, testId }: ResourceCardProps) {
  return (
    <article
      data-testid={testId}
      className={`rounded-lg border p-3 shadow-sm transition-colors ${selected ? 'border-[#00d4ff] bg-[#00d4ff]/10' : 'border-border bg-[#161b22]'}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(object)}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00d4ff] rounded"
      >
        <span className="block text-[11px] font-medium uppercase tracking-wide text-[#00d4ff]">{object.kind}</span>
        <span className="mt-1 block break-words text-sm font-medium text-foreground">{object.name}</span>
        {object.namespace && <span className="mt-0.5 block text-xs text-muted-foreground">{object.namespace}</span>}
        {object.status && <span className="mt-1 block text-xs text-muted-foreground">{object.status}</span>}
      </button>
      {children}
    </article>
  )
}

function EmptyColumn({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">{children}</p>
}

export function KubernetesTopologyView() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [status, setStatus] = useState<KubernetesStatus | null>(null)
  const [topology, setTopology] = useState<KubernetesTopology | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [namespace, setNamespace] = useState('all')
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<KubernetesTopologyObject | null>(null)
  const [expandedWorkloads, setExpandedWorkloads] = useState<Set<string>>(() => new Set())

  const load = useCallback(async () => {
    setLoadState('loading')
    setError(null)
    try {
      const statusResponse = await kubernetesApi.status()
      setStatus(statusResponse.data)
      if (!statusResponse.data.enabled) {
        setTopology(null)
        setLoadState('disabled')
        return
      }
      const topologyResponse = await kubernetesApi.topology()
      setTopology(topologyResponse.data)
      setLoadState('ready')
    } catch {
      setLoadState('error')
      setError('Could not load the Kubernetes topology. The saved canvas is unaffected.')
    }
  }, [])

  useEffect(() => {
    // Queue the initial request after mount. `load` also backs the explicit
    // Refresh control; queuing avoids a synchronous state update during the
    // effect itself while preserving a single loading implementation.
    const request = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(request)
  }, [load])

  const effectiveSync: KubernetesSync | null = topology?.sync ?? status
  const objectsById = useMemo(
    () => new Map(topology?.objects.map((object) => [object.id, object]) ?? []),
    [topology],
  )
  const namespaces = useMemo(
    () => Array.from(new Set((topology?.objects ?? []).map((object) => object.namespace).filter((value): value is string => Boolean(value)))).sort(),
    [topology],
  )
  const kinds = useMemo(
    () => Array.from(new Set((topology?.objects ?? []).map((object) => object.kind))).sort(),
    [topology],
  )
  const visibleObjects = useMemo(
    () => (topology?.objects ?? []).filter((object) => isVisibleObject(object, namespace, kind, search)),
    [topology, namespace, kind, search],
  )
  const visibleIds = useMemo(() => new Set(visibleObjects.map((object) => object.id)), [visibleObjects])
  const relationships = topology?.relationships ?? []
  const ingresses = visibleObjects.filter((object) => object.kind === 'Ingress')
  const services = visibleObjects.filter((object) => object.kind === 'Service')
  const workloads = visibleObjects.filter((object) => WORKLOAD_KINDS.has(object.kind))
  const nonPrimaryMatches = visibleObjects.filter((object) => !PRIMARY_KINDS.has(object.kind) && !['Cluster', 'Namespace'].includes(object.kind))

  const toggleWorkload = useCallback((id: string) => {
    setExpandedWorkloads((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (loadState === 'loading') {
    return <main className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground" aria-live="polite">Loading Kubernetes topology…</main>
  }

  if (loadState === 'disabled') {
    return (
      <main className="flex h-full flex-1 items-center justify-center p-6">
        <section className="max-w-lg rounded-lg border border-border bg-[#161b22] p-6 text-center" aria-labelledby="kubernetes-disabled-title">
          <h1 id="kubernetes-disabled-title" className="text-lg font-semibold">Kubernetes topology is disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">Enable and configure the read-only Kubernetes source to see observed workload routing here.</p>
        </section>
      </main>
    )
  }

  if (loadState === 'error') {
    return (
      <main className="flex h-full flex-1 items-center justify-center p-6">
        <section className="max-w-lg rounded-lg border border-[#f85149]/40 bg-[#3d1418] p-6 text-center" role="alert">
          <h1 className="text-lg font-semibold text-[#ffa198]">Kubernetes topology unavailable</h1>
          <p className="mt-2 text-sm text-[#ffa198]">{error}</p>
          <button type="button" onClick={() => void load()} className="mt-4 rounded border border-[#f85149] px-3 py-1.5 text-sm text-[#ffa198] hover:bg-[#f85149]/20">Retry</button>
        </section>
      </main>
    )
  }

  const serviceEndpoints = (service: KubernetesTopologyObject) => relationTargets(relationships, service.id, 'has_endpoint')
  const workloadPods = (workload: KubernetesTopologyObject) => relationTargets(relationships, workload.id, 'owns')
  const serviceWorkloads = (service: KubernetesTopologyObject) => Array.from(new Set(
    serviceEndpoints(service).flatMap((endpointId) => relationships
      .filter((relationship) => relationship.target === endpointId && relationship.kind === 'owns')
      .map((relationship) => relationship.source))
      .map((id) => objectsById.get(id))
      .filter((object): object is KubernetesTopologyObject => Boolean(object)),
  ))

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col bg-[#0d1117]" aria-labelledby="kubernetes-topology-title">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 id="kubernetes-topology-title" className="text-base font-semibold">Kubernetes topology</h1>
            <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${syncTone(effectiveSync?.state)}`} data-testid="kubernetes-sync-state">
              {syncLabel(effectiveSync?.state)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {topology?.cluster.name ?? 'Cluster'} · observed read-only state
            {formatTime(effectiveSync?.last_success_at) && ` · last synchronized ${formatTime(effectiveSync?.last_success_at)}`}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded border border-border bg-[#21262d] px-3 py-1.5 text-sm hover:border-[#00d4ff]">Refresh</button>
      </header>

      {effectiveSync?.state === 'stale' && (
        <p className="border-b border-[#e3b341]/40 bg-[#e3b341]/10 px-4 py-2 text-sm text-[#e3b341]" role="status">Showing the last successful topology snapshot; it may be out of date.</p>
      )}
      {effectiveSync?.state === 'error' && (
        <p className="border-b border-[#f85149]/40 bg-[#3d1418] px-4 py-2 text-sm text-[#ffa198]" role="alert">{effectiveSync.last_error || 'The latest Kubernetes synchronization failed. Showing the last known snapshot when available.'}</p>
      )}

      <section className="flex flex-wrap items-end gap-3 border-b border-border bg-[#161b22] px-4 py-3" aria-label="Topology filters">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search resources
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, namespace, kind" className="rounded border border-border bg-[#0d1117] px-2 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Namespace
          <select value={namespace} onChange={(event) => setNamespace(event.target.value)} className="rounded border border-border bg-[#0d1117] px-2 py-1.5 text-sm text-foreground">
            <option value="all">All namespaces</option>
            {namespaces.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value)} className="rounded border border-border bg-[#0d1117] px-2 py-1.5 text-sm text-foreground">
            <option value="all">All kinds</option>
            {kinds.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(16rem,0.8fr)]">
        <TopologyColumn title="Ingresses" count={ingresses.length}>
          {ingresses.length === 0 ? <EmptyColumn>No matching Ingresses.</EmptyColumn> : ingresses.map((ingress) => {
            const routes = relationships.filter((relationship) => relationship.source === ingress.id && relationship.kind === 'routes_to')
            return (
              <ResourceCard key={ingress.id} object={ingress} selected={selected?.id === ingress.id} onSelect={setSelected} testId="kubernetes-ingress-card">
                {routes.length > 0 && <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground" aria-label={`${ingress.name} routes`}>
                  {routes.map((route) => <li key={`${route.target}-${routeLabel(route)}`}><span className="text-[#00d4ff]">→</span> {objectsById.get(route.target)?.name ?? 'Unknown service'} <span className="text-[#8b949e]">{routeLabel(route)}</span></li>)}
                </ul>}
              </ResourceCard>
            )
          })}
        </TopologyColumn>

        <TopologyColumn title="Services" count={services.length}>
          {services.length === 0 ? <EmptyColumn>No matching Services.</EmptyColumn> : services.map((service) => {
            const endpoints = serviceEndpoints(service).filter((id) => visibleIds.has(id) || kind === 'all')
            const targetWorkloads = serviceWorkloads(service)
            const externalEndpoints = endpoints.map((id) => objectsById.get(id)).filter((object): object is KubernetesTopologyObject => object?.kind === 'ExternalEndpoint')
            return (
              <ResourceCard key={service.id} object={service} selected={selected?.id === service.id} onSelect={setSelected} testId="kubernetes-service-card">
                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{endpoints.length} ready endpoint{endpoints.length === 1 ? '' : 's'}</p>
                {targetWorkloads.length > 0 && <p className="mt-1 text-xs text-muted-foreground"><span className="text-[#00d4ff]">→</span> {targetWorkloads.map((workload) => workload.name).join(', ')}</p>}
                {externalEndpoints.length > 0 && <p className="mt-1 text-xs text-muted-foreground">External: {externalEndpoints.map((endpoint) => endpoint.name).join(', ')}</p>}
              </ResourceCard>
            )
          })}
        </TopologyColumn>

        <TopologyColumn title="Workloads" count={workloads.length}>
          {workloads.length === 0 ? <EmptyColumn>No matching workloads.</EmptyColumn> : workloads.map((workload) => {
            const podIds = workloadPods(workload)
            const isExpanded = expandedWorkloads.has(workload.id)
            return (
              <ResourceCard key={workload.id} object={workload} selected={selected?.id === workload.id} onSelect={setSelected} testId="kubernetes-workload-card">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleWorkload(workload.id)}
                  className="mt-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-[#00d4ff] hover:text-foreground"
                >
                  {isExpanded ? 'Hide pods and nodes' : `Show pods and nodes (${podIds.length})`}
                </button>
                {isExpanded && <ul className="mt-2 space-y-2 border-t border-border pt-2" aria-label={`${workload.name} pods and nodes`}>
                  {podIds.length === 0 ? <li className="text-xs text-muted-foreground">No observed Pods.</li> : podIds.map((podId) => {
                    const pod = objectsById.get(podId)
                    if (!pod) return null
                    const node = relationTargets(relationships, pod.id, 'scheduled_on').map((id) => objectsById.get(id)).find(Boolean)
                    return <li key={pod.id} className="rounded border border-border bg-[#0d1117] p-2 text-xs">
                      <button type="button" onClick={() => setSelected(pod)} className="block text-left text-foreground hover:text-[#00d4ff]">Pod: {pod.name}</button>
                      {node && <button type="button" onClick={() => setSelected(node)} className="mt-1 block text-left text-muted-foreground hover:text-[#00d4ff]">Node: {node.name}</button>}
                    </li>
                  })}
                </ul>}
              </ResourceCard>
            )
          })}
        </TopologyColumn>

        <aside className="min-w-0" aria-label="Resource details">
          <h2 className="mb-2 text-sm font-semibold">Details</h2>
          {selected ? <ResourceDetails object={selected} /> : <EmptyColumn>Select a resource to inspect its safe topology details.</EmptyColumn>}
          {kind !== 'all' && !PRIMARY_KINDS.has(kind) && nonPrimaryMatches.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-2 text-sm font-semibold">Matching resources</h2>
              <div className="space-y-2">{nonPrimaryMatches.map((object) => <ResourceCard key={object.id} object={object} selected={selected?.id === object.id} onSelect={setSelected} />)}</div>
            </section>
          )}
        </aside>
      </div>
    </main>
  )
}

function TopologyColumn({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="min-w-0"><h2 className="mb-2 text-sm font-semibold">{title} <span className="font-mono text-xs font-normal text-muted-foreground">{count}</span></h2><div className="space-y-3">{children}</div></section>
}

function ResourceDetails({ object }: { object: KubernetesTopologyObject }) {
  const safeProperties = Object.entries(object.properties ?? {}).filter(([key]) => SAFE_PROPERTY_KEYS.has(key)).map(([key, value]) => [key, propertyText(value)] as const).filter(([, value]) => Boolean(value))
  return (
    <section className="rounded-lg border border-border bg-[#161b22] p-3 text-sm" data-testid="kubernetes-detail-panel">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#00d4ff]">{object.kind}</p>
      <h3 className="mt-1 break-words font-medium">{object.name}</h3>
      <dl className="mt-3 space-y-2 text-xs">
        {object.namespace && <DetailRow label="Namespace" value={object.namespace} />}
        {object.status && <DetailRow label="Status" value={object.status} />}
        {safeProperties.map(([key, value]) => <DetailRow key={key} label={key} value={value} />)}
      </dl>
      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Observed read-only topology. Kubernetes manifests, labels, annotations, and credentials are not shown.</p>
    </section>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-mono text-foreground">{value}</dd></div>
}
