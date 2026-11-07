/**
 * Drill-down: a node that opens another design draws a button for it.
 *
 * The button only shows when the design is known to the editor — the live view
 * loads no design list, so it has nothing to open and draws nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { Server } from 'lucide-react'
import { BaseNode } from '../BaseNode'
import { useDesignStore } from '@/stores/designStore'
import type { Design, NodeData } from '@/types'

vi.mock('@/stores/canvasStore', async () => {
  const actual = await vi.importActual<typeof import('@/stores/canvasStore')>('@/stores/canvasStore')
  return {
    ...actual,
    useCanvasStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ hideIp: false, serviceStatuses: {} }),
  }
})

const design = (id: string, name: string): Design => ({ id, name, design_type: 'network', created_at: '', updated_at: '' })

function renderNode(extra: Partial<NodeData> = {}) {
  const data: NodeData = { label: 'kero', type: 'proxmox', status: 'online', services: [], ...extra }
  return render(
    <ReactFlowProvider>
      <BaseNode
        {...({ id: 'n1', data, selected: false, icon: Server } as React.ComponentProps<typeof BaseNode>)}
      />
    </ReactFlowProvider>,
  )
}

describe('BaseNode drill-down button', () => {
  beforeEach(() => {
    useDesignStore.setState({
      designs: [design('net', 'Network'), design('host', 'Inside kero')],
      activeDesignId: 'net',
      activeDesignType: 'network',
      trail: [],
    })
  })

  it('names the design the node opens', () => {
    renderNode({ linked_design_id: 'host' })
    expect(screen.getByRole('button', { name: 'Open Inside kero' })).toBeInTheDocument()
  })

  it('opens it on click and keeps the way back', () => {
    renderNode({ linked_design_id: 'host' })
    fireEvent.click(screen.getByRole('button', { name: 'Open Inside kero' }))
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBe('host')
    expect(s.trail).toEqual(['net'])
  })

  it('draws nothing for a node that opens no design', () => {
    renderNode()
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()
  })

  it('draws nothing when the design is unknown here (live view, deleted design)', () => {
    useDesignStore.setState({ designs: [] })
    renderNode({ linked_design_id: 'host' })
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument()
  })
})
