import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useCanvasStore } from '@/stores/canvasStore'

// ── Mock heavy dependencies ────────────────────────────────────────────────

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
}))
vi.mock('@xyflow/react/dist/style.css', () => ({}))

vi.mock('@/api/client', () => ({
  liveviewApi: { load: vi.fn() },
}))

import { liveviewApi } from '@/api/client'
import LiveView from '../LiveView'

// ── Helpers ────────────────────────────────────────────────────────────────

function setSearch(params: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, search: params, pathname: '/view' },
  })
}

const canvasPayload = {
  data: {
    nodes: [{
      id: 'n1', type: 'server', label: 'CI Node', status: 'online',
      services: [], pos_x: 0, pos_y: 0,
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LiveView (non-standalone)', () => {
  beforeEach(() => {
    vi.mocked(liveviewApi.load).mockReset()
    useCanvasStore.setState({ nodes: [], edges: [] })
  })

  // ── No key ────────────────────────────────────────────────────────────────

  it('shows no-key error when ?key= is missing', async () => {
    setSearch('')
    render(<LiveView />)
    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeDefined()
      expect(screen.getByText(/Missing key/)).toBeDefined()
    })
    expect(liveviewApi.load).not.toHaveBeenCalled()
  })

  // ── Disabled ──────────────────────────────────────────────────────────────

  it('shows disabled error when backend returns "Live view is disabled"', async () => {
    setSearch('?key=anything')
    vi.mocked(liveviewApi.load).mockRejectedValue({
      response: { data: { detail: 'Live view is disabled' } },
    })
    render(<LiveView />)
    await waitFor(() => {
      expect(screen.getByText(/disabled on this instance/)).toBeDefined()
    })
  })

  // ── Invalid key ───────────────────────────────────────────────────────────

  it('shows invalid-key error when backend returns "Invalid live view key"', async () => {
    setSearch('?key=wrong')
    vi.mocked(liveviewApi.load).mockRejectedValue({
      response: { data: { detail: 'Invalid live view key' } },
    })
    render(<LiveView />)
    await waitFor(() => {
      expect(screen.getByText(/Invalid or expired/)).toBeDefined()
    })
  })

  it('shows invalid-key error for unexpected API errors', async () => {
    setSearch('?key=anything')
    vi.mocked(liveviewApi.load).mockRejectedValue(new Error('network'))
    render(<LiveView />)
    await waitFor(() => {
      expect(screen.getByText(/Invalid or expired/)).toBeDefined()
    })
  })

  // ── Valid key → canvas rendered ───────────────────────────────────────────

  it('renders the canvas on valid key', async () => {
    setSearch('?key=correct-key')
    vi.mocked(liveviewApi.load).mockResolvedValue(canvasPayload as never)
    render(<LiveView />)
    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined()
    })
    expect(liveviewApi.load).toHaveBeenCalledWith('correct-key')
  })

  it('loads nodes into the canvas store on success', async () => {
    setSearch('?key=secret')
    vi.mocked(liveviewApi.load).mockResolvedValue(canvasPayload as never)
    render(<LiveView />)
    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined()
    })
    const { nodes } = useCanvasStore.getState()
    expect(nodes.find((n) => n.id === 'n1')).toBeDefined()
  })

  // ── No editing props passed ───────────────────────────────────────────────

  it('does not show any Access Denied when key is valid', async () => {
    setSearch('?key=valid')
    vi.mocked(liveviewApi.load).mockResolvedValue(canvasPayload as never)
    render(<LiveView />)
    await waitFor(() => expect(screen.getByTestId('react-flow')).toBeDefined())
    expect(screen.queryByText('Access Denied')).toBeNull()
  })
})

// ── Standalone mode ────────────────────────────────────────────────────────

describe('LiveView (standalone — localStorage)', () => {
  beforeEach(() => {
    localStorage.clear()
    useCanvasStore.setState({ nodes: [], edges: [] })
    vi.mocked(liveviewApi.load).mockReset()
  })

  it('loads canvas from localStorage without calling the API', async () => {
    const stored = {
      nodes: [{
        id: 'ls-node', type: 'router',
        position: { x: 10, y: 20 },
        data: { label: 'Router', type: 'router', status: 'unknown', services: [] },
      }],
      edges: [],
    }
    localStorage.setItem('homelable_canvas', JSON.stringify(stored))

    // Stub VITE_STANDALONE before re-importing
    vi.stubEnv('VITE_STANDALONE', 'true')
    vi.resetModules()
    const { default: LiveViewStandalone } = await import('../LiveView')

    setSearch('')  // no key needed in standalone
    render(<LiveViewStandalone />)

    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined()
    })
    expect(liveviewApi.load).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('shows canvas (empty) when localStorage has no saved data', async () => {
    vi.stubEnv('VITE_STANDALONE', 'true')
    vi.resetModules()
    const { default: LiveViewStandalone } = await import('../LiveView')

    setSearch('')
    render(<LiveViewStandalone />)

    await waitFor(() => {
      expect(screen.getByTestId('react-flow')).toBeDefined()
    })
    expect(liveviewApi.load).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })
})
