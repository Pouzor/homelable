import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutosave } from '../useAutosave'

interface Args {
  enabled?: boolean
  delaySeconds?: number
  hasUnsavedChanges?: boolean
  designId?: string | null
  changeSignals?: unknown[]
  getLiveDesignId?: () => string | null
  onSave?: (designId: string) => void
}

function args(over: Args = {}) {
  const designId = 'designId' in over ? (over.designId ?? null) : 'design-a'
  return {
    enabled: over.enabled ?? true,
    delaySeconds: over.delaySeconds ?? 5,
    hasUnsavedChanges: over.hasUnsavedChanges ?? true,
    designId,
    changeSignals: over.changeSignals ?? [[], []],
    getLiveDesignId: over.getLiveDesignId ?? (() => designId),
    onSave: over.onSave ?? vi.fn(),
  }
}

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('saves after the inactivity delay when enabled with unsaved changes', () => {
    const onSave = vi.fn()
    renderHook(() => useAutosave(args({ onSave, delaySeconds: 5 })))
    expect(onSave).not.toHaveBeenCalled()
    vi.advanceTimersByTime(4999)
    expect(onSave).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('design-a')
  })

  it('does nothing when disabled', () => {
    const onSave = vi.fn()
    renderHook(() => useAutosave(args({ onSave, enabled: false })))
    vi.advanceTimersByTime(60_000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does nothing when there are no unsaved changes', () => {
    const onSave = vi.fn()
    renderHook(() => useAutosave(args({ onSave, hasUnsavedChanges: false })))
    vi.advanceTimersByTime(60_000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does nothing when the canvas has no known provenance', () => {
    const onSave = vi.fn()
    renderHook(() => useAutosave(args({ onSave, designId: null })))
    vi.advanceTimersByTime(60_000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('debounces: a change before the delay resets the timer', () => {
    const onSave = vi.fn()
    const { rerender } = renderHook((p: Args) => useAutosave(args(p)), {
      initialProps: { onSave, changeSignals: [1] },
    })
    vi.advanceTimersByTime(4000)
    rerender({ onSave, changeSignals: [2] }) // edit resets debounce
    vi.advanceTimersByTime(4000)
    expect(onSave).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('skips the save if a different canvas loaded while the timer was pending', () => {
    const onSave = vi.fn()
    // Pinned provenance at arm time = 'design-a', but a switch loaded 'design-b'
    // before the timer fired — the on-screen canvas is no longer design-a's.
    renderHook(() =>
      useAutosave(args({ onSave, designId: 'design-a', getLiveDesignId: () => 'design-b' })),
    )
    vi.advanceTimersByTime(5000)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves under the pinned provenance id when it still matches at fire time', () => {
    const onSave = vi.fn()
    renderHook(() =>
      useAutosave(args({ onSave, designId: 'design-a', getLiveDesignId: () => 'design-a' })),
    )
    vi.advanceTimersByTime(5000)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('design-a')
  })
})
