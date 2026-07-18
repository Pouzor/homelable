import { describe, it, expect } from 'vitest'
import { getSteps, STEPS } from '../steps'

describe('getSteps', () => {
  it('returns every step in full mode', () => {
    expect(getSteps(false)).toHaveLength(STEPS.length)
  })

  it('drops backend-only (mode:full) steps in standalone', () => {
    const standalone = getSteps(true)
    expect(standalone.every((s) => s.mode !== 'full')).toBe(true)
    expect(standalone.length).toBeLessThan(STEPS.length)
    const ids = standalone.map((s) => s.id)
    // Canvas-only steps survive; backend-only steps are filtered out.
    expect(ids).toEqual(expect.arrayContaining(['welcome', 'nodes', 'grouping', 'style', 'end']))
    expect(ids).not.toContain('scan')
    expect(ids).not.toContain('scan-history')
    expect(ids).not.toContain('inventory')
    expect(ids).not.toContain('imports')
  })

  it('ends on a step with a GitHub link (the full-mode recap in standalone)', () => {
    const last = getSteps(true).at(-1)
    expect(last?.id).toBe('end')
    expect(last?.link?.href).toContain('github.com')
  })
})
