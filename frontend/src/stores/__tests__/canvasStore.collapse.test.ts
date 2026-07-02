import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasStore } from '../canvasStore'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

describe('canvasStore - toggleNodeCollapsed', () => {
  it('toggles collapsed state on a zone node', () => {
    const { result } = renderHook(() => useCanvasStore())

    const node: Node<NodeData> = {
      id: 'zone-1',
      data: { label: 'Test Zone', type: 'groupRect', status: 'online', services: [] },
      position: { x: 0, y: 0 },
    }

    act(() => {
      result.current.addNode(node)
    })

    let zone = result.current.nodes.find((n) => n.id === 'zone-1')
    expect(zone?.data.collapsed).toBeUndefined()

    act(() => {
      result.current.toggleNodeCollapsed('zone-1')
    })

    zone = result.current.nodes.find((n) => n.id === 'zone-1')
    expect(zone?.data.collapsed).toBe(true)

    act(() => {
      result.current.toggleNodeCollapsed('zone-1')
    })

    zone = result.current.nodes.find((n) => n.id === 'zone-1')
    expect(zone?.data.collapsed).toBe(false)
  })

  it('marks canvas as unsaved when toggling collapse', () => {
    const { result } = renderHook(() => useCanvasStore())

    const node: Node<NodeData> = {
      id: 'zone-1',
      data: { label: 'Test Zone', type: 'groupRect', status: 'online', services: [] },
      position: { x: 0, y: 0 },
    }

    act(() => {
      result.current.addNode(node)
      result.current.markSaved()
    })

    expect(result.current.hasUnsavedChanges).toBe(false)

    act(() => {
      result.current.toggleNodeCollapsed('zone-1')
    })

    expect(result.current.hasUnsavedChanges).toBe(true)
  })
})
