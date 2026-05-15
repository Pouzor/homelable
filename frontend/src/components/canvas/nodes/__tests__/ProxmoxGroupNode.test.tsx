import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { ProxmoxGroupNode } from '../ProxmoxGroupNode'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import type { NodeData, NodeProperty } from '@/types'
import type { NodeProps, Node } from '@xyflow/react'

function renderNode(data: Partial<NodeData> = {}, selected = false) {
  const fullData: NodeData = {
    label: 'pve-01',
    type: 'proxmox',
    status: 'online',
    services: [],
    ...data,
  }
  const props = {
    id: 'p1',
    data: fullData,
    selected,
    type: 'proxmox',
    zIndex: 0,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
    deletable: true,
    draggable: true,
    selectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    width: 300,
    height: 200,
    dragHandle: undefined,
    parentId: undefined,
    sourcePosition: undefined,
    targetPosition: undefined,
  } as unknown as NodeProps<Node<NodeData>>
  return render(
    <ReactFlowProvider>
      <ProxmoxGroupNode {...props} />
    </ReactFlowProvider>
  )
}

describe('ProxmoxGroupNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ hideIp: false })
    useThemeStore.setState({ activeTheme: 'default' })
  })

  it('renders the node label', () => {
    const { getByText } = renderNode({ label: 'My Proxmox' })
    expect(getByText('My Proxmox')).toBeDefined()
  })

  it('renders ip when provided', () => {
    const { getByText } = renderNode({ ip: '192.168.1.10' })
    expect(getByText('192.168.1.10')).toBeDefined()
  })

  it('renders multiple ips when comma separated', () => {
    const { getByText } = renderNode({ ip: '10.0.0.1, 10.0.0.2' })
    expect(getByText('10.0.0.1')).toBeDefined()
    expect(getByText('10.0.0.2')).toBeDefined()
  })

  it('masks ip when hideIp is enabled in store', () => {
    useCanvasStore.setState({ hideIp: true })
    const { queryByText } = renderNode({ ip: '192.168.1.10' })
    expect(queryByText('192.168.1.10')).toBeNull()
  })

  it('renders visible properties only', () => {
    const properties: NodeProperty[] = [
      { key: 'CPU', value: '16 cores', icon: null, visible: true },
      { key: 'Hidden', value: 'should-not-show', icon: null, visible: false },
    ]
    const { getByText, queryByText } = renderNode({ properties })
    expect(getByText('CPU')).toBeDefined()
    expect(getByText(/16 cores/)).toBeDefined()
    expect(queryByText('Hidden')).toBeNull()
    expect(queryByText(/should-not-show/)).toBeNull()
  })

  it('renders status dot with title matching status', () => {
    const { container } = renderNode({ status: 'offline' })
    const dot = container.querySelector('[title="offline"]')
    expect(dot).not.toBeNull()
  })

  it('container_mode === false renders as BaseNode (no resizer group border)', () => {
    const { container } = renderNode({ container_mode: false })
    // NodeResizer should not be present when not group-rendered
    expect(container.querySelector('.react-flow__resize-control')).toBeNull()
  })

  it('container_mode default renders the group border container', () => {
    const { container } = renderNode({})
    // Group border div has rounded-xl border-2 classes
    expect(container.querySelector('.rounded-xl.border-2')).not.toBeNull()
  })

  it('container mode renders bottom_handles snap points', () => {
    const { container } = renderNode({ bottom_handles: 4 })
    const sourceHandles = container.querySelectorAll('.react-flow__handle-bottom.source')
    expect(sourceHandles.length).toBe(4)
  })

  it('container mode default has single bottom handle', () => {
    const { container } = renderNode({})
    const sourceHandles = container.querySelectorAll('.react-flow__handle-bottom.source')
    expect(sourceHandles.length).toBe(1)
  })

  it('renders cluster handles in both modes', () => {
    const { container: groupC } = renderNode({})
    expect(groupC.querySelectorAll('[title="Same cluster"]').length).toBeGreaterThanOrEqual(2)
    const { container: nodeC } = renderNode({ container_mode: false })
    expect(nodeC.querySelectorAll('[title="Same cluster"]').length).toBeGreaterThanOrEqual(2)
  })
})
