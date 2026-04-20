import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupRectNode } from '../nodes/GroupRectNode'
import type { NodeData } from '@/types'
import type { Node } from '@xyflow/react'

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type }: { id: string; type: string }) => <div data-testid={`handle-${id}`} data-type={type} />,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  NodeResizer: () => null,
}))

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: (s: { setEditingGroupRectId: () => void }) => unknown) =>
    sel({ setEditingGroupRectId: vi.fn() }),
}))

function makeNode(overrides: Partial<NodeData> = {}): Node<NodeData> {
  return {
    id: 'zone1',
    type: 'groupRect',
    position: { x: 0, y: 0 },
    data: { label: 'My Zone', type: 'groupRect', status: 'unknown', services: [], ...overrides },
  }
}

function renderZone(overrides: Partial<NodeData> = {}) {
  const node = makeNode(overrides)
  return render(
    <GroupRectNode
      id={node.id}
      data={node.data}
      selected={false}
      type="groupRect"
      dragging={false}
      zIndex={0}
      isConnectable={true}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />
  )
}

describe('GroupRectNode — handles', () => {
  it('renders source handles on all four sides', () => {
    renderZone()
    expect(screen.getByTestId('handle-zone-top')).toBeDefined()
    expect(screen.getByTestId('handle-zone-right')).toBeDefined()
    expect(screen.getByTestId('handle-zone-bottom')).toBeDefined()
    expect(screen.getByTestId('handle-zone-left')).toBeDefined()
  })

  it('renders target handles on all four sides', () => {
    renderZone()
    expect(screen.getByTestId('handle-zone-top-t')).toBeDefined()
    expect(screen.getByTestId('handle-zone-right-t')).toBeDefined()
    expect(screen.getByTestId('handle-zone-bottom-t')).toBeDefined()
    expect(screen.getByTestId('handle-zone-left-t')).toBeDefined()
  })

  it('renders 8 handles total (4 source + 4 target)', () => {
    renderZone()
    expect(screen.getAllByTestId(/^handle-zone-/).length).toBe(8)
  })
})

describe('GroupRectNode — label', () => {
  it('renders inside label by default', () => {
    renderZone({ label: 'DMZ' })
    expect(screen.getByText('DMZ')).toBeDefined()
  })

  it('renders no label when label is empty', () => {
    renderZone({ label: '' })
    expect(screen.queryByText('DMZ')).toBeNull()
  })
})
