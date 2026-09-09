import { create } from 'zustand'

import { documentsApi } from '@/api/client'
import { isOverdue, withTags } from './frontmatter'
import { isDescendant } from './tree'
import type {
  Doc,
  DocBacklink,
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
  revisionsLoading: boolean
  /** A revision being read, alongside the current body. Null when not reading one. */
  revisionPreview: { revision: DocRevision; body: string } | null

  /** The documents linking to the open one. Inverted server-side. */
  backlinks: DocBacklink[]
  backlinksLoading: boolean

  coverage: DocCoverage | null
  search: DocSearchResult | null
  searching: boolean

  groupBy: GroupBy
  expanded: string[]
  treeWidth: number
  filter: string

  loadDocs: () => Promise<void>
  open: (id: string) => Promise<void>
  /** Open the document describing a device, writing one first if it has none. */
  openForDevice: (deviceId: string, fallbackTitle?: string) => Promise<boolean>
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
  /** Rewrite the `tags:` list in the open document's frontmatter. */
  setTags: (tags: string[]) => Promise<boolean>
  toggleStar: (id: string) => Promise<void>
  markReviewed: (id: string) => Promise<void>
  resyncFacts: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>

  loadRevisions: (id: string) => Promise<void>
  previewRevision: (revisionId: string) => Promise<void>
  closeRevisionPreview: () => void
  restore: (id: string, revisionId: string) => Promise<void>
  regenerate: (id: string) => Promise<boolean>

  loadBacklinks: (id: string) => Promise<void>
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
  revisionsLoading: false,
  revisionPreview: null,

  backlinks: [],
  backlinksLoading: false,

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
    set({
      openLoading: true,
      draft: null,
      dirty: false,
      pendingDraft: null,
      revisions: [],
      revisionsLoading: false,
      revisionPreview: null,
      backlinks: [],
    })
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
      // Not awaited: the document renders now, the "Linked from" block fills in.
      void get().loadBacklinks(id)
    } catch (error) {
      set({ openLoading: false, loadError: message(error, 'Could not open that document') })
    }
  },

  // The entry point from outside the section: the canvas knows a device id and
  // nothing about documents. The list may never have been fetched — this is
  // reachable without ever opening Documentation — so load it first, and treat
  // a device with no document the way the tree does, by writing one from its
  // facts rather than showing an empty section.
  openForDevice: async (deviceId, fallbackTitle) => {
    if (STANDALONE) return false
    if (!get().loaded) await get().loadDocs()
    const existing = get().docs.find((doc) => doc.device_id === deviceId)
    if (existing) {
      await get().open(existing.id)
      return true
    }
    const created = await get().create({
      title: fallbackTitle?.trim() || 'Untitled device',
      kind: 'device',
      deviceId,
    })
    if (!created) return false
    await get().open(created.id)
    return true
  },

  close: () =>
    set({
      openDoc: null,
      draft: null,
      dirty: false,
      pendingDraft: null,
      revisions: [],
      revisionsLoading: false,
      revisionPreview: null,
      backlinks: [],
    }),

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

  // Tags are frontmatter, and the body is what owns them — the `tags` column is
  // a cache the server refills from it. So this rewrites the block and saves the
  // body, rather than patching a field the next body save would overwrite. It
  // writes straight through, like starring: a chip the user clicked off is not
  // a draft of the document.
  setTags: async (tags) => {
    const { openDoc } = get()
    if (!openDoc) return false
    const draft = readDraft(openDoc.id)
    const baseBody = (draft && draft.base === openDoc.updated_at) ? draft.body : openDoc.body
    const body = withTags(baseBody, tags)
    try {
      const { data } = await documentsApi.update(openDoc.id, { body })
      set((state) => ({
        openDoc: data,
        docs: state.docs.map((d) => (d.id === data.id ? { ...d, ...data } : d)),
      }))
      return true
    } catch (error) {
      set({ loadError: message(error, 'Could not save the tags') })
      return false
    }
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
    set({ revisionsLoading: true })
    try {
      const { data } = await documentsApi.revisions(id)
      if (get().openDoc?.id !== id) return
      set({ revisions: data, revisionsLoading: false })
    } catch (error) {
      if (get().openDoc?.id !== id) return
      set({ revisionsLoading: false, loadError: message(error, 'Could not load the history') })
    }
  },

  // A revision's body is fetched on demand rather than with the list: the list
  // is what the history panel shows, and fifty bodies to render one of them is
  // the whole reason `RevisionSummary` carries a size instead of the text.
  previewRevision: async (revisionId) => {
    const revision = get().revisions.find((r) => r.id === revisionId)
    if (!revision) return
    try {
      const { data } = await documentsApi.revision(revisionId)
      set({ revisionPreview: { revision, body: data.body } })
    } catch (error) {
      set({ loadError: message(error, 'Could not read that version') })
    }
  },

  closeRevisionPreview: () => set({ revisionPreview: null }),

  restore: async (id, revisionId) => {
    const { data } = await documentsApi.restore(id, revisionId)
    clearDraft(id)
    set((state) => ({
      openDoc: data,
      draft: state.draft === null ? null : data.body,
      dirty: false,
      // The restored body is now the current one; there is nothing left to
      // compare it against, so the preview closes rather than showing itself.
      revisionPreview: null,
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

  // Backlinks are the server's answer because the browser holds no bodies but
  // its own: `list()` is metadata-only so the tree can badge without a download.
  loadBacklinks: async (id) => {
    if (STANDALONE) return
    set({ backlinksLoading: true })
    try {
      const { data } = await documentsApi.backlinks(id)
      // A slow answer for a document the user has already left is dropped
      // rather than shown under the new one.
      if (get().openDoc?.id !== id) return
      set({ backlinks: data, backlinksLoading: false })
    } catch {
      // Backlinks are a bonus panel; a failure must not break reading. A failure
      // for a document already left must not wipe the one now on screen either.
      if (get().openDoc?.id !== id) return
      set({ backlinks: [], backlinksLoading: false })
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
    set((s) => {
      writeUi({ groupBy, expanded: s.expanded, treeWidth: s.treeWidth, lastDocId: readUi().lastDocId })
      return { groupBy }
    })
  },

  toggleExpanded: (key) => {
    set((s) => {
      const expanded = s.expanded.includes(key)
        ? s.expanded.filter((k) => k !== key)
        : [...s.expanded, key]
      writeUi({ groupBy: s.groupBy, expanded, treeWidth: s.treeWidth, lastDocId: readUi().lastDocId })
      return { expanded }
    })
  },

  setExpanded: (keys) => {
    set((s) => {
      writeUi({ groupBy: s.groupBy, expanded: keys, treeWidth: s.treeWidth, lastDocId: readUi().lastDocId })
      return { expanded: keys }
    })
  },

  setTreeWidth: (treeWidth) => {
    set((s) => {
      writeUi({ groupBy: s.groupBy, expanded: s.expanded, treeWidth, lastDocId: readUi().lastDocId })
      return { treeWidth }
    })
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
