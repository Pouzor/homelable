import { describe, it, expect } from 'vitest'
import { nodeTypes } from '../nodeTypes'

describe('nodeTypes registry', () => {
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
