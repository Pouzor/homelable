import { create } from 'zustand'

import { docsviewApi } from '@/api/client'
import type { Doc, DocRevision, DocumentSummary } from './types'

/**
 * The read-only documentation space served at `/docs?key=…`.
 *
 * Deliberately *not* a mode flag on `useDocsStore`. That store owns every write
 * the section has — save, create, move, delete, tags, the draft mirrored to
 * localStorage — and the authenticated axios instance they all travel on. A
 * flag there would leave every one of them one bug away from a page anybody
 * holding a URL can open. This store imports none of them, so it cannot reach
 * one by accident: what it does not have, it cannot call.
 *
 * The key travels in state because every request repeats it; it is the whole
 * credential and the page has nothing else.
 */

/**
 * How the documents that describe something elsewhere are pivoted.
 *
 * The app offers a dozen pivots — zone, subnet, rack, vendor, status — and each
 * of them reads the inventory, the canvas or the racks. This page is handed
 * none of those, on purpose: they are full of addresses and hardware, and the
 * key grants documents only. What is left is what a document carries itself.
 */
export type PublicGroupBy = 'tag' | 'flat'

export interface PublicDocsState {
  /** The key from the URL, replayed on every request. */
  key: string
  docs: DocumentSummary[]
  loaded: boolean
  loading: boolean
  /** What the server said, verbatim: disabled, or a bad key. */
  error: string | null

  openDoc: Doc | null
  openLoading: boolean

  historyOpen: boolean
  revisions: DocRevision[]
  revisionsLoading: boolean
  revisionPreview: { revision: DocRevision; body: string } | null

  filter: string
  groupBy: PublicGroupBy
  expanded: string[]

  load: (key: string) => Promise<void>
  open: (id: string) => Promise<void>
  toggleHistory: () => Promise<void>
  previewRevision: (revisionId: string) => Promise<void>
  closeRevisionPreview: () => void
  setFilter: (filter: string) => void
  setGroupBy: (groupBy: PublicGroupBy) => void
  toggleExpanded: (key: string) => void
}

function message(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export const usePublicDocsStore = create<PublicDocsState>()((set, get) => ({
  key: '',
  docs: [],
  loaded: false,
  loading: false,
  error: null,

  openDoc: null,
  openLoading: false,

  historyOpen: false,
  revisions: [],
  revisionsLoading: false,
  revisionPreview: null,

  filter: '',
  groupBy: 'flat',
  expanded: [],

  load: async (key) => {
    set({ key, loading: true, error: null })
    try {
      const { data } = await docsviewApi.tree(key)
      set({ docs: data, loaded: true, loading: false })
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        docs: [],
        error: message(error, 'Could not load the documentation'),
      })
    }
  },

  open: async (id) => {
    // A new document closes whatever was being read of the old one's history:
    // the rail and the preview belong to the document, not to the page.
    set({
      openLoading: true,
      historyOpen: false,
      revisions: [],
      revisionsLoading: false,
      revisionPreview: null,
    })
    try {
      const { data } = await docsviewApi.get(get().key, id)
      set({ openDoc: data, openLoading: false })
    } catch (error) {
      set({ openLoading: false, error: message(error, 'Could not open that document') })
    }
  },

  toggleHistory: async () => {
    const { historyOpen, openDoc, key } = get()
    if (historyOpen) {
      set({ historyOpen: false, revisionPreview: null })
      return
    }
    set({ historyOpen: true })
    if (!openDoc) return
    set({ revisionsLoading: true })
    try {
      const { data } = await docsviewApi.revisions(key, openDoc.id)
      set({ revisions: data, revisionsLoading: false })
    } catch {
      // An unreadable history is not worth taking the page down for: the
      // document itself is on screen and still readable.
      set({ revisions: [], revisionsLoading: false })
    }
  },

  previewRevision: async (revisionId) => {
    const revision = get().revisions.find((r) => r.id === revisionId)
    if (!revision) return
    try {
      const { data } = await docsviewApi.revision(get().key, revisionId)
      set({ revisionPreview: { revision, body: data.body } })
    } catch {
      set({ revisionPreview: null })
    }
  },

  closeRevisionPreview: () => set({ revisionPreview: null }),

  setFilter: (filter) => set({ filter }),
  setGroupBy: (groupBy) => set({ groupBy }),
  toggleExpanded: (key) => {
    const expanded = get().expanded
    set({
      expanded: expanded.includes(key) ? expanded.filter((k) => k !== key) : [...expanded, key],
    })
  },
}))
