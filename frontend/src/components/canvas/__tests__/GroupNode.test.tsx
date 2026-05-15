import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GroupNode } from '../nodes/GroupNode'
import * as canvasStore from '@/stores/canvasStore'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

vi.mock('@/stores/canvasStore')

vi.mock('@xyflow/react', () => ({
  NodeResizer: ({ isVisible }: { isVisible: boolean }) => (
    <div data-testid="node-resizer" data-visible={isVisible} />
  ),
  Handle: () => null,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  useReactFlow: () => ({}),
}))

vi.mock('@xyflow/react/dist/style.css', () => ({}))

function makeGroupNode(overrides: Partial<NodeData> = {}): Node<NodeData> {
  return {
    id: 'g1',
    type: 'group',
    position: { x: 0, y: 0 },
    width: 400,
    height: 250,
    data: {
      label: 'My Group',
      type: 'group',
      status: 'unknown',
      services: [],
      custom_colors: { show_border: true },
      ...overrides,
    },
  }
}

function renderGroupNode(props: Partial<Parameters<typeof GroupNode>[0]> = {}, storeNodes: unknown[] = []) {
  const node = makeGroupNode(props.data)
  vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
    nodes: storeNodes,
    updateNode: vi.fn(),
    snapshotHistory: vi.fn(),
  } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

  return render(
    <GroupNode
      id="g1"
      data={node.data}
      selected={false}
      dragging={false}
      zIndex={1}
      isConnectable={true}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      {...props}
    />,
  )
}

describe('GroupNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the group label when show_border is true', () => {
    renderGroupNode()
    expect(screen.getByText('My Group')).toBeDefined()
  })

  it('hides the header when show_border is false and not selected', () => {
    renderGroupNode({ data: makeGroupNode({ custom_colors: { show_border: false } }).data, selected: false })
    expect(screen.queryByText('My Group')).toBeNull()
  })

  it('shows header when show_border is false but node is selected', () => {
    renderGroupNode({ data: makeGroupNode({ custom_colors: { show_border: false } }).data, selected: true })
    expect(screen.getByText('My Group')).toBeDefined()
  })

  it('shows NodeResizer only when selected', () => {
    const { rerender } = renderGroupNode({ selected: false })
    expect(screen.getByTestId('node-resizer').getAttribute('data-visible')).toBe('false')

    vi.mocked(canvasStore.useCanvasStore).mockReturnValue({
      nodes: [],
      updateNode: vi.fn(),
      snapshotHistory: vi.fn(),
    } as unknown as ReturnType<typeof canvasStore.useCanvasStore>)

    rerender(
      <GroupNode
        id="g1"
        data={makeGroupNode().data}
        selected={true}
        dragging={false}
        zIndex={1}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
    )
    expect(screen.getByTestId('node-resizer').getAttribute('data-visible')).toBe('true')
  })

  it('allows dragging from the header while keeping rename controls nodrag', () => {
    renderGroupNode({ selected: true })

    expect(screen.getByText('My Group').closest('div')).not.toHaveClass('nodrag')

    const renameButton = screen.getByTitle('Rename group')
    expect(renameButton).toHaveClass('nodrag')

    fireEvent.click(renameButton)

    expect(screen.getByDisplayValue('My Group')).toHaveClass('nodrag')
  })

  it('shows online/offline status summary from children', () => {
    const storeNodes = [
      { id: 'c1', parentId: 'g1', data: { status: 'online' } },
      { id: 'c2', parentId: 'g1', data: { status: 'offline' } },
      { id: 'c3', parentId: 'other', data: { status: 'online' } }, // different group — excluded
    ]

    renderGroupNode({}, storeNodes)
    // Two status indicators: one online, one offline (c3 excluded — wrong parent)
    const statusSpans = screen.getAllByText(/● \d+/)
    expect(statusSpans).toHaveLength(2)
  })

  it('does not show status summary when group has no children', () => {
    renderGroupNode()
    expect(screen.queryByText(/●/)).toBeNull()
  })
})
