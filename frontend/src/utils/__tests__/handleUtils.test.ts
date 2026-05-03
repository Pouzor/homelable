import { describe, it, expect } from 'vitest'
import {
  MIN_BOTTOM_HANDLES,
  MAX_BOTTOM_HANDLES,
  bottomHandleId,
  bottomHandlePositions,
  clampBottomHandles,
  normalizeHandle,
  removedBottomHandleIds,
} from '../handleUtils'

describe('bottomHandleId', () => {
  it('first id is always "bottom" for backward compatibility', () => {
    expect(bottomHandleId(0)).toBe('bottom')
  })

  it('subsequent ids follow bottom-N pattern (1-indexed shift)', () => {
    expect(bottomHandleId(1)).toBe('bottom-2')
    expect(bottomHandleId(2)).toBe('bottom-3')
    expect(bottomHandleId(3)).toBe('bottom-4')
    expect(bottomHandleId(11)).toBe('bottom-12')
    expect(bottomHandleId(47)).toBe('bottom-48')
  })
})

describe('clampBottomHandles', () => {
  it('clamps below MIN to MIN', () => {
    expect(clampBottomHandles(0)).toBe(MIN_BOTTOM_HANDLES)
    expect(clampBottomHandles(-5)).toBe(MIN_BOTTOM_HANDLES)
  })

  it('clamps above MAX to MAX', () => {
    expect(clampBottomHandles(49)).toBe(MAX_BOTTOM_HANDLES)
    expect(clampBottomHandles(9999)).toBe(MAX_BOTTOM_HANDLES)
  })

  it('returns MIN for non-finite or non-number', () => {
    expect(clampBottomHandles(NaN)).toBe(MIN_BOTTOM_HANDLES)
    expect(clampBottomHandles(Infinity)).toBe(MIN_BOTTOM_HANDLES)
    expect(clampBottomHandles('4' as unknown)).toBe(MIN_BOTTOM_HANDLES)
    expect(clampBottomHandles(undefined)).toBe(MIN_BOTTOM_HANDLES)
  })

  it('floors fractional values', () => {
    expect(clampBottomHandles(3.9)).toBe(3)
  })

  it('passes valid integers through', () => {
    expect(clampBottomHandles(1)).toBe(1)
    expect(clampBottomHandles(24)).toBe(24)
    expect(clampBottomHandles(48)).toBe(48)
  })
})

describe('bottomHandlePositions — backward-compat lock for 1..4', () => {
  // These exact arrays are the pre-multi-handle hand-tuned positions.
  // Existing user canvases depend on them — do NOT change.
  it('1 handle is centered at 50%', () => {
    expect(bottomHandlePositions(1)).toEqual([50])
  })

  it('2 handles use exact prior positions', () => {
    expect(bottomHandlePositions(2)).toEqual([25, 75])
  })

  it('3 handles use exact prior positions', () => {
    expect(bottomHandlePositions(3)).toEqual([20, 50, 80])
  })

  it('4 handles use exact prior positions', () => {
    expect(bottomHandlePositions(4)).toEqual([15, 38, 62, 85])
  })
})

describe('bottomHandlePositions — uniform spacing for ≥5', () => {
  it('returns count entries', () => {
    expect(bottomHandlePositions(5)).toHaveLength(5)
    expect(bottomHandlePositions(12)).toHaveLength(12)
    expect(bottomHandlePositions(48)).toHaveLength(48)
  })

  it('all positions strictly between 0 and 100', () => {
    const pos = bottomHandlePositions(48)
    pos.forEach((p) => {
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThan(100)
    })
  })

  it('positions are strictly increasing and uniform', () => {
    const pos = bottomHandlePositions(12)
    for (let i = 1; i < pos.length; i++) {
      expect(pos[i]).toBeGreaterThan(pos[i - 1])
    }
    const step = 100 / 13
    expect(pos[0]).toBeCloseTo(step, 5)
    expect(pos[11]).toBeCloseTo(step * 12, 5)
  })

  it('clamps out-of-range counts before computing', () => {
    expect(bottomHandlePositions(0)).toEqual([50])
    expect(bottomHandlePositions(99)).toHaveLength(MAX_BOTTOM_HANDLES)
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

  it('maps bottom-N-t → bottom-N for any N', () => {
    expect(normalizeHandle('bottom-2-t')).toBe('bottom-2')
    expect(normalizeHandle('bottom-12-t')).toBe('bottom-12')
    expect(normalizeHandle('bottom-48-t')).toBe('bottom-48')
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
    expect(removedBottomHandleIds(4, 1)).toEqual(new Set(['bottom-2', 'bottom-3', 'bottom-4']))
  })

  it('4 → 2 removes bottom-3, bottom-4', () => {
    expect(removedBottomHandleIds(4, 2)).toEqual(new Set(['bottom-3', 'bottom-4']))
  })

  it('3 → 2 removes only bottom-3', () => {
    expect(removedBottomHandleIds(3, 2)).toEqual(new Set(['bottom-3']))
  })

  it('never removes "bottom" (index 0)', () => {
    expect(removedBottomHandleIds(4, 1).has('bottom')).toBe(false)
  })

  // Regression: scaling the cap from 4 → 48 must not break the remap loop.
  it('scales to high counts (48 → 1 removes 47 ids)', () => {
    const removed = removedBottomHandleIds(48, 1)
    expect(removed.size).toBe(47)
    expect(removed.has('bottom-2')).toBe(true)
    expect(removed.has('bottom-48')).toBe(true)
    expect(removed.has('bottom')).toBe(false)
  })

  it('10 → 2 leaves bottom + bottom-2, removes bottom-3..bottom-10', () => {
    const removed = removedBottomHandleIds(10, 2)
    expect(removed.size).toBe(8)
    expect(removed.has('bottom-2')).toBe(false)
    expect(removed.has('bottom-3')).toBe(true)
    expect(removed.has('bottom-10')).toBe(true)
  })
})
