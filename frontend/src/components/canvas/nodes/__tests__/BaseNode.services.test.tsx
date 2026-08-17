/**
 * A service hidden on this node stays on the device.
 *
 * Order and visibility are the node's, the facts are the inventory row's, so
 * the same device drawn on two canvases can show two different service lists.
 * The node card only draws what its own copy says is visible.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { Server } from 'lucide-react'
import { BaseNode } from '../BaseNode'
import type { NodeData, ServiceInfo } from '@/types'

vi.mock('@/stores/canvasStore', async () => {
  const actual = await vi.importActual<typeof import('@/stores/canvasStore')>('@/stores/canvasStore')
  return {
    ...actual,
    useCanvasStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ hideIp: false, serviceStatuses: {} }),
  }
})

const ssh: ServiceInfo = { port: 22, protocol: 'tcp', service_name: 'ssh' }
const kuma: ServiceInfo = { port: 3001, protocol: 'tcp', service_name: 'Uptime Kuma' }

function renderNode(services: ServiceInfo[]) {
  const data: NodeData = {
    label: 'NAS',
    type: 'nas',
    status: 'online',
    services,
    // Services only render when the node is set to show them.
    custom_colors: { show_services: true },
  }
  return render(
    <ReactFlowProvider>
      <BaseNode
        {...({ id: 'n1', data, selected: false, icon: Server } as React.ComponentProps<typeof BaseNode>)}
      />
    </ReactFlowProvider>,
  )
}

describe('BaseNode services', () => {
  it('draws a service that carries no visible flag', () => {
    renderNode([ssh, kuma])
    expect(screen.getByText('ssh')).toBeInTheDocument()
    expect(screen.getByText('Uptime Kuma')).toBeInTheDocument()
  })

  it('leaves out one this node hid, keeping the rest', () => {
    renderNode([ssh, { ...kuma, visible: false }])
    expect(screen.getByText('ssh')).toBeInTheDocument()
    expect(screen.queryByText('Uptime Kuma')).not.toBeInTheDocument()
  })

  it('draws them in the order the node carries', () => {
    const { container } = renderNode([kuma, ssh])
    const names = [...container.querySelectorAll('span.font-medium')].map((n) => n.textContent)
    expect(names.filter((n) => n === 'ssh' || n === 'Uptime Kuma')).toEqual(['Uptime Kuma', 'ssh'])
  })
})
