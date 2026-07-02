import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'
import { serializeNode, deserializeApiNode, type ApiNode } from '@/utils/canvasSerializer'

/**
 * Persistence contract for the collapse flag on groupRect nodes:
 *
 *   1. Serialize stashes `data.collapsed` into `custom_colors.collapsed`
 *      so the existing API blob shape can carry it without a schema change.
 *   2. Deserialize hoists it back to the first-class `data.collapsed` field.
 *   3. Legacy saves that already had `custom_colors.collapsed` (the original
 *      shape from PR #158 before the field was promoted) still load
 *      correctly.
 */

function makeGroupRectRfNode(collapsed?: boolean): Node<NodeData> {
  return {
    id: 'zone-1',
    type: 'groupRect',
    position: { x: 0, y: 0 },
    data: {
      label: 'Zigbee Mesh',
      type: 'groupRect',
      status: 'unknown',
      services: [],
      ...(collapsed !== undefined ? { collapsed } : {}),
    },
  }
}

describe('canvasSerializer — groupRect collapse', () => {
  it('stashes data.collapsed=true into custom_colors on serialize', () => {
    const rf = makeGroupRectRfNode(true)
    const api = serializeNode(rf) as Record<string, unknown>
    const cc = api.custom_colors as Record<string, unknown>
    expect(cc.collapsed).toBe(true)
  })

  it('writes collapsed=false when the flag is missing (explicit default)', () => {
    const rf = makeGroupRectRfNode(undefined)
    const api = serializeNode(rf) as Record<string, unknown>
    const cc = api.custom_colors as Record<string, unknown>
    expect(cc.collapsed).toBe(false)
  })

  it('hoists custom_colors.collapsed back to data.collapsed on deserialize', () => {
    const apiNode: ApiNode = {
      id: 'zone-1',
      type: 'groupRect',
      label: 'Zone',
      pos_x: 0,
      pos_y: 0,
      status: 'unknown',
      services: [],
      custom_colors: { collapsed: true, width: 360, height: 240 },
    }
    const rf = deserializeApiNode(apiNode, new Map())
    expect(rf.data.collapsed).toBe(true)
  })

  it('treats missing custom_colors.collapsed as false on deserialize', () => {
    const apiNode: ApiNode = {
      id: 'zone-1',
      type: 'groupRect',
      label: 'Zone',
      pos_x: 0,
      pos_y: 0,
      status: 'unknown',
      services: [],
      custom_colors: { width: 360, height: 240 },
    }
    const rf = deserializeApiNode(apiNode, new Map())
    expect(rf.data.collapsed).toBe(false)
  })

  it('round-trips the collapse flag through serialize → deserialize', () => {
    const rf = makeGroupRectRfNode(true)
    const api = serializeNode(rf) as unknown as ApiNode
    const back = deserializeApiNode(api, new Map())
    expect(back.data.collapsed).toBe(true)
  })
})

describe('canvasSerializer — collapse on non-groupRect node types', () => {
  it('stashes data.collapsed into custom_colors for a group container', () => {
    const rf: Node<NodeData> = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: {
        label: 'Container',
        type: 'group',
        status: 'unknown',
        services: [],
        custom_colors: { show_border: true },
        collapsed: true,
      },
    }
    const api = serializeNode(rf) as Record<string, unknown>
    const cc = api.custom_colors as Record<string, unknown>
    expect(cc.collapsed).toBe(true)
    // Existing custom_colors keys are preserved alongside the stash.
    expect(cc.show_border).toBe(true)
  })

  it('leaves custom_colors null when neither flag nor colors are set', () => {
    const rf: Node<NodeData> = {
      id: 's1',
      type: 'server',
      position: { x: 0, y: 0 },
      data: { label: 'Server', type: 'server', status: 'online', services: [] },
    }
    const api = serializeNode(rf) as Record<string, unknown>
    expect(api.custom_colors).toBeNull()
  })

  it('hoists custom_colors.collapsed to data.collapsed for a group container', () => {
    const apiNode: ApiNode = {
      id: 'g1',
      type: 'group',
      label: 'Container',
      pos_x: 0,
      pos_y: 0,
      status: 'unknown',
      services: [],
      custom_colors: { show_border: true, collapsed: true },
    }
    const rf = deserializeApiNode(apiNode, new Map())
    expect(rf.data.collapsed).toBe(true)
  })

  it('round-trips collapse on a group container', () => {
    const rf: Node<NodeData> = {
      id: 'g1',
      type: 'group',
      position: { x: 0, y: 0 },
      data: {
        label: 'Container',
        type: 'group',
        status: 'unknown',
        services: [],
        custom_colors: { show_border: true },
        collapsed: true,
      },
    }
    const api = serializeNode(rf) as unknown as ApiNode
    const back = deserializeApiNode(api, new Map())
    expect(back.data.collapsed).toBe(true)
  })
})
