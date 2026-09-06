import { useCallback, useRef, type RefObject } from 'react'

/**
 * Undo for the document editor.
 *
 * The textarea is controlled and half its edits are programmatic — the toolbar
 * and the slash menu rewrite the body around the caret — and a browser drops
 * its own undo stack the moment a value is set that way. So the editor keeps
 * its own, which is the only one that can cover a `/device` insertion and a
 * typed word alike.
 */

export interface EditSnapshot {
  body: string
  selectionStart: number
  selectionEnd: number
}

/** Typing folds into the entry before it while it keeps coming this fast. */
export const COALESCE_MS = 500

/** Entries kept. Deep enough to cover a session, bounded so it cannot grow. */
export const HISTORY_LIMIT = 200

/** Typing coalesces; anything else is a step of its own. */
export type EditKind = 'type' | 'edit'

interface Options {
  body: string
  onChange: (body: string) => void
  textarea: RefObject<HTMLTextAreaElement | null>
}

export interface DocHistory {
  /** Called *before* a change, with what kind of change is about to happen. */
  record: (kind: EditKind) => void
  /** Both return false when there was nothing to move to. */
  undo: () => boolean
  redo: () => boolean
}

export function useDocHistory({ body, onChange, textarea }: Options): DocHistory {
  const past = useRef<EditSnapshot[]>([])
  const future = useRef<EditSnapshot[]>([])
  const lastAt = useRef(0)
  const lastKind = useRef<EditKind | null>(null)

  // The body comes from the props rather than a ref, so every callback below
  // is rebuilt when it changes — the handlers using them are rebuilt per render
  // anyway, and a ref read during render is not allowed.
  const snapshot = useCallback((): EditSnapshot => {
    const el = textarea.current
    return {
      body,
      selectionStart: el?.selectionStart ?? body.length,
      selectionEnd: el?.selectionEnd ?? body.length,
    }
  }, [body, textarea])

  const apply = useCallback(
    (target: EditSnapshot) => {
      onChange(target.body)
      // After the value lands, or the caret is placed in the old text.
      requestAnimationFrame(() => {
        const el = textarea.current
        if (!el) return
        el.focus()
        el.setSelectionRange(target.selectionStart, target.selectionEnd)
      })
    },
    [onChange, textarea],
  )

  const record = useCallback(
    (kind: EditKind) => {
      const now = Date.now()
      const coalesce =
        kind === 'type' && lastKind.current === 'type' && now - lastAt.current < COALESCE_MS
      lastAt.current = now
      lastKind.current = kind
      // Editing after an undo is a new branch; there is nothing to redo onto.
      future.current = []
      if (coalesce) return
      past.current = [...past.current, snapshot()].slice(-HISTORY_LIMIT)
    },
    [snapshot],
  )

  const undo = useCallback(() => {
    const previous = past.current.pop()
    if (!previous) return false
    future.current.push(snapshot())
    // The next keystroke starts a fresh burst rather than folding into the
    // entry that was just restored.
    lastKind.current = null
    apply(previous)
    return true
  }, [apply, snapshot])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return false
    past.current.push(snapshot())
    lastKind.current = null
    apply(next)
    return true
  }, [apply, snapshot])

  return { record, undo, redo }
}
