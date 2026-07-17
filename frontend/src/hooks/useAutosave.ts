import { useEffect, useRef } from 'react'

interface UseAutosaveOptions {
  /** Whether autosave is enabled (user opt-in). */
  enabled: boolean
  /** Inactivity delay in seconds before firing a save. */
  delaySeconds: number
  /** True when the canvas has edits not yet persisted. */
  hasUnsavedChanges: boolean
  /**
   * The design the in-memory canvas actually belongs to — its *provenance*, set
   * when a canvas is loaded, NOT the currently-selected design. These differ
   * during a design switch: the selection flips synchronously while the new
   * canvas loads asynchronously, so for a brief window the on-screen nodes still
   * belong to the previous design. Gating on provenance (not selection) is what
   * prevents saving one design's canvas under another design's id.
   */
  designId: string | null
  /**
   * Values that represent canvas edits (e.g. nodes, edges). Any change to one
   * of these resets the debounce timer, so the save only fires after a quiet
   * period. Its length MUST stay constant across renders (React requires a
   * stable dependency-array size) — pass a fixed-shape array like [nodes, edges].
   */
  changeSignals: readonly unknown[]
  /**
   * Reads the *live* canvas provenance at fire time. If it no longer matches the
   * id pinned when the timer was armed, a different canvas has since loaded, so
   * the save is skipped rather than written under the wrong (now-stale) id.
   */
  getLiveDesignId: () => string | null
  /** Persist the canvas under the given design id. */
  onSave: (designId: string) => void
}

/**
 * Debounced canvas autosave. Fires `onSave(designId)` after `delaySeconds` of
 * inactivity when enabled and there are unsaved changes. Opt-in only — the
 * caller decides whether `enabled` is set (see ADR: autosave defaults to off).
 */
export function useAutosave({
  enabled,
  delaySeconds,
  hasUnsavedChanges,
  designId,
  changeSignals,
  getLiveDesignId,
  onSave,
}: UseAutosaveOptions): void {
  // Keep the latest callbacks in refs so the timer always calls the current
  // versions without re-arming (which would reset the debounce) on every render.
  const onSaveRef = useRef(onSave)
  const getLiveDesignIdRef = useRef(getLiveDesignId)
  useEffect(() => {
    onSaveRef.current = onSave
    getLiveDesignIdRef.current = getLiveDesignId
  })

  useEffect(() => {
    if (!enabled || !hasUnsavedChanges || !designId) return
    const pinnedDesignId = designId
    const t = setTimeout(() => {
      // Skip if a different canvas has loaded while the timer was pending.
      if (getLiveDesignIdRef.current() !== pinnedDesignId) return
      onSaveRef.current(pinnedDesignId)
    }, delaySeconds * 1000)
    return () => clearTimeout(t)
    // changeSignals is spread so any canvas edit resets the debounce; its length
    // must stay constant (documented on the option).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, delaySeconds, hasUnsavedChanges, designId, ...changeSignals])
}
