/**
 * The panel offers a way through to the Device Inventory row behind the node —
 * the place the same facts live for every other canvas showing this device.
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

describe('DetailPanel — inventory link', () => {
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
})
