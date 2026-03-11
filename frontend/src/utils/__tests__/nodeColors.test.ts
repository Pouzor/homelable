import { describe, it, expect } from 'vitest'
import { resolveNodeColors, NODE_DEFAULT_COLORS } from '../nodeColors'
import type { NodeData } from '@/types'

function makeData(overrides: Partial<NodeData> = {}): Pick<NodeData, 'type' | 'custom_colors'> {
  return { type: 'server', custom_colors: undefined, ...overrides }
}

describe('resolveNodeColors', () => {
  it('returns defaults when no custom_colors set', () => {
    const result = resolveNodeColors(makeData({ type: 'server' }))
    expect(result).toEqual(NODE_DEFAULT_COLORS.server)
  })

  it('returns correct defaults for each node type', () => {
    const types = Object.keys(NODE_DEFAULT_COLORS) as (keyof typeof NODE_DEFAULT_COLORS)[]
    for (const type of types) {
      const result = resolveNodeColors(makeData({ type }))
      expect(result).toEqual(NODE_DEFAULT_COLORS[type])
    }
  })

  it('overrides all three colors when custom_colors is fully set', () => {
    const custom = { border: '#ff0000', background: '#00ff00', icon: '#0000ff' }
    const result = resolveNodeColors(makeData({ type: 'server', custom_colors: custom }))
    expect(result).toEqual(custom)
  })

  it('overrides only border when only border is set', () => {
    const result = resolveNodeColors(makeData({ type: 'switch', custom_colors: { border: '#ff0000' } }))
    expect(result.border).toBe('#ff0000')
    expect(result.background).toBe(NODE_DEFAULT_COLORS.switch.background)
    expect(result.icon).toBe(NODE_DEFAULT_COLORS.switch.icon)
  })

  it('overrides only background when only background is set', () => {
    const result = resolveNodeColors(makeData({ type: 'router', custom_colors: { background: '#123456' } }))
    expect(result.border).toBe(NODE_DEFAULT_COLORS.router.border)
    expect(result.background).toBe('#123456')
    expect(result.icon).toBe(NODE_DEFAULT_COLORS.router.icon)
  })

  it('overrides only icon when only icon is set', () => {
    const result = resolveNodeColors(makeData({ type: 'proxmox', custom_colors: { icon: '#abcdef' } }))
    expect(result.border).toBe(NODE_DEFAULT_COLORS.proxmox.border)
    expect(result.background).toBe(NODE_DEFAULT_COLORS.proxmox.background)
    expect(result.icon).toBe('#abcdef')
  })

  it('falls back to generic defaults for unknown type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = resolveNodeColors({ type: 'unknown' as any, custom_colors: undefined })
    expect(result).toEqual(NODE_DEFAULT_COLORS.generic)
  })

  it('uses theme colors when themeId is provided', () => {
    const result = resolveNodeColors(makeData({ type: 'server' }), 'matrix')
    expect(result.border).not.toBe(NODE_DEFAULT_COLORS.server.border)
    expect(result.border).toBe('#008822') // matrix server accent
  })

  it('custom_colors override theme colors', () => {
    const custom = { border: '#ff0000' }
    const result = resolveNodeColors(makeData({ type: 'server', custom_colors: custom }), 'neon')
    expect(result.border).toBe('#ff0000')
    // background should come from neon theme, not default
    expect(result.background).not.toBe(NODE_DEFAULT_COLORS.server.background)
  })

  it('groupRect always has transparent background regardless of theme', () => {
    for (const themeId of ['default', 'light', 'matrix', 'neon', 'dark'] as const) {
      const result = resolveNodeColors(makeData({ type: 'groupRect' }), themeId)
      expect(result.background).toBe('transparent')
    }
  })
})
