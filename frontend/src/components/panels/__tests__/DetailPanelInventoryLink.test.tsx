/**
 * The panel offers a way through to the two places the device also lives: its
 * Device Inventory row — the same facts, for every other canvas showing it —
 * and its document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DetailPanel } from '../DetailPanel'
import * as canvasStore from '@/stores/canvasStore'
import type { NodeData } from '@/types'
import type { Node } from '@xyflow/react'

vi.mock('@/stores/canvasStore', async (importActual) => ({
  ...(await importActual<typeof canvasStore>()),
  useCanvasStore: vi.fn(),
}))

function makeNode(data: Partial<NodeData>): Node<NodeData> {
  return {
    id: 'n1',
    type: 'server',
    position: { x: 0, y: 0 },
    data: { label: 'NAS', type: 'server', status: 'online', services: [], ...data },
  }
}

function setupStore(nodeData: Partial<NodeData> = {}) {
  const state = {
    nodes: [makeNode(nodeData)],
    selectedNodeId: 'n1',
    selectedNodeIds: [],
    setSelectedNode: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    snapshotHistory: vi.fn(),
    createGroup: vi.fn(),
    ungroup: vi.fn(),
    removeFromGroup: vi.fn(),
    setNodeSize: vi.fn(),
    serviceStatuses: {},
  }
  vi.mocked(canvasStore.useCanvasStore).mockImplementation(
    ((sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state)) as unknown as typeof canvasStore.useCanvasStore,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('DetailPanel — links out to the device', () => {
  it('opens the inventory on the linked device', () => {
    setupStore({ device_id: 'dev-1' })
    const onOpenInventory = vi.fn()
    render(<DetailPanel onEdit={vi.fn()} onOpenInventory={onOpenInventory} />)

    fireEvent.click(screen.getByRole('button', { name: /Open in inventory/i }))
    expect(onOpenInventory).toHaveBeenCalledWith('dev-1')
  })

  it('offers nothing for a node with no row yet', () => {
    setupStore({})
    render(<DetailPanel onEdit={vi.fn()} onOpenInventory={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Open in inventory/i })).toBeNull()
  })

  it('offers nothing where there is no inventory to open (standalone)', () => {
    setupStore({ device_id: 'dev-1' })
    render(<DetailPanel onEdit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Open in inventory/i })).toBeNull()
  })

  it('opens the documentation on the linked device, naming it after the node', () => {
    setupStore({ device_id: 'dev-1', label: 'bazarr' })
    const onOpenDocumentation = vi.fn()
    render(<DetailPanel onEdit={vi.fn()} onOpenDocumentation={onOpenDocumentation} />)

    fireEvent.click(screen.getByRole('button', { name: /Open in documentation/i }))
    expect(onOpenDocumentation).toHaveBeenCalledWith('dev-1', 'bazarr')
  })

  it('offers the documentation link for a device row, and nothing without one', () => {
    setupStore({})
    render(<DetailPanel onEdit={vi.fn()} onOpenDocumentation={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Open in documentation/i })).toBeNull()
  })

  it('offers nothing where there is no backend to document against (standalone)', () => {
    setupStore({ device_id: 'dev-1' })
    render(<DetailPanel onEdit={vi.fn()} onOpenInventory={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Open in documentation/i })).toBeNull()
  })

  it('shows both ways out side by side', () => {
    setupStore({ device_id: 'dev-1' })
    render(<DetailPanel onEdit={vi.fn()} onOpenInventory={vi.fn()} onOpenDocumentation={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Open in inventory/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open in documentation/i })).toBeInTheDocument()
  })
})
