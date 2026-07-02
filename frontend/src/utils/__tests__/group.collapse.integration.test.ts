import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasStore } from '../../stores/canvasStore'
import { computeCollapseInfo } from '../collapseFilter'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const mk = (id: string, type: NodeData['type'] = 'server'): Node<NodeData> => ({
  id,
  type,
  position: { x: 100, y: 100 },
  data: { label: id, type, status: 'online', services: [] },
})

describe('integration — createGroup + toggleNodeCollapsed hides children', () => {
  it('hides parentId children of a collapsed group container', () => {
    const { result } = renderHook(() => useCanvasStore())
    act(() => {
      result.current.addNode(mk('c1'))
      result.current.addNode(mk('c2'))
      result.current.createGroup(['c1', 'c2'], 'My Group')
    })
    // Find the auto-generated group id.
    const grp = result.current.nodes.find((n) => n.type === 'group')!
    expect(grp).toBeDefined()
    expect(result.current.nodes.find((n) => n.id === 'c1')!.parentId).toBe(grp.id)

    // Pre-collapse: all visible.
    let info = computeCollapseInfo(result.current.nodes)
    expect(info.visibleIds.has('c1')).toBe(true)
    expect(info.visibleIds.has('c2')).toBe(true)

    // Collapse the group via the store action.
    act(() => result.current.toggleNodeCollapsed(grp.id))
    expect(result.current.nodes.find((n) => n.id === grp.id)!.data.collapsed).toBe(true)

    info = computeCollapseInfo(result.current.nodes)
    expect(info.visibleIds.has(grp.id)).toBe(true)
    expect(info.visibleIds.has('c1')).toBe(false)
    expect(info.visibleIds.has('c2')).toBe(false)
    expect(info.hiddenBy.get('c1')).toBe(grp.id)
  })
})
