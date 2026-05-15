import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { GroupNode } from '../GroupNode'
import { useCanvasStore } from '@/stores/canvasStore'
import { useThemeStore } from '@/stores/themeStore'
import type { NodeData } from '@/types'
import type { NodeProps, Node } from '@xyflow/react'

function renderNode(data: Partial<NodeData> = {}, selected = false) {
  const fullData: NodeData = {
    label: 'Group A',
    type: 'group',
    status: 'unknown',
    services: [],
    ...data,
  }
  const props = {
    id: 'g1',
    data: fullData,
    selected,
    type: 'group',
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
      <GroupNode {...props} />
    </ReactFlowProvider>
  )
}

describe('GroupNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ nodes: [], hideIp: false })
    useThemeStore.setState({ activeTheme: 'default' })
  })

  it('renders label', () => {
    const { getByText } = renderNode({ label: 'My Group' })
    expect(getByText('My Group')).toBeDefined()
  })

  it('renders 4 source handles (one per side)', () => {
    const { container } = renderNode()
    expect(container.querySelector('.react-flow__handle-top.source')).not.toBeNull()
    expect(container.querySelector('.react-flow__handle-right.source')).not.toBeNull()
    expect(container.querySelector('.react-flow__handle-bottom.source')).not.toBeNull()
    expect(container.querySelector('.react-flow__handle-left.source')).not.toBeNull()
  })

  it('renders 4 target handles (one per side)', () => {
    const { container } = renderNode()
    expect(container.querySelector('.react-flow__handle-top.target')).not.toBeNull()
    expect(container.querySelector('.react-flow__handle-right.target')).not.toBeNull()
    expect(container.querySelector('.react-flow__handle-bottom.target')).not.toBeNull()
    expect(container.querySelector('.react-flow__handle-left.target')).not.toBeNull()
  })

  it('source handles carry side-specific ids', () => {
    const { container } = renderNode()
    expect(container.querySelector('[data-handleid="group-top"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="group-right"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="group-bottom"]')).not.toBeNull()
    expect(container.querySelector('[data-handleid="group-left"]')).not.toBeNull()
  })
})
