import { describe, it, expect } from 'vitest'
import { NODE_TYPE_LABELS, STATUS_COLORS, EDGE_TYPE_LABELS } from '@/types'
import type { CheckMethod } from '@/types'

describe('NODE_TYPE_LABELS', () => {
  it('has an entry for every node type', () => {
    const expectedTypes = ['isp', 'router', 'firewall', 'switch', 'server', 'proxmox', 'vm', 'lxc', 'nas', 'iot', 'ap', 'camera', 'generic']
    expectedTypes.forEach((t) => {
      expect(NODE_TYPE_LABELS).toHaveProperty(t)
      expect(typeof NODE_TYPE_LABELS[t as keyof typeof NODE_TYPE_LABELS]).toBe('string')
    })
  })
})

describe('STATUS_COLORS', () => {
  it('has a hex color for each status', () => {
    const statuses = ['online', 'offline', 'pending', 'unknown'] as const
    statuses.forEach((s) => {
      expect(STATUS_COLORS[s]).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  it('online is green, offline is red', () => {
    expect(STATUS_COLORS.online).toBe('#39d353')
    expect(STATUS_COLORS.offline).toBe('#f85149')
  })
})

describe('EDGE_TYPE_LABELS', () => {
  it('has an entry for every edge type', () => {
    const expectedTypes = ['ethernet', 'wifi', 'iot', 'vlan', 'virtual', 'cluster']
    expectedTypes.forEach((t) => {
      expect(EDGE_TYPE_LABELS).toHaveProperty(t)
    })
  })
})

describe('CheckMethod', () => {
  it('includes none as a valid check method', () => {
    const methods: CheckMethod[] = ['none', 'ping', 'http', 'https', 'tcp', 'ssh', 'prometheus', 'health']
    // All values are valid CheckMethod — this is a compile-time type check;
    // runtime test just ensures the array is well-formed
    expect(methods).toContain('none')
    expect(methods).toContain('ping')
    expect(methods.length).toBe(8)
  })
})
