import { describe, it, expect } from 'vitest'
import {
  bottomHandleIdAt,
  getBottomHandleIds,
  getBottomHandlePositions,
  normalizeHandle,
  removedBottomHandleIds,
} from '../handleUtils'

describe('bottomHandleIdAt/getBottomHandleIds', () => {
  it('first id is always "bottom" for backward compatibility', () => {
    expect(bottomHandleIdAt(0)).toBe('bottom')
  })

  it('generates ids for arbitrary counts', () => {
    expect(getBottomHandleIds(4)).toEqual(['bottom', 'bottom-2', 'bottom-3', 'bottom-4'])
    expect(getBottomHandleIds(7)).toEqual(['bottom', 'bottom-2', 'bottom-3', 'bottom-4', 'bottom-5', 'bottom-6', 'bottom-7'])
  })
})

describe('getBottomHandlePositions', () => {
  it('1 handle is centered at 50%', () => {
    expect(getBottomHandlePositions(1)).toEqual([50])
  })

  it('2 handles are symmetric', () => {
    const [a, b] = getBottomHandlePositions(2)
    expect(a).toBeLessThan(50)
    expect(b).toBeGreaterThan(50)
    expect(a + b).toBe(100)
  })

  it('3 handles include a center at 50%', () => {
    expect(getBottomHandlePositions(3)).toContain(50)
    expect(getBottomHandlePositions(3)).toHaveLength(3)
  })

  it('4 handles keep legacy spacing', () => {
    const pos = getBottomHandlePositions(4)
    expect(pos).toEqual([15, 38, 62, 85])
  })

  it('6 handles are generated with increasing evenly spaced positions', () => {
    const pos = getBottomHandlePositions(6)
    expect(pos).toHaveLength(6)
    // All values should be between 0 and 100 exclusive
    pos.forEach((p) => {
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThan(100)
    })
    // Positions should be strictly increasing
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i]).toBeGreaterThan(pos[i - 1])
    }
  })
})

describe('normalizeHandle', () => {
  it('returns null for null/undefined', () => {
    expect(normalizeHandle(null)).toBeNull()
    expect(normalizeHandle(undefined)).toBeNull()
  })

  it('maps top-t → top', () => {
    expect(normalizeHandle('top-t')).toBe('top')
  })

  it('maps bottom-t → bottom', () => {
    expect(normalizeHandle('bottom-t')).toBe('bottom')
  })

  it('maps bottom-2-t → bottom-2', () => {
    expect(normalizeHandle('bottom-2-t')).toBe('bottom-2')
  })

  it('maps bottom-3-t → bottom-3', () => {
    expect(normalizeHandle('bottom-3-t')).toBe('bottom-3')
  })

  it('maps bottom-4-t → bottom-4', () => {
    expect(normalizeHandle('bottom-4-t')).toBe('bottom-4')
  })

  it('maps any bottom-N-t handle to bottom-N', () => {
    expect(normalizeHandle('bottom-12-t')).toBe('bottom-12')
  })

  it('passes through non-stub handles unchanged', () => {
    expect(normalizeHandle('top')).toBe('top')
    expect(normalizeHandle('bottom')).toBe('bottom')
    expect(normalizeHandle('bottom-2')).toBe('bottom-2')
    expect(normalizeHandle('custom-handle')).toBe('custom-handle')
  })
})

describe('removedBottomHandleIds', () => {
  it('returns empty set when count does not decrease', () => {
    expect(removedBottomHandleIds(2, 2).size).toBe(0)
    expect(removedBottomHandleIds(1, 4).size).toBe(0)
  })

  it('4 → 1 removes bottom-2, bottom-3, bottom-4', () => {
    const removed = removedBottomHandleIds(4, 1)
    expect(removed).toEqual(new Set(['bottom-2', 'bottom-3', 'bottom-4']))
  })

  it('8 → 3 removes bottom-4 through bottom-8', () => {
    const removed = removedBottomHandleIds(8, 3)
    expect(removed).toEqual(new Set(['bottom-4', 'bottom-5', 'bottom-6', 'bottom-7', 'bottom-8']))
  })

  it('4 → 2 removes bottom-3, bottom-4', () => {
    const removed = removedBottomHandleIds(4, 2)
    expect(removed).toEqual(new Set(['bottom-3', 'bottom-4']))
  })

  it('3 → 2 removes only bottom-3', () => {
    const removed = removedBottomHandleIds(3, 2)
    expect(removed).toEqual(new Set(['bottom-3']))
  })

  it('never removes "bottom" (index 0)', () => {
    const removed = removedBottomHandleIds(4, 1)
    expect(removed.has('bottom')).toBe(false)
  })
})
