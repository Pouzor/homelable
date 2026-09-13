import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/api/kubernetes', () => ({
  kubernetesApi: {
    status: vi.fn(),
    topology: vi.fn(),
  },
}))

import { kubernetesApi } from '@/api/kubernetes'
import { KubernetesTopologyView } from '../KubernetesTopologyView'

const status = {
  enabled: true,
  configured: true,
  state: 'fresh' as const,
  last_success_at: '2026-08-30T12:00:00Z',
  last_attempt_at: '2026-08-30T12:00:00Z',
  last_error: null,
  object_count: 7,
  relationship_count: 7,
}

const topology = {
  schemaVersion: 1,
  cluster: { id: 'kubernetes://homelab', name: 'homelab' },
  sync: status,
  objects: [
    { id: 'ingress', kind: 'Ingress', name: 'grafana', namespace: 'monitoring', status: null },
    { id: 'service', kind: 'Service', name: 'grafana', namespace: 'monitoring', status: null },
    { id: 'deployment', kind: 'Deployment', name: 'grafana', namespace: 'monitoring', status: 'available' },
    { id: 'pod', kind: 'Pod', name: 'grafana-7cdb8d', namespace: 'monitoring', status: 'running' },
    { id: 'node', kind: 'Node', name: 'k8s-node1', status: 'ready', properties: { roles: ['control-plane'], labels: { unsafe: true } } },
    { id: 'external-service', kind: 'Service', name: 'home-assistant', namespace: 'home-assistant', status: null },
    { id: 'external-endpoint', kind: 'ExternalEndpoint', name: '192.168.40.20', namespace: 'home-assistant', status: 'online' },
  ],
  relationships: [
    { source: 'ingress', target: 'service', kind: 'routes_to', properties: { host: 'grafana.trash.lan', path: '/', port: 3000 } },
    { source: 'service', target: 'pod', kind: 'has_endpoint', properties: { endpointType: 'pod' } },
    { source: 'deployment', target: 'pod', kind: 'owns' },
    { source: 'pod', target: 'node', kind: 'scheduled_on' },
    { source: 'external-service', target: 'external-endpoint', kind: 'has_endpoint', properties: { endpointType: 'external' } },
  ],
}

function mockReady(overrides: Partial<typeof topology> = {}) {
  vi.mocked(kubernetesApi.status).mockResolvedValue({ data: status } as never)
  vi.mocked(kubernetesApi.topology).mockResolvedValue({ data: { ...topology, ...overrides } } as never)
}

describe('KubernetesTopologyView', () => {
  beforeEach(() => {
    vi.mocked(kubernetesApi.status).mockReset()
    vi.mocked(kubernetesApi.topology).mockReset()
  })

  afterEach(() => cleanup())

  it('renders the collapsed ingress → service → workload path and route labels', async () => {
    mockReady()
    render(<KubernetesTopologyView />)

    await waitFor(() => expect(screen.getByText('Kubernetes topology')).toBeInTheDocument())
    expect(screen.getByTestId('kubernetes-sync-state')).toHaveTextContent('fresh')
    expect(screen.getByTestId('kubernetes-ingress-card')).toHaveTextContent('grafana')
    expect(screen.getByTestId('kubernetes-ingress-card')).toHaveTextContent('grafana.trash.lan/')
    expect(screen.getByTestId('kubernetes-ingress-card')).toHaveTextContent(':3000')
    expect(screen.getAllByTestId('kubernetes-service-card')[0]).toHaveTextContent('1 ready endpoint')
    expect(screen.getByTestId('kubernetes-workload-card')).toHaveTextContent('grafana')
    expect(screen.queryByText('Pod: grafana-7cdb8d')).not.toBeInTheDocument()
  })

  it('expands a workload to show its pods and scheduled nodes', async () => {
    const user = userEvent.setup()
    mockReady()
    render(<KubernetesTopologyView />)

    await screen.findByRole('button', { name: 'Show pods and nodes (1)' })
    await user.click(screen.getByRole('button', { name: 'Show pods and nodes (1)' }))

    expect(screen.getByText('Pod: grafana-7cdb8d')).toBeInTheDocument()
    expect(screen.getByText('Node: k8s-node1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide pods and nodes' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('filters by namespace, kind, and searchable resource text', async () => {
    const user = userEvent.setup()
    mockReady()
    render(<KubernetesTopologyView />)

    await screen.findByTestId('kubernetes-ingress-card')
    await user.selectOptions(screen.getByLabelText('Namespace'), 'home-assistant')
    expect(screen.queryByTestId('kubernetes-ingress-card')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('kubernetes-service-card')).toHaveLength(1)
    expect(screen.getAllByTestId('kubernetes-service-card')[0]).toHaveTextContent('home-assistant')

    await user.selectOptions(screen.getByLabelText('Kind'), 'ExternalEndpoint')
    expect(screen.getByText('Matching resources')).toBeInTheDocument()
    expect(screen.getByText('192.168.40.20')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search resources'))
    await user.type(screen.getByLabelText('Search resources'), 'does-not-exist')
    expect(screen.queryByText('192.168.40.20')).not.toBeInTheDocument()
  })

  it('shows stale state without hiding the last successful topology', async () => {
    const stale = { ...status, state: 'stale' as const }
    vi.mocked(kubernetesApi.status).mockResolvedValue({ data: stale } as never)
    vi.mocked(kubernetesApi.topology).mockResolvedValue({ data: { ...topology, sync: stale } } as never)
    render(<KubernetesTopologyView />)

    await screen.findByText(/Showing the last successful topology snapshot/)
    expect(screen.getAllByTestId('kubernetes-service-card')[0]).toHaveTextContent('grafana')
  })

  it('reports disabled sources without trying to fetch topology', async () => {
    vi.mocked(kubernetesApi.status).mockResolvedValue({ data: { ...status, enabled: false, configured: false, state: 'disabled' } } as never)
    render(<KubernetesTopologyView />)

    await screen.findByText('Kubernetes topology is disabled')
    expect(kubernetesApi.topology).not.toHaveBeenCalled()
  })

  it('shows a retryable error when status cannot be loaded', async () => {
    vi.mocked(kubernetesApi.status).mockRejectedValue(new Error('offline'))
    render(<KubernetesTopologyView />)

    await screen.findByText('Kubernetes topology unavailable')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('has no editable canvas controls and does not disclose arbitrary properties', async () => {
    const user = userEvent.setup()
    mockReady()
    render(<KubernetesTopologyView />)

    await screen.findByTestId('kubernetes-ingress-card')
    await user.click(screen.getByRole('button', { name: 'Show pods and nodes (1)' }))
    await user.click(screen.getByRole('button', { name: 'Node: k8s-node1' }))
    expect(screen.getByTestId('kubernetes-detail-panel')).not.toHaveTextContent('unsafe')
    expect(screen.queryByRole('button', { name: /save|edit|delete|add node|connect/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})
