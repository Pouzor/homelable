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

export interface DraftRecord {
  body: string
  savedAt: number
  /** The monotonic document version the draft was taken from. Null for legacy drafts. */
  baseVersion: number | null
}

export function draftKey(docId: string): string {
  return `${DRAFT_PREFIX}${docId}`
}

export function readDraft(docId: string): DraftRecord | null {
  try {
    const raw = localStorage.getItem(draftKey(docId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DraftRecord>
    if (typeof parsed.body !== 'string' || typeof parsed.savedAt !== 'number') return null
    return {
      body: parsed.body,
      savedAt: parsed.savedAt,
      // Older clients stored an `updated_at` string as `base`. Preserve their
      // text, but never treat that timestamp as proof that the draft is current.
      baseVersion: typeof parsed.baseVersion === 'number' ? parsed.baseVersion : null,
    }
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

function sameDraft(left: DraftRecord | null, right: DraftRecord | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.body === right.body &&
      left.savedAt === right.savedAt &&
      left.baseVersion === right.baseVersion)
  )
}

function clearDraftIfUnchanged(docId: string, before: DraftRecord | null): void {
  if (sameDraft(readDraft(docId), before)) clearDraft(docId)
}

function mergeDocument(docs: DocumentSummary[], data: Doc): DocumentSummary[] {
  return docs.map((doc) =>
    doc.id === data.id && doc.version <= data.version ? { ...doc, ...data } : doc,
  )
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
  /** Changes whenever the selected document changes, invalidating late responses. */
  documentEpoch: number

  /** The body being edited. Null when not in edit mode. */
  draft: string | null
  /** The monotonic server version the active draft was taken from. */
  draftBaseVersion: number | null
  dirty: boolean
  saving: boolean
  /** A recovered draft awaiting the user's yes or no. */
  pendingDraft: DraftRecord | null
  /**
   * The offered draft was written against an older version of the document
   * than the one just opened. Restoring it enters reconciliation mode; it does
   * not authorize a save against the newer version.
   */
  pendingDraftStale: boolean
  /**
   * A save was refused because the document moved underneath the edit — an
   * assistant's apply landed first (409). Holds the server's newer body so the
   * editor can show both bodies. The lock blocks further saves until the user
   * resolves this, so the assistant's text cannot be overwritten unseen.
   */
  conflict: Doc | null

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
  /** Discard the stale draft and read the newer body the server holds. */
  reloadAfterConflict: () => void
  /** Confirm the visible draft has been reconciled with the visible server body. */
  confirmDraftReconciled: () => void

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
  restore: (id: string, revisionId: string) => Promise<boolean>
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

/**
 * A save refused because the document moved after the draft was taken. The
 * section-apply guards are also 409, but those are its own endpoints; on the
 * PATCH this status means the optimistic lock tripped.
 */
function isStaleConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409
}

const initialUi = readUi()

export const useDocsStore = create<DocsState>()((set, get) => ({
  docs: [],
  loaded: false,
  loading: false,
  loadError: null,

  openDoc: null,
  openLoading: false,
  documentEpoch: 0,

  draft: null,
  draftBaseVersion: null,
  dirty: false,
  saving: false,
  pendingDraft: null,
  pendingDraftStale: false,
  conflict: null,

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
    const documentEpoch = get().documentEpoch + 1
    set({
      documentEpoch,
      openLoading: true,
      draft: null,
      draftBaseVersion: null,
      dirty: false,
      pendingDraft: null,
      pendingDraftStale: false,
      conflict: null,
      revisions: [],
      revisionsLoading: false,
      revisionPreview: null,
      backlinks: [],
    })
    try {
      const { data } = await documentsApi.get(id)
      if (get().documentEpoch !== documentEpoch) return
      // A draft differing from the stored body is unsaved work from a previous
      // session; offer it rather than silently applying or dropping it. A draft
      // taken against an older version is offered too — never silently cleared —
      // so restoring it is a conscious choice to replace text that changed since.
      const draft = readDraft(id)
      set({
        openDoc: data,
        openLoading: false,
        pendingDraft: draft && draft.body !== data.body ? draft : null,
        pendingDraftStale:
          draft !== null &&
          draft.body !== data.body &&
          (draft.baseVersion === null || draft.baseVersion !== data.version),
      })
      writeUi({ ...readUi(), lastDocId: id })
      // Not awaited: the document renders now, the "Linked from" block fills in.
      void get().loadBacklinks(id)
    } catch (error) {
      if (get().documentEpoch !== documentEpoch) return
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
    set((state) => ({
      documentEpoch: state.documentEpoch + 1,
      openDoc: null,
      draft: null,
      draftBaseVersion: null,
      dirty: false,
      pendingDraft: null,
      pendingDraftStale: false,
      conflict: null,
      revisions: [],
      revisionsLoading: false,
      revisionPreview: null,
      backlinks: [],
    })),

  startEdit: () => {
    const doc = get().openDoc
    if (doc) set({ draft: doc.body, draftBaseVersion: doc.version, dirty: false })
  },

  setDraft: (body) => {
    const { openDoc: doc, draftBaseVersion } = get()
    set({ draft: body, dirty: doc ? body !== doc.body : false })
    if (doc) writeDraft(doc.id, { body, savedAt: Date.now(), baseVersion: draftBaseVersion })
  },

  cancelEdit: () => {
    const doc = get().openDoc
    if (doc) clearDraft(doc.id)
    set({ draft: null, draftBaseVersion: null, dirty: false, conflict: null })
  },

  save: async () => {
    const { openDoc, draft, draftBaseVersion, conflict, documentEpoch, saving } = get()
    if (!openDoc || draft === null) return false
    if (saving) return false
    if (conflict || draftBaseVersion === null || draftBaseVersion !== openDoc.version) {
      set({
        loadError: 'Reconcile this draft with the current server text before saving it.',
      })
      return false
    }
    const persistedBefore = readDraft(openDoc.id)
    set({ saving: true })
    try {
      const { data } = await documentsApi.update(openDoc.id, {
        body: draft,
        // The optimistic-lock counter the editor was reading when the draft was
        // taken. Without it a human save could silently overwrite an edit an
        // assistant just made, which is exactly what issue #485 forbids.
        expected_version: draftBaseVersion,
      })
      const current = get()
      const sameSession =
        current.documentEpoch === documentEpoch && current.openDoc?.id === openDoc.id
      const continuedBody =
        sameSession &&
        current.draft !== null &&
        current.draftBaseVersion === draftBaseVersion &&
        current.draft !== draft
          ? current.draft
          : null

      if (continuedBody !== null) {
        writeDraft(openDoc.id, {
          body: continuedBody,
          savedAt: Date.now(),
          baseVersion: data.version,
        })
      } else {
        clearDraftIfUnchanged(openDoc.id, persistedBefore)
      }
      set((state) => ({
        saving: false,
        docs: mergeDocument(state.docs, data),
        ...(sameSession && state.openDoc && state.openDoc.version <= data.version
          ? continuedBody !== null
            ? {
                openDoc: data,
                draftBaseVersion: data.version,
                dirty: state.draft !== data.body,
                conflict: null,
              }
            : state.draft === draft && state.draftBaseVersion === draftBaseVersion
              ? {
                  openDoc: data,
                  draft: data.body,
                  draftBaseVersion: data.version,
                  dirty: false,
                  conflict: null,
                }
              : state.draft === null
                ? { openDoc: data }
                : {}
          : {}),
      }))
      return true
    } catch (error) {
      const stale = isStaleConflict(error)
      set((state) => ({
        saving: stale,
        ...(state.documentEpoch === documentEpoch && state.openDoc?.id === openDoc.id
          ? { loadError: message(error, 'Could not save') }
          : {}),
      }))
      // A 409 means the document moved underneath this edit — an assistant's
      // apply beat the human's save. The draft stays in the editor and the
      // conflict is set, so both bodies remain visible. The lock keeps the
      // version bump from being skipped: nothing overwrites newer text unseen.
      if (stale) {
        const fresh = await documentsApi.get(openDoc.id).catch(() => null)
        if (fresh) {
          set((state) =>
            state.documentEpoch === documentEpoch &&
            state.openDoc?.id === openDoc.id &&
            state.openDoc.version <= fresh.data.version &&
            state.draft !== null &&
            state.draftBaseVersion === draftBaseVersion
              ? {
                  conflict: fresh.data,
                  loadError: 'This document changed while you had it open.',
                  docs: mergeDocument(state.docs, fresh.data),
                }
              : {},
          )
        }
      }
      set({ saving: false })
      return false
    }
  },

  /** The conflict banner's "discard my stale draft and read what the assistant
      wrote". The user's unsaved edits vanish by this explicit choice. */
  reloadAfterConflict: () => {
    const conflict = get().conflict
    if (!conflict) return
    clearDraft(conflict.id)
    set((state) => ({
      openDoc: conflict,
      draft: conflict.body,
      draftBaseVersion: conflict.version,
      dirty: false,
      conflict: null,
      docs: state.docs.map((d) => (d.id === conflict.id ? { ...d, ...conflict } : d)),
    }))
  },

  /** Advance the draft's base only after the user has compared both visible
      bodies and explicitly says the editable text is the reconciled result. */
  confirmDraftReconciled: () => {
    const { conflict, draft } = get()
    if (!conflict || draft === null) return
    writeDraft(conflict.id, {
      body: draft,
      savedAt: Date.now(),
      baseVersion: conflict.version,
    })
    set((state) => ({
      openDoc: conflict,
      draftBaseVersion: conflict.version,
      dirty: draft !== conflict.body,
      conflict: null,
      loadError: null,
      docs: state.docs.map((doc) =>
        doc.id === conflict.id ? { ...doc, ...conflict } : doc,
      ),
    }))
  },

  acceptPendingDraft: () => {
    const { pendingDraft, openDoc } = get()
    if (pendingDraft === null || !openDoc) return
    const stale = pendingDraft.baseVersion === null || pendingDraft.baseVersion !== openDoc.version
    set({
      draft: pendingDraft.body,
      draftBaseVersion: pendingDraft.baseVersion,
      dirty: pendingDraft.body !== openDoc.body,
      pendingDraft: null,
      pendingDraftStale: false,
      // A stale (or legacy) draft is editable, but the current server body stays
      // beside it until the user explicitly confirms a manual reconciliation.
      conflict: stale ? openDoc : null,
    })
  },

  discardPendingDraft: () => {
    const doc = get().openDoc
    if (doc) clearDraft(doc.id)
    set({ pendingDraft: null, pendingDraftStale: false })
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
      set((state) => ({
        docs: [...state.docs, data],
        openDoc: data,
        documentEpoch: state.documentEpoch + 1,
      }))
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
    const body = withTags(openDoc.body, tags)
    try {
      const { data } = await documentsApi.update(openDoc.id, {
        body,
        // Tags are written through the body, so the same lock protects them:
        // an assistant's edit must not be silently overwritten by a chip click.
        expected_version: openDoc.version,
      })
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
      draftBaseVersion: state.openDoc?.id === id ? null : state.draftBaseVersion,
      documentEpoch:
        state.openDoc?.id === id ? state.documentEpoch + 1 : state.documentEpoch,
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
    const before = get()
    const current = before.openDoc?.id === id ? before.openDoc : before.docs.find((doc) => doc.id === id)
    if (!current) return false
    const { documentEpoch, draft, draftBaseVersion } = before
    const persistedBefore = readDraft(id)
    try {
      const { data } = await documentsApi.restore(id, revisionId, current.version)
      const after = get()
      const sameSession = after.documentEpoch === documentEpoch && after.openDoc?.id === id
      const draftChanged =
        sameSession &&
        (after.draft !== draft || after.draftBaseVersion !== draftBaseVersion)
      if (!draftChanged) clearDraftIfUnchanged(id, persistedBefore)
      set((state) => ({
        docs: mergeDocument(state.docs, data),
        ...(sameSession && state.openDoc && state.openDoc.version <= data.version
          ? draftChanged && state.draft !== null
            ? {
                openDoc: data,
                conflict: data,
                dirty: state.draft !== data.body,
                revisionPreview: null,
              }
            : {
                openDoc: data,
                draft: state.draft === null ? null : data.body,
                draftBaseVersion: state.draft === null ? null : data.version,
                dirty: false,
                pendingDraft: null,
                pendingDraftStale: false,
                conflict: null,
                // The restored body is now current, so its preview closes.
                revisionPreview: null,
              }
          : {}),
      }))
      if (get().documentEpoch === documentEpoch && get().openDoc?.id === id) {
        await get().loadRevisions(id)
      }
      return true
    } catch (error) {
      set((state) =>
        state.documentEpoch === documentEpoch && state.openDoc?.id === id
          ? { loadError: message(error, 'Could not restore that version') }
          : {},
      )
      return false
    }
  },

  regenerate: async (id) => {
    const before = get()
    const current = before.openDoc?.id === id ? before.openDoc : before.docs.find((doc) => doc.id === id)
    if (!current) return false
    const { documentEpoch, draft, draftBaseVersion } = before
    const persistedBefore = readDraft(id)
    try {
      const { data } = await documentsApi.regenerate(id, current.version)
      const after = get()
      const sameSession = after.documentEpoch === documentEpoch && after.openDoc?.id === id
      const draftChanged =
        sameSession &&
        (after.draft !== draft || after.draftBaseVersion !== draftBaseVersion)
      if (!draftChanged) clearDraftIfUnchanged(id, persistedBefore)
      set((state) => ({
        docs: mergeDocument(state.docs, data),
        ...(sameSession && state.openDoc && state.openDoc.version <= data.version
          ? draftChanged && state.draft !== null
            ? {
                openDoc: data,
                conflict: data,
                dirty: state.draft !== data.body,
              }
            : {
                openDoc: data,
                draft: null,
                draftBaseVersion: null,
                dirty: false,
                pendingDraft: null,
                pendingDraftStale: false,
                conflict: null,
              }
          : {}),
      }))
      if (
        get().documentEpoch === documentEpoch &&
        get().openDoc?.id === id &&
        get().revisions.length > 0
      ) {
        await get().loadRevisions(id)
      }
      return true
    } catch (error) {
      set((state) =>
        state.documentEpoch === documentEpoch && state.openDoc?.id === id
          ? { loadError: message(error, 'Could not regenerate that document') }
          : {},
      )
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
