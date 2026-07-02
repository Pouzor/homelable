import { describe, it, expect } from 'vitest'
import type { NodeData } from '@/types'

/**
 * Type-level assertions for the collapse feature. Behavioral coverage lives
 * in:
 *   - src/stores/__tests__/canvasStore.collapse.test.ts (store action)
 *   - src/utils/__tests__/collapseFilter.test.ts        (BFS + edge rewire)
 *   - src/utils/__tests__/canvasSerializer.collapse.test.ts (round-trip)
 */
describe('NodeData.collapsed', () => {
  it('accepts a boolean collapsed flag as a first-class field', () => {
    const nodeData: NodeData = {
      label: 'Test Zone',
      type: 'groupRect',
      status: 'online',
      services: [],
      collapsed: true,
    }
    expect(nodeData.collapsed).toBe(true)
  })

  it('treats a missing flag as expanded', () => {
    const nodeData: NodeData = {
      label: 'Test Zone',
      type: 'groupRect',
      status: 'online',
      services: [],
    }
    expect(nodeData.collapsed).toBeUndefined()
  })
})
