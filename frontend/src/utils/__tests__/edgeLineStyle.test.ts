import { describe, it, expect } from 'vitest'
import {
  EDGE_LINE_STYLES,
  EDGE_TYPE_BASE_WIDTH,
  EDGE_TYPE_DEFAULT_LINE,
  clampWidthMult,
  dashArrayFor,
} from '@/utils/edgeLineStyle'
import { EDGE_TYPE_LABELS } from '@/types'

describe('edgeLineStyle', () => {
  it('lists the three render styles', () => {
    expect(EDGE_LINE_STYLES).toEqual(['solid', 'dashed', 'dotted'])
  })

  it('has a base width + default line for every edge type', () => {
    for (const t of Object.keys(EDGE_TYPE_LABELS) as (keyof typeof EDGE_TYPE_LABELS)[]) {
      expect(EDGE_TYPE_BASE_WIDTH[t]).toBeGreaterThan(0)
      expect(EDGE_LINE_STYLES).toContain(EDGE_TYPE_DEFAULT_LINE[t])
    }
  })

  it('clampWidthMult keeps values within 1..4 and defaults to 1', () => {
    expect(clampWidthMult(undefined)).toBe(1)
    expect(clampWidthMult(NaN)).toBe(1)
    expect(clampWidthMult(0)).toBe(1)
    expect(clampWidthMult(2.5)).toBe(2.5)
    expect(clampWidthMult(9)).toBe(4)
  })

  it('dashArrayFor returns undefined for solid and a pattern otherwise', () => {
    expect(dashArrayFor('solid', 2)).toBeUndefined()
    expect(dashArrayFor('dashed', 2)).toBe('6 4')
    expect(dashArrayFor('dotted', 2)).toBe('2 3.6')
  })

  it('dashArrayFor scales with stroke width', () => {
    expect(dashArrayFor('dashed', 4)).toBe('12 8')
  })
})
