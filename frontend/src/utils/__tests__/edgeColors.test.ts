import { describe, it, expect } from 'vitest'
import { EDGE_DEFAULT_COLORS } from '../edgeColors'
import type { EdgeType } from '@/types'

const EDGE_TYPES: EdgeType[] = ['ethernet', 'wifi', 'iot', 'vlan', 'virtual', 'cluster']

describe('EDGE_DEFAULT_COLORS', () => {
  it('has an entry for every EdgeType', () => {
    for (const type of EDGE_TYPES) {
      expect(EDGE_DEFAULT_COLORS[type]).toBeDefined()
    }
  })

  it('all colors are valid hex strings', () => {
    for (const color of Object.values(EDGE_DEFAULT_COLORS)) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('ethernet default is the dark gray neutral color', () => {
    expect(EDGE_DEFAULT_COLORS.ethernet).toBe('#30363d')
  })

  it('wifi default is cyan', () => {
    expect(EDGE_DEFAULT_COLORS.wifi).toBe('#00d4ff')
  })

  it('iot default is amber', () => {
    expect(EDGE_DEFAULT_COLORS.iot).toBe('#e3b341')
  })

  it('virtual default is muted gray', () => {
    expect(EDGE_DEFAULT_COLORS.virtual).toBe('#8b949e')
  })

  it('cluster default is proxmox orange', () => {
    expect(EDGE_DEFAULT_COLORS.cluster).toBe('#ff6e00')
  })
})
