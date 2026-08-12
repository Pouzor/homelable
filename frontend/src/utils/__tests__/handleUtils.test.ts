import { describe, it, expect } from 'vitest'
import {
  MIN_BOTTOM_HANDLES,
  MAX_BOTTOM_HANDLES,
  MAX_HANDLES,
  MIN_HANDLES,
  sideHandleCount,
  bottomHandleId,
  bottomHandlePositions,
  clampBottomHandles,
  normalizeHandle,
  removedBottomHandleIds,
  handleId,
  handlePositions,
  clampHandles,
  removedHandleIds,
  sideDefault,
  handleCountField,
  isVerticalSide,
  SIDES,
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
    expect(MIN_BOTTOM_HANDLES).toBe(0)
  })

  it('supports at least 52 ports (issue #20 — Cisco 48+4 SFP)', () => {
    expect(MAX_BOTTOM_HANDLES).toBeGreaterThanOrEqual(52)
  })

  it('clamps above MAX to MAX', () => {
    expect(clampBottomHandles(65)).toBe(MAX_BOTTOM_HANDLES)
    expect(clampBottomHandles(9999)).toBe(MAX_BOTTOM_HANDLES)
  })

  it('returns the side default for non-finite or non-number', () => {
    expect(clampBottomHandles(NaN)).toBe(1)
    expect(clampBottomHandles(Infinity)).toBe(1)
    expect(clampBottomHandles('4' as unknown)).toBe(1)
    expect(clampBottomHandles(undefined)).toBe(1)
  })

  it('floors fractional values', () => {
    expect(clampBottomHandles(3.9)).toBe(3)
  })

  it('passes valid integers through', () => {
    expect(clampBottomHandles(1)).toBe(1)
    expect(clampBottomHandles(24)).toBe(24)
    expect(clampBottomHandles(48)).toBe(48)
    expect(clampBottomHandles(52)).toBe(52)
    expect(clampBottomHandles(64)).toBe(64)
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
    expect(bottomHandlePositions(0)).toEqual([])
    expect(bottomHandlePositions(-2)).toEqual([])
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

// ─── Side-generic API (issue #243) ──────────────────────────────────────────

describe('sideDefault', () => {
  it('top/bottom default to 1 (backward-compatible)', () => {
    expect(sideDefault('top')).toBe(1)
    expect(sideDefault('bottom')).toBe(1)
  })
  it('left/right default to 0 (opt-in, no visual change to old diagrams)', () => {
    expect(sideDefault('left')).toBe(0)
    expect(sideDefault('right')).toBe(0)
  })
})

describe('handleCountField', () => {
  it('maps each side to its NodeData field', () => {
    expect(handleCountField('top')).toBe('top_handles')
    expect(handleCountField('bottom')).toBe('bottom_handles')
    expect(handleCountField('left')).toBe('left_handles')
    expect(handleCountField('right')).toBe('right_handles')
  })
})

describe('handleId', () => {
  it('slot 0 is the bare side name for every side', () => {
    expect(handleId('top', 0)).toBe('top')
    expect(handleId('bottom', 0)).toBe('bottom')
    expect(handleId('left', 0)).toBe('left')
    expect(handleId('right', 0)).toBe('right')
  })
  it('slot N ≥ 1 follows side-N pattern (1-indexed shift)', () => {
    expect(handleId('top', 1)).toBe('top-2')
    expect(handleId('left', 2)).toBe('left-3')
    expect(handleId('right', 47)).toBe('right-48')
  })
  it('bottom matches the legacy alias', () => {
    for (let i = 0; i < 5; i++) expect(handleId('bottom', i)).toBe(bottomHandleId(i))
  })
})

describe('clampHandles', () => {
  it('min is 0 for every side, top/bottom included', () => {
    expect(clampHandles('top', 0)).toBe(0)
    expect(clampHandles('bottom', 0)).toBe(0)
    expect(clampHandles('top', -3)).toBe(0)
    expect(clampHandles('bottom', -3)).toBe(0)
    expect(clampHandles('left', -3)).toBe(0)
    expect(clampHandles('right', 0)).toBe(0)
  })
  it('max is 64 for every side', () => {
    expect(clampHandles('top', 9999)).toBe(MAX_HANDLES)
    expect(clampHandles('left', 65)).toBe(64)
  })
  it('non-finite / non-number falls back to the side default', () => {
    expect(clampHandles('left', NaN)).toBe(0)
    expect(clampHandles('top', undefined)).toBe(1)
    expect(clampHandles('bottom', NaN)).toBe(1)
    expect(clampHandles('right', '4' as unknown)).toBe(0)
  })
  it('floors fractional values', () => {
    expect(clampHandles('left', 3.9)).toBe(3)
  })
})

describe('handlePositions', () => {
  it('horizontal sides reuse the bottom distribution', () => {
    expect(handlePositions('top', 3)).toEqual([20, 50, 80])
    expect(handlePositions('bottom', 4)).toEqual([15, 38, 62, 85])
  })
  it('vertical sides use the same offsets (applied to the top axis)', () => {
    expect(handlePositions('left', 2)).toEqual([25, 75])
    expect(handlePositions('right', 1)).toEqual([50])
  })
  it('count 0 yields no handles (only reachable for L/R)', () => {
    expect(handlePositions('left', 0)).toEqual([])
    expect(handlePositions('right', 0)).toEqual([])
  })
  it('top/bottom accept 0 and render nothing', () => {
    expect(handlePositions('top', 0)).toEqual([])
    expect(handlePositions('bottom', 0)).toEqual([])
  })
})

describe('isVerticalSide', () => {
  it('left/right are vertical; top/bottom are not', () => {
    expect(isVerticalSide('left')).toBe(true)
    expect(isVerticalSide('right')).toBe(true)
    expect(isVerticalSide('top')).toBe(false)
    expect(isVerticalSide('bottom')).toBe(false)
  })
})

describe('normalizeHandle — all sides', () => {
  it('maps left-t / right-t and their -N variants to source ids', () => {
    expect(normalizeHandle('left-t')).toBe('left')
    expect(normalizeHandle('right-t')).toBe('right')
    expect(normalizeHandle('left-2-t')).toBe('left-2')
    expect(normalizeHandle('right-48-t')).toBe('right-48')
    expect(normalizeHandle('top-3-t')).toBe('top-3')
  })
  it('passes through source ids for every side', () => {
    expect(normalizeHandle('left')).toBe('left')
    expect(normalizeHandle('right-2')).toBe('right-2')
  })
})

describe('removedHandleIds — all sides', () => {
  it('left 3 → 0 removes left, left-2, left-3', () => {
    expect(removedHandleIds('left', 3, 0)).toEqual(new Set(['left', 'left-2', 'left-3']))
  })
  it('top 2 → 1 removes only top-2, keeps slot 0', () => {
    const removed = removedHandleIds('top', 2, 1)
    expect(removed).toEqual(new Set(['top-2']))
    expect(removed.has('top')).toBe(false)
  })
  it('bottom matches the legacy alias', () => {
    expect(removedHandleIds('bottom', 4, 1)).toEqual(removedBottomHandleIds(4, 1))
  })
})

describe('SIDES', () => {
  it('lists all four sides', () => {
    expect([...SIDES].sort()).toEqual(['bottom', 'left', 'right', 'top'])
  })
})

describe('zero connection points on top/bottom (issue: min was 1)', () => {
  it('MIN_HANDLES is 0', () => {
    expect(MIN_HANDLES).toBe(0)
  })

  it('sideHandleCount honours an explicit 0 on top and bottom', () => {
    const data = { label: 'n', top_handles: 0, bottom_handles: 0 } as never
    expect(sideHandleCount(data, 'top')).toBe(0)
    expect(sideHandleCount(data, 'bottom')).toBe(0)
  })

  it('still defaults top/bottom to 1 when the field is missing', () => {
    const data = { label: 'n' } as never
    expect(sideHandleCount(data, 'top')).toBe(1)
    expect(sideHandleCount(data, 'bottom')).toBe(1)
  })

  it('renders no handle position for a 0-count top/bottom side', () => {
    expect(handlePositions('top', 0)).toEqual([])
    expect(handlePositions('bottom', 0)).toEqual([])
  })

  it('removes every top handle when going 2 → 0', () => {
    expect(removedHandleIds('top', 2, 0)).toEqual(new Set(['top', 'top-2']))
  })
})
