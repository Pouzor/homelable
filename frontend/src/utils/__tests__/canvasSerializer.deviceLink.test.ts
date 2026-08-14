/**
 * A node carries the id of the Device Inventory row it draws. The link has to
 * survive a save, or the next one would mint a second row for the same device.
 */
import { describe, it, expect } from 'vitest'
import { serializeNode, deserializeApiNode } from '@/utils/canvasSerializer'
import { DEVICE_FACT_FIELDS, factsBaselineOf } from '@/utils/deviceFacts'
import type { NodeData } from '@/types'
import type { Node } from '@xyflow/react'

function node(data: Partial<NodeData>): Node<NodeData> {
  return {
    id: 'n1',
    type: data.type ?? 'server',
    position: { x: 10, y: 20 },
    data: { label: 'NAS', type: 'server', status: 'online', services: [], ...data },
  }
}

describe('serializeNode — device link', () => {
  it('sends the device_id it was loaded with', () => {
    expect(serializeNode(node({ device_id: 'dev-1' })).device_id).toBe('dev-1')
  })

  it('sends null when the node has no row yet', () => {
    expect(serializeNode(node({})).device_id).toBeNull()
  })

  it('sends null for a zone — furniture describes nothing physical', () => {
    expect(serializeNode(node({ type: 'groupRect' })).device_id).toBeNull()
  })
})

describe('serializeNode — changed_facts', () => {
  it('claims nothing when the node still holds what it loaded', () => {
    const n = node({ device_id: 'dev-1', notes: 'in the garage' })
    expect(serializeNode(n, factsBaselineOf(n.data)).changed_facts).toEqual([])
  })

  it('claims only the edited fact, so the rest of the row is left alone', () => {
    const loaded = node({ device_id: 'dev-1', notes: 'in the garage' })
    const edited = node({ device_id: 'dev-1', notes: 'moved to the loft' })
    expect(serializeNode(edited, factsBaselineOf(loaded.data)).changed_facts).toEqual(['notes'])
  })

  it('claims every fact with no baseline — a node the server has never seen', () => {
    expect(serializeNode(node({ device_id: null })).changed_facts).toEqual([...DEVICE_FACT_FIELDS])
  })
})

describe('deserializeApiNode — device link', () => {
  it('hoists device_id onto node data', () => {
    const rf = deserializeApiNode(
      {
        id: 'n1',
        type: 'server',
        label: 'NAS',
        pos_x: 0,
        pos_y: 0,
        status: 'online',
        services: [],
        device_id: 'dev-1',
      },
      new Map(),
    )
    expect(rf.data.device_id).toBe('dev-1')
  })
})
