import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TextNode } from '../TextNode'
import { useCanvasStore } from '@/stores/canvasStore'
import type { NodeData } from '@/types'
import type { NodeProps, Node } from '@xyflow/react'

function renderNode(data: Partial<NodeData> = {}) {
  const fullData: NodeData = {
    label: '',
    type: 'text',
    status: 'unknown',
    services: [],
    text_content: 'Hello',
    ...data,
  }
  const props = {
    id: 't1',
    data: fullData,
    selected: false,
    type: 'text',
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
    width: 200,
    height: 60,
    dragHandle: undefined,
    parentId: undefined,
    sourcePosition: undefined,
    targetPosition: undefined,
  } as unknown as NodeProps<Node<NodeData>>
  return render(
    <ReactFlowProvider>
      <TextNode {...props} />
    </ReactFlowProvider>
  )
}

describe('TextNode', () => {
  beforeEach(() => {
    useCanvasStore.setState({ editingTextId: null })
  })

  it('renders text_content', () => {
    const { getByText } = renderNode({ text_content: 'My label' })
    expect(getByText('My label')).toBeDefined()
  })

  it('falls back to label when text_content is missing', () => {
    const { getByText } = renderNode({ text_content: undefined, label: 'Fallback' })
    expect(getByText('Fallback')).toBeDefined()
  })

  it('double-click sets editingTextId in store', () => {
    const { getByText } = renderNode({ text_content: 'Edit me' })
    fireEvent.doubleClick(getByText('Edit me'))
    expect(useCanvasStore.getState().editingTextId).toBe('t1')
  })
})
