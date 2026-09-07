import { useEffect, useRef, useState } from 'react'
import { getDocIdFromUrl, isDocsViewInUrl, setDocsViewInUrl } from '@/utils/designUrl'
import type { AppView } from '@/stores/uiStore'

interface DocsUrlSyncOptions {
  /** The section the app is showing. */
  view: AppView
  /** The open document's id, or null when the section shows no document. */
  openDocId: string | null
  /**
   * True once the app may talk to the backend — the session is bootstrapped.
   * Restoring earlier would fetch the document without a session and land on
   * an error the user never sees, because the login page is still up.
   */
  ready: boolean
  /** False in standalone: documents need the backend, so the URL means nothing. */
  enabled: boolean
  /**
   * Honour the URL: switch to Documentation and open `docId` when there is one.
   * Awaited — the URL stays untouched until it settles.
   */
  onRestore: (docId: string | null) => void | Promise<void>
}

/**
 * Two-way sync between the Documentation section and `?view=docs&doc=<id>`,
 * so a document survives a refresh and its URL can be shared.
 *
 * The order matters, and used not to: reflecting the view into the address bar
 * and reading the address bar were two effects, and the writer ran first. On
 * boot it wrote the *default* view — canvas, no document — over the very params
 * the reader was about to consume, so a refresh always came back to the canvas.
 * Here the URL's request is captured at the first render and the writer stays
 * quiet until that request has been honoured (or there was none to honour).
 */
export function useDocsUrlSync({ view, openDocId, ready, enabled, onRestore }: DocsUrlSyncOptions): void {
  // Read once, at the first render, before any effect can rewrite the address
  // bar — a lazy initializer, not a ref, which must not be read during render.
  const [boot] = useState(() => {
    const docs = enabled && isDocsViewInUrl()
    return { docs, docId: docs ? getDocIdFromUrl() : null }
  })

  // Nothing to restore means the writer owns the URL from the first render.
  const [restored, setRestored] = useState(!boot.docs)

  // Kept in a ref so a caller that passes a fresh closure each render doesn't
  // re-run the restore.
  const restore = useRef(onRestore)
  useEffect(() => {
    restore.current = onRestore
  })

  useEffect(() => {
    if (restored || !ready) return
    let cancelled = false
    // Settled either way — a document that no longer exists must not keep the
    // URL frozen, or the section could never be left. `then(f, f)` rather than
    // `finally`, which would rethrow the rejection as an unhandled one.
    const settle = () => {
      if (!cancelled) setRestored(true)
    }
    void Promise.resolve(restore.current(boot.docId)).then(settle, settle)
    return () => {
      cancelled = true
    }
  }, [restored, ready, boot])

  useEffect(() => {
    if (!restored) return
    setDocsViewInUrl(view === 'documentation', openDocId)
  }, [restored, view, openDocId])
}
