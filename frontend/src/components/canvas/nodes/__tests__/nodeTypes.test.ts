import { describe, it, expect } from 'vitest'
import { nodeTypes } from '../nodeTypes'
import { NODE_TYPE_LABELS, type NodeType } from '@/types'
import { NODE_TYPE_DEFAULT_ICONS } from '@/utils/nodeIcons'

describe('nodeTypes registry', () => {
  it('registers a component for every declared node type', () => {
    // Adding a NodeType touches several hand-written maps; the Record<NodeType, …>
    // ones fail typecheck when one is missed, this registry does not.
    for (const t of Object.keys(NODE_TYPE_LABELS) as NodeType[]) {
      expect(nodeTypes[t as keyof typeof nodeTypes], `missing nodeType: ${t}`).toBeDefined()
    }
  })

  it('gives the KVM type a label, an icon and a component', () => {
    expect(NODE_TYPE_LABELS.kvm).toBe('KVM Switch')
    expect(NODE_TYPE_DEFAULT_ICONS.kvm).toBeDefined()
    expect(nodeTypes.kvm).toBeDefined()
  })

  it('registers a component for every wireless mesh node type', () => {
    // Regression: zwave_* types were missing, so React Flow fell back to the
    // default (unstyled) node — no icon, no accent. (Zigbee covered too.)
    for (const t of [
      'zigbee_coordinator', 'zigbee_router', 'zigbee_enddevice',
      'zwave_coordinator', 'zwave_router', 'zwave_enddevice',
    ]) {
      expect(nodeTypes[t as keyof typeof nodeTypes], `missing nodeType: ${t}`).toBeDefined()
    }
  })
})
