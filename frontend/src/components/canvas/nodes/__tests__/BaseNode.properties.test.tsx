/**
 * A property with no value gives its whole line to the label.
 *
 * The label is capped at max-w-15 so a long key cannot crowd out the value
 * beside it. With no value there is nothing to protect, and keeping the cap
 * truncated the label against empty space (issue #361).
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { Server } from 'lucide-react'
import { BaseNode } from '../BaseNode'
import type { NodeData, NodeProperty } from '@/types'

vi.mock('@/stores/canvasStore', async () => {
  const actual = await vi.importActual<typeof import('@/stores/canvasStore')>('@/stores/canvasStore')
  return {
    ...actual,
    useCanvasStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ hideIp: false, serviceStatuses: {} }),
  }
})

function renderNode(properties: NodeProperty[]) {
  const data: NodeData = { label: 'NAS', type: 'nas', status: 'online', properties }
  return render(
    <ReactFlowProvider>
      <BaseNode
        {...({ id: 'n1', data, selected: false, icon: Server } as React.ComponentProps<typeof BaseNode>)}
      />
    </ReactFlowProvider>,
  )
}

function labelOf(container: HTMLElement, key: string) {
  return [...container.querySelectorAll('span')].find((s) => s.textContent === key)
}

const prop = (key: string, value: string): NodeProperty => ({ key, value, visible: true })

describe('BaseNode properties', () => {
  it('drops the label width cap when the value is empty', () => {
    const { container } = renderNode([prop('A very long property label', '')])
    const label = labelOf(container, 'A very long property label')
    expect(label).toBeDefined()
    expect(label!.className).not.toContain('max-w-15')
    expect(label!.className).toContain('min-w-0')
  })

  it('treats a whitespace-only value as empty', () => {
    const { container } = renderNode([prop('Label', '   ')])
    const label = labelOf(container, 'Label')
    expect(label!.className).not.toContain('max-w-15')
  })

  it('keeps the cap when a value shares the line', () => {
    const { container } = renderNode([prop('Label', '42')])
    const label = labelOf(container, 'Label')
    expect(label!.className).toContain('max-w-15')
    expect(container.textContent).toContain('· 42')
  })
})
