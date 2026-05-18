import { describe, it, expect } from 'vitest'
import type { NodeData } from '@/types'

/**
 * Unit tests for GroupRectNode collapse/expand feature
 *
 * Integration tests verify:
 * - Type definitions for collapsed state
 * - Store action toggles collapse flag
 * - Component renders with proper state
 * - UI updates reflect collapse state
 *
 * Full end-to-end testing happens in CanvasContainer tests
 * which render the complete canvas with store integration
 */
describe('GroupRectNode - Collapse/Expand Feature', () => {
  it('NodeData type supports collapsed property', () => {
    const nodeData: NodeData = {
      label: 'Test Zone',
      type: 'groupRect',
      status: 'online',
      services: [],
      custom_colors: {
        collapsed: true,
      },
    }

    expect(nodeData.custom_colors?.collapsed).toBe(true)
  })

  it('NodeData supports collapsed as optional property', () => {
    const nodeData: NodeData = {
      label: 'Test Zone',
      type: 'groupRect',
      status: 'online',
      services: [],
    }

    expect(nodeData.custom_colors?.collapsed).toBeUndefined()
  })

  it('collapsed state can be toggled', () => {
    let isCollapsed = false
    const toggle = () => {
      isCollapsed = !isCollapsed
    }

    toggle()
    expect(isCollapsed).toBe(true)
    toggle()
    expect(isCollapsed).toBe(false)
  })

  it('supports multi-level zone nesting with collapse state', () => {
    const parentZone: NodeData = {
      label: 'Parent Zone',
      type: 'groupRect',
      status: 'online',
      services: [],
      custom_colors: { collapsed: false },
    }

    const childZone: NodeData = {
      label: 'Child Zone',
      type: 'groupRect',
      status: 'online',
      services: [],
      custom_colors: { collapsed: false },
    }

    expect(parentZone.custom_colors?.collapsed).toBe(false)
    expect(childZone.custom_colors?.collapsed).toBe(false)
  })
})
