import { create } from 'zustand'

import { documentsApi } from '@/api/client'
import { isOverdue } from './frontmatter'
import { isDescendant } from './tree'
import type {
  Doc,
  DocCoverage,
  DocRevision,
  DocSearchResult,
  DocumentSummary,
  GroupBy,
} from './types'

/**
 * Documentation state.
 *
 * Two rules shape this store. Saving is explicit — a body is never written to
 * the server on a timer, matching the canvas — and an unsaved body is mirrored
 * to localStorage so closing a tab or switching documents cannot lose an edit.
 * The draft is cleared the moment the save lands.
 */

// The tree owns the parentage walk; the store re-exports it because callers of
// `remove` and `move` reach for it from here.
export { isDescendant }

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const UI_KEY = 'homelable_docs_ui'
const DRAFT_PREFIX = 'homelable_docdraft:'

interface DraftRecord {
  body: string
  savedAt: number
  /** The document's `updated_at` when the draft was taken, to detect staleness. */
  base: string
}

export function draftKey(docId: string): string {
  return `${DRAFT_PREFIX}${docId}`
}

export function readDraft(docId: string): DraftRecord | null {
  try {
    const raw = localStorage.getItem(draftKey(docId))
    return raw ? (JSON.parse(raw) as DraftRecord) : null
  } catch {
    return null
  }
}

export function writeDraft(docId: string, record: DraftRecord): void {
  try {
    localStorage.setItem(draftKey(docId), JSON.stringify(record))
  } catch {
    // A full or blocked storage must never break editing.
  }
}

export function clearDraft(docId: string): void {
  try {
    localStorage.removeItem(draftKey(docId))
  } catch {
    // Ignored for the same reason.
  }
}

interface UiPrefs {
  groupBy: GroupBy
  expanded: string[]
  lastDocId: string | null
  treeWidth: number
}

const DEFAULT_UI: UiPrefs = { groupBy: 'zone', expanded: [], lastDocId: null, treeWidth: 260 }

function readUi(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_KEY)
    return raw ? { ...DEFAULT_UI, ...(JSON.parse(raw) as Partial<UiPrefs>) } : DEFAULT_UI
  } catch {
    return DEFAULT_UI
  }
}

function writeUi(prefs: UiPrefs): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are a convenience; losing them is not an error.
  }
}

export interface DocsState {
  docs: DocumentSummary[]
  loaded: boolean
  loading: boolean
  loadError: string | null

  openDoc: Doc | null
  openLoading: boolean

  /** The body being edited. Null when not in edit mode. */
  draft: string | null
  dirty: boolean
  saving: boolean
  /** A recovered draft awaiting the user's yes or no. */
  pendingDraft: string | null

  revisions: DocRevision[]
  coverage: DocCoverage | null
  search: DocSearchResult | null
  searching: boolean

  groupBy: GroupBy
  expanded: string[]
  treeWidth: number
  filter: string

  loadDocs: () => Promise<void>
  open: (id: string) => Promise<void>
  close: () => void

  startEdit: () => void
  setDraft: (body: string) => void
  cancelEdit: () => void
  save: () => Promise<boolean>
  acceptPendingDraft: () => void
  discardPendingDraft: () => void

  create: (input: {
    title: string
    kind?: string
    parentId?: string | null
    deviceId?: string | null
    nodeId?: string | null
    templateId?: string | null
  }) => Promise<Doc | null>
  rename: (id: string, title: string) => Promise<void>
  move: (id: string, parentId: string | null) => Promise<void>
  toggleStar: (id: string) => Promise<void>
  markReviewed: (id: string) => Promise<void>
  resyncFacts: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>

  loadRevisions: (id: string) => Promise<void>
  restore: (id: string, revisionId: string) => Promise<void>
  regenerate: (id: string) => Promise<boolean>

  loadCoverage: () => Promise<void>
  scaffold: (input: { deviceIds?: string[]; onlyWithNotes?: boolean }) => Promise<number>
  runSearch: (query: string) => Promise<void>
  clearSearch: () => void

  setGroupBy: (groupBy: GroupBy) => void
  toggleExpanded: (key: string) => void
  setExpanded: (keys: string[]) => void
  setTreeWidth: (width: number) => void
  setFilter: (filter: string) => void
}

function message(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

const initialUi = readUi()

export const useDocsStore = create<DocsState>()((set, get) => ({
  docs: [],
  loaded: false,
  loading: false,
  loadError: null,

  openDoc: null,
  openLoading: false,

  draft: null,
  dirty: false,
  saving: false,
  pendingDraft: null,

  revisions: [],
  coverage: null,
  search: null,
  searching: false,

  groupBy: initialUi.groupBy,
  expanded: initialUi.expanded,
  treeWidth: initialUi.treeWidth,
  filter: '',

  loadDocs: async () => {
    if (STANDALONE) {
      // Documents need the backend. Standalone shows the section empty with an
      // explanation rather than pretending to have loaded nothing.
      set({ loaded: true, docs: [], loadError: null })
      return
    }
    set({ loading: true, loadError: null })
    try {
      const { data } = await documentsApi.list()
      set({ docs: data, loaded: true, loading: false })
    } catch (error) {
      set({ loading: false, loaded: true, loadError: message(error, 'Could not load documents') })
    }
  },

  open: async (id) => {
    set({ openLoading: true, draft: null, dirty: false, pendingDraft: null, revisions: [] })
    try {
      const { data } = await documentsApi.get(id)
      // A draft newer than the stored document is unsaved work from a previous
      // session; offer it rather than silently applying or dropping it.
      const draft = readDraft(id)
      const stale = draft !== null && draft.base !== data.updated_at
      set({
        openDoc: data,
        openLoading: false,
        pendingDraft: draft && !stale && draft.body !== data.body ? draft.body : null,
      })
      if (draft && stale) clearDraft(id)
      writeUi({ ...readUi(), lastDocId: id })
    } catch (error) {
      set({ openLoading: false, loadError: message(error, 'Could not open that document') })
    }
  },

  close: () => set({ openDoc: null, draft: null, dirty: false, pendingDraft: null, revisions: [] }),

  startEdit: () => {
    const doc = get().openDoc
    if (doc) set({ draft: doc.body, dirty: false })
  },

  setDraft: (body) => {
    const doc = get().openDoc
    set({ draft: body, dirty: doc ? body !== doc.body : false })
    if (doc) writeDraft(doc.id, { body, savedAt: Date.now(), base: doc.updated_at })
  },

  cancelEdit: () => {
    const doc = get().openDoc
    if (doc) clearDraft(doc.id)
    set({ draft: null, dirty: false })
  },

  save: async () => {
    const { openDoc, draft } = get()
    if (!openDoc || draft === null) return false
    set({ saving: true })
    try {
      const { data } = await documentsApi.update(openDoc.id, { body: draft })
      clearDraft(openDoc.id)
      set((state) => ({
        openDoc: data,
        draft: data.body,
        dirty: false,
        saving: false,
        docs: state.docs.map((d) => (d.id === data.id ? { ...d, ...data } : d)),
      }))
      return true
    } catch (error) {
      set({ saving: false, loadError: message(error, 'Could not save') })
      return false
    }
  },

  acceptPendingDraft: () => {
    const { pendingDraft, openDoc } = get()
    if (pendingDraft === null || !openDoc) return
    set({ draft: pendingDraft, dirty: pendingDraft !== openDoc.body, pendingDraft: null })
  },

  discardPendingDraft: () => {
    const doc = get().openDoc
    if (doc) clearDraft(doc.id)
    set({ pendingDraft: null })
  },

  create: async (input) => {
    try {
      const { data } = await documentsApi.create({
        title: input.title,
        kind: input.kind,
        parent_id: input.parentId ?? null,
        device_id: input.deviceId ?? null,
        node_id: input.nodeId ?? null,
        template_id: input.templateId ?? null,
      })
      set((state) => ({ docs: [...state.docs, data], openDoc: data }))
      return data
    } catch (error) {
      set({ loadError: message(error, 'Could not create that document') })
      return null
    }
  },

  rename: async (id, title) => {
    const { data } = await documentsApi.update(id, { title })
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
      openDoc: state.openDoc?.id === id ? data : state.openDoc,
    }))
  },

  move: async (id, parentId) => {
    const { data } = await documentsApi.update(id, { parent_id: parentId })
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
      openDoc: state.openDoc?.id === id ? { ...state.openDoc, ...data } : state.openDoc,
    }))
  },

  toggleStar: async (id) => {
    const current = get().docs.find((d) => d.id === id)
    const { data } = await documentsApi.update(id, { starred: !current?.starred })
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
      openDoc: state.openDoc?.id === id ? data : state.openDoc,
    }))
  },

  markReviewed: async (id) => {
    const { data } = await documentsApi.update(id, { reviewed: true })
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
      openDoc: state.openDoc?.id === id ? data : state.openDoc,
    }))
  },

  resyncFacts: async (id) => {
    const { data } = await documentsApi.update(id, { resync_facts: true })
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
      openDoc: state.openDoc?.id === id ? data : state.openDoc,
    }))
  },

  remove: async (id) => {
    await documentsApi.delete(id)
    clearDraft(id)
    set((state) => ({
      // The server takes a folder's subtree with it; drop the descendants here
      // too rather than reloading the whole list.
      docs: state.docs.filter((d) => d.id !== id && !isDescendant(state.docs, d, id)),
      openDoc: state.openDoc?.id === id ? null : state.openDoc,
      draft: state.openDoc?.id === id ? null : state.draft,
    }))
  },

  loadRevisions: async (id) => {
    const { data } = await documentsApi.revisions(id)
    set({ revisions: data })
  },

  restore: async (id, revisionId) => {
    const { data } = await documentsApi.restore(id, revisionId)
    clearDraft(id)
    set((state) => ({
      openDoc: data,
      draft: state.draft === null ? null : data.body,
      dirty: false,
      docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
    }))
    await get().loadRevisions(id)
  },

  regenerate: async (id) => {
    try {
      const { data } = await documentsApi.regenerate(id)
      // The body the user was editing no longer exists; drop the draft with it
      // rather than letting a stale edit be saved back over the new one.
      clearDraft(id)
      set((state) => ({
        openDoc: state.openDoc?.id === id ? data : state.openDoc,
        draft: state.openDoc?.id === id ? null : state.draft,
        dirty: state.openDoc?.id === id ? false : state.dirty,
        pendingDraft: state.openDoc?.id === id ? null : state.pendingDraft,
        docs: state.docs.map((d) => (d.id === id ? { ...d, ...data } : d)),
      }))
      if (get().openDoc?.id === id && get().revisions.length > 0) await get().loadRevisions(id)
      return true
    } catch (error) {
      set({ loadError: message(error, 'Could not regenerate that document') })
      return false
    }
  },

  loadCoverage: async () => {
    if (STANDALONE) return
    try {
      const { data } = await documentsApi.coverage()
      set({ coverage: data })
    } catch {
      // Coverage is informational — a failure must not block the section.
    }
  },

  scaffold: async ({ deviceIds, onlyWithNotes }) => {
    const { data } = await documentsApi.scaffold({
      device_ids: deviceIds,
      only_with_notes: onlyWithNotes,
    })
    set((state) => ({ docs: [...state.docs, ...data.created] }))
    await get().loadCoverage()
    return data.created.length
  },

  runSearch: async (query) => {
    if (!query.trim()) {
      set({ search: null, searching: false })
      return
    }
    set({ searching: true })
    try {
      const { data } = await documentsApi.search(query)
      set({ search: data, searching: false })
    } catch (error) {
      set({ searching: false, loadError: message(error, 'Search failed') })
    }
  },

  clearSearch: () => set({ search: null }),

  setGroupBy: (groupBy) => {
    set({ groupBy })
    writeUi({ ...readUi(), groupBy })
  },

  toggleExpanded: (key) => {
    const expanded = get().expanded.includes(key)
      ? get().expanded.filter((k) => k !== key)
      : [...get().expanded, key]
    set({ expanded })
    writeUi({ ...readUi(), expanded })
  },

  setExpanded: (keys) => {
    set({ expanded: keys })
    writeUi({ ...readUi(), expanded: keys })
  },

  setTreeWidth: (treeWidth) => {
    set({ treeWidth })
    writeUi({ ...readUi(), treeWidth })
  },

  setFilter: (filter) => set({ filter }),
}))

/** Document ids the server flagged as drifted. Used for the tree badge. */
export function driftedIds(docs: DocumentSummary[]): Set<string> {
  return new Set(docs.filter((doc) => doc.drifted).map((doc) => doc.id))
}

/** Document ids whose `review_every` has elapsed. Used for the tree badge. */
export function overdueIds(docs: DocumentSummary[], now = Date.now()): Set<string> {
  return new Set(
    docs
      .filter((doc) => isOverdue(doc.frontmatter ?? {}, doc.reviewed_at, doc.created_at, now))
      .map((doc) => doc.id),
  )
}
