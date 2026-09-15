import { beforeEach, describe, expect, it, vi } from 'vitest'

import { documentsApi } from '@/api/client'
import {
  clearDraft,
  draftKey,
  driftedIds,
  isDescendant,
  overdueIds,
  readDraft,
  useDocsStore,
  writeDraft,
} from '../store'
import type { Doc, DocumentSummary, UpdatePreview } from '../types'

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    revisions: vi.fn(),
    revision: vi.fn(),
    restore: vi.fn(),
    regenerate: vi.fn(),
    search: vi.fn(),
    block: vi.fn(),
    coverage: vi.fn(),
    scaffold: vi.fn(),
    updatePreview: vi.fn(),
    updateFromDevice: vi.fn(),
  },
}))

const api = vi.mocked(documentsApi)

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'Page',
    slug: 'page',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function doc(overrides: Partial<Doc> = {}): Doc {
  return { ...summary(), body: 'original', ...overrides } as Doc
}

function preview(overrides: Partial<UpdatePreview> = {}): UpdatePreview {
  return {
    preview_id: 'p1',
    changes: [],
    proposed_body: 'body',
    summary: [],
    unresolved: [],
    ...overrides,
  }
}

/** A promise the test settles by hand, to race the store's requests. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const INITIAL = useDocsStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useDocsStore.setState({
    ...INITIAL,
    docs: [],
    openDoc: null,
    draft: null,
    dirty: false,
    pendingDraft: null,
    loadError: null,
    revisions: [],
    coverage: null,
    search: null,
    preview: null,
    previewLoading: false,
    resolutions: {},
  })
})

// ── loading ─────────────────────────────────────────────────────────────────

describe('loadDocs', () => {
  it('stores the listing', async () => {
    api.list.mockResolvedValue({ data: [summary()] } as never)
    await useDocsStore.getState().loadDocs()
    expect(useDocsStore.getState().docs).toHaveLength(1)
    expect(useDocsStore.getState().loaded).toBe(true)
  })

  it('surfaces the server message on failure and still marks itself loaded', async () => {
    api.list.mockRejectedValue({ response: { data: { detail: 'nope' } } })
    await useDocsStore.getState().loadDocs()
    expect(useDocsStore.getState().loadError).toBe('nope')
    expect(useDocsStore.getState().loaded).toBe(true)
  })
})

// ── the draft lifecycle ─────────────────────────────────────────────────────

describe('editing', () => {
  beforeEach(() => {
    useDocsStore.setState({ openDoc: doc() })
  })

  it('starts clean, from the stored body', () => {
    useDocsStore.getState().startEdit()
    expect(useDocsStore.getState().draft).toBe('original')
    expect(useDocsStore.getState().dirty).toBe(false)
  })

  it('goes dirty only once the text actually differs', () => {
    useDocsStore.getState().startEdit()
    useDocsStore.getState().setDraft('original')
    expect(useDocsStore.getState().dirty).toBe(false)
    useDocsStore.getState().setDraft('changed')
    expect(useDocsStore.getState().dirty).toBe(true)
  })

  it('mirrors every keystroke to localStorage so a reload cannot lose it', () => {
    useDocsStore.getState().startEdit()
    useDocsStore.getState().setDraft('changed')
    expect(readDraft('doc-1')?.body).toBe('changed')
  })

  it('drops the draft when the edit is cancelled', () => {
    useDocsStore.getState().startEdit()
    useDocsStore.getState().setDraft('changed')
    useDocsStore.getState().cancelEdit()
    expect(readDraft('doc-1')).toBeNull()
    expect(useDocsStore.getState().draft).toBeNull()
  })

  it('saves explicitly and clears the draft once the server has it', async () => {
    api.update.mockResolvedValue({ data: doc({ body: 'changed', updated_at: 'later' }) } as never)
    useDocsStore.setState({ docs: [summary()] })
    useDocsStore.getState().startEdit()
    useDocsStore.getState().setDraft('changed')

    expect(await useDocsStore.getState().save()).toBe(true)
    expect(api.update).toHaveBeenCalledWith('doc-1', { body: 'changed' })
    expect(readDraft('doc-1')).toBeNull()
    expect(useDocsStore.getState().dirty).toBe(false)
    expect(useDocsStore.getState().docs[0].updated_at).toBe('later')
  })

  it('keeps the draft when the save fails, so nothing is lost', async () => {
    api.update.mockRejectedValue({ response: { data: { detail: 'server said no' } } })
    useDocsStore.getState().startEdit()
    useDocsStore.getState().setDraft('changed')

    expect(await useDocsStore.getState().save()).toBe(false)
    expect(readDraft('doc-1')?.body).toBe('changed')
    expect(useDocsStore.getState().loadError).toBe('server said no')
  })

  it('does nothing when there is no draft to save', async () => {
    expect(await useDocsStore.getState().save()).toBe(false)
    expect(api.update).not.toHaveBeenCalled()
  })
})

// ── draft recovery ──────────────────────────────────────────────────────────

describe('opening a document with a draft on disk', () => {
  it('offers a draft taken against the version being opened', async () => {
    writeDraft('doc-1', { body: 'unsaved', savedAt: Date.now(), base: '2026-01-01T00:00:00Z' })
    api.get.mockResolvedValue({ data: doc() } as never)

    await useDocsStore.getState().open('doc-1')
    expect(useDocsStore.getState().pendingDraft).toBe('unsaved')
  })

  it('throws away a draft taken against an older version', async () => {
    // The document changed elsewhere; replaying the old draft would revert it.
    writeDraft('doc-1', { body: 'unsaved', savedAt: Date.now(), base: 'an-older-version' })
    api.get.mockResolvedValue({ data: doc() } as never)

    await useDocsStore.getState().open('doc-1')
    expect(useDocsStore.getState().pendingDraft).toBeNull()
    expect(readDraft('doc-1')).toBeNull()
  })

  it('offers nothing when the draft matches what was saved', async () => {
    writeDraft('doc-1', { body: 'original', savedAt: Date.now(), base: '2026-01-01T00:00:00Z' })
    api.get.mockResolvedValue({ data: doc() } as never)

    await useDocsStore.getState().open('doc-1')
    expect(useDocsStore.getState().pendingDraft).toBeNull()
  })

  it('restores the offered draft into the editor', async () => {
    writeDraft('doc-1', { body: 'unsaved', savedAt: Date.now(), base: '2026-01-01T00:00:00Z' })
    api.get.mockResolvedValue({ data: doc() } as never)
    await useDocsStore.getState().open('doc-1')

    useDocsStore.getState().acceptPendingDraft()
    expect(useDocsStore.getState().draft).toBe('unsaved')
    expect(useDocsStore.getState().dirty).toBe(true)
  })

  it('discards the offered draft on request', async () => {
    writeDraft('doc-1', { body: 'unsaved', savedAt: Date.now(), base: '2026-01-01T00:00:00Z' })
    api.get.mockResolvedValue({ data: doc() } as never)
    await useDocsStore.getState().open('doc-1')

    useDocsStore.getState().discardPendingDraft()
    expect(useDocsStore.getState().pendingDraft).toBeNull()
    expect(readDraft('doc-1')).toBeNull()
  })
})

describe('draft storage', () => {
  it('namespaces the key by document', () => {
    expect(draftKey('abc')).toBe('homelable_docdraft:abc')
  })

  it('reads nothing back from a corrupt entry rather than throwing', () => {
    localStorage.setItem(draftKey('doc-1'), 'not json')
    expect(readDraft('doc-1')).toBeNull()
  })

  it('clears cleanly when there is nothing to clear', () => {
    expect(() => clearDraft('missing')).not.toThrow()
  })
})

// ── mutations ───────────────────────────────────────────────────────────────

describe('mutations', () => {
  it('adds a created document to the list and opens it', async () => {
    api.create.mockResolvedValue({ data: doc({ id: 'new' }) } as never)
    await useDocsStore.getState().create({ title: 'New' })
    expect(useDocsStore.getState().docs.map((d) => d.id)).toEqual(['new'])
    expect(useDocsStore.getState().openDoc?.id).toBe('new')
  })

  it('reports a create failure instead of adding nothing silently', async () => {
    api.create.mockRejectedValue({ response: { data: { detail: 'that already has a document' } } })
    expect(await useDocsStore.getState().create({ title: 'New' })).toBeNull()
    expect(useDocsStore.getState().loadError).toBe('that already has a document')
  })

  it('drops a deleted folder together with its subtree', async () => {
    api.delete.mockResolvedValue({} as never)
    useDocsStore.setState({
      docs: [
        summary({ id: 'f', kind: 'folder' }),
        summary({ id: 'child', parent_id: 'f' }),
        summary({ id: 'grandchild', parent_id: 'child' }),
        summary({ id: 'elsewhere' }),
      ],
    })
    await useDocsStore.getState().remove('f')
    expect(useDocsStore.getState().docs.map((d) => d.id)).toEqual(['elsewhere'])
  })

  it('closes the open document when it is the one deleted', async () => {
    api.delete.mockResolvedValue({} as never)
    useDocsStore.setState({ docs: [summary()], openDoc: doc() })
    await useDocsStore.getState().remove('doc-1')
    expect(useDocsStore.getState().openDoc).toBeNull()
  })

  it('flips the star', async () => {
    api.update.mockResolvedValue({ data: doc({ starred: true }) } as never)
    useDocsStore.setState({ docs: [summary()] })
    await useDocsStore.getState().toggleStar('doc-1')
    expect(api.update).toHaveBeenCalledWith('doc-1', { starred: true })
    expect(useDocsStore.getState().docs[0].starred).toBe(true)
  })

  it('writes tags into the body, because the body owns them', async () => {
    api.update.mockResolvedValue({ data: doc({ tags: ['prod'] }) } as never)
    useDocsStore.setState({ docs: [summary()], openDoc: doc({ body: '---\ntitle: NAS\n---\n\n# NAS\n' }) })
    await useDocsStore.getState().setTags(['prod'])
    expect(api.update).toHaveBeenCalledWith('doc-1', { body: '---\ntitle: NAS\ntags: [prod]\n---\n\n# NAS\n' })
    expect(useDocsStore.getState().docs[0].tags).toEqual(['prod'])
  })

  it('reports a failed tag write rather than pretending it landed', async () => {
    api.update.mockRejectedValue({ response: { data: { detail: 'nope' } } })
    useDocsStore.setState({ openDoc: doc() })
    expect(await useDocsStore.getState().setTags(['prod'])).toBe(false)
    expect(useDocsStore.getState().loadError).toBe('nope')
  })

  it('has no tags to write with no document open', async () => {
    expect(await useDocsStore.getState().setTags(['prod'])).toBe(false)
    expect(api.update).not.toHaveBeenCalled()
  })

  it('accepts the current facts without touching the body', async () => {
    api.update.mockResolvedValue({ data: doc() } as never)
    useDocsStore.setState({ docs: [summary()] })
    await useDocsStore.getState().resyncFacts('doc-1')
    expect(api.update).toHaveBeenCalledWith('doc-1', { resync_facts: true })
  })

  it('restores a revision and refreshes the history', async () => {
    api.restore.mockResolvedValue({ data: doc({ body: 'old' }) } as never)
    api.revisions.mockResolvedValue({ data: [] } as never)
    useDocsStore.setState({ docs: [summary()], openDoc: doc() })
    await useDocsStore.getState().restore('doc-1', 'rev-1')
    expect(useDocsStore.getState().openDoc?.body).toBe('old')
    expect(api.revisions).toHaveBeenCalledWith('doc-1')
  })

  it('regenerates the open document and drops the draft with it', async () => {
    api.regenerate.mockResolvedValue({ data: doc({ body: 'generated' }) } as never)
    useDocsStore.setState({ docs: [summary()], openDoc: doc(), draft: 'half written', dirty: true })
    writeDraft('doc-1', { body: 'half written', savedAt: 1, base: '2026-01-01T00:00:00Z' })

    expect(await useDocsStore.getState().regenerate('doc-1')).toBe(true)

    const state = useDocsStore.getState()
    expect(api.regenerate).toHaveBeenCalledWith('doc-1')
    expect(state.openDoc?.body).toBe('generated')
    expect(state.draft).toBeNull()
    expect(state.dirty).toBe(false)
    expect(readDraft('doc-1')).toBeNull()
  })

  it('refreshes the history when it is already on screen', async () => {
    api.regenerate.mockResolvedValue({ data: doc({ body: 'generated' }) } as never)
    api.revisions.mockResolvedValue({ data: [] } as never)
    useDocsStore.setState({
      docs: [summary()],
      openDoc: doc(),
      revisions: [
        { id: 'rev-1', document_id: 'doc-1', title: 'Page', reason: 'edit', saved_at: '2026-01-01T00:00:00Z', size: 8 },
      ],
    })
    await useDocsStore.getState().regenerate('doc-1')
    expect(api.revisions).toHaveBeenCalledWith('doc-1')
  })

  it('reports a failed regenerate and leaves the body alone', async () => {
    api.regenerate.mockRejectedValue({ response: { data: { detail: 'Device not found' } } } as never)
    useDocsStore.setState({ docs: [summary()], openDoc: doc() })

    expect(await useDocsStore.getState().regenerate('doc-1')).toBe(false)
    expect(useDocsStore.getState().openDoc?.body).toBe('original')
    expect(useDocsStore.getState().loadError).toBe('Device not found')
  })

  it('leaves the editor alone when another document is regenerated', async () => {
    api.regenerate.mockResolvedValue({ data: doc({ id: 'doc-2', body: 'generated' }) } as never)
    useDocsStore.setState({
      docs: [summary(), summary({ id: 'doc-2' })],
      openDoc: doc(),
      draft: 'mine',
      dirty: true,
    })
    await useDocsStore.getState().regenerate('doc-2')
    const state = useDocsStore.getState()
    expect(state.openDoc?.id).toBe('doc-1')
    expect(state.draft).toBe('mine')
    expect((state.docs.find((d) => d.id === 'doc-2') as Doc).body).toBe('generated')
  })
})

// ── badges ──────────────────────────────────────────────────────────────────

describe('driftedIds', () => {
  it('collects the documents the server flagged', () => {
    const ids = driftedIds([
      summary({ id: 'doc-1', drifted: true }),
      summary({ id: 'doc-2', drifted: false }),
      summary({ id: 'doc-3' }),
    ])
    expect([...ids]).toEqual(['doc-1'])
  })

  it('is empty when nothing has drifted', () => {
    expect(driftedIds([summary()]).size).toBe(0)
  })
})

// ── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
  it('stores the engine alongside the hits', async () => {
    api.search.mockResolvedValue({ data: { engine: 'like', hits: [] } } as never)
    await useDocsStore.getState().runSearch('nas')
    expect(useDocsStore.getState().search?.engine).toBe('like')
  })

  it('does not call the server for an empty query', async () => {
    await useDocsStore.getState().runSearch('   ')
    expect(api.search).not.toHaveBeenCalled()
    expect(useDocsStore.getState().search).toBeNull()
  })
})

// ── preferences ─────────────────────────────────────────────────────────────

describe('preferences', () => {
  it('remembers the grouping across sessions', () => {
    useDocsStore.getState().setGroupBy('subnet')
    expect(JSON.parse(localStorage.getItem('homelable_docs_ui') ?? '{}').groupBy).toBe('subnet')
  })

  it('toggles a tree key on and off', () => {
    useDocsStore.getState().toggleExpanded('zone:Garage')
    expect(useDocsStore.getState().expanded).toContain('zone:Garage')
    useDocsStore.getState().toggleExpanded('zone:Garage')
    expect(useDocsStore.getState().expanded).not.toContain('zone:Garage')
  })
})

// ── helpers ─────────────────────────────────────────────────────────────────

describe('isDescendant', () => {
  const all = [
    summary({ id: 'root', kind: 'folder' }),
    summary({ id: 'mid', kind: 'folder', parent_id: 'root' }),
    summary({ id: 'leaf', parent_id: 'mid' }),
    summary({ id: 'other' }),
  ]

  it('walks the whole chain', () => {
    expect(isDescendant(all, all[2], 'root')).toBe(true)
    expect(isDescendant(all, all[3], 'root')).toBe(false)
  })

  it('does not count a document as its own descendant', () => {
    expect(isDescendant(all, all[0], 'root')).toBe(false)
  })

  it('survives a cycle', () => {
    const cyclic = [summary({ id: 'a', parent_id: 'b' }), summary({ id: 'b', parent_id: 'a' })]
    expect(() => isDescendant(cyclic, cyclic[0], 'nowhere')).not.toThrow()
  })
})

describe('overdueIds', () => {
  it('flags only the documents whose cadence has elapsed', () => {
    const now = Date.parse('2026-09-05T00:00:00Z')
    const docs = [
      summary({ id: 'due', frontmatter: { review_every: '1m' }, created_at: '2026-01-01T00:00:00Z' }),
      summary({ id: 'fresh', frontmatter: { review_every: '5y' }, created_at: '2026-01-01T00:00:00Z' }),
      summary({ id: 'no-cadence', created_at: '2020-01-01T00:00:00Z' }),
    ]
    expect([...overdueIds(docs, now)]).toEqual(['due'])
  })
})

// ── the way in from the canvas ──────────────────────────────────────────────

describe('openForDevice', () => {
  const deviceDoc = summary({ id: 'doc-dev', kind: 'device', device_id: 'dev-1', title: 'bazarr' })

  it('opens the document a device already has', async () => {
    useDocsStore.setState({ docs: [deviceDoc], loaded: true })
    api.get.mockResolvedValue({ data: doc({ id: 'doc-dev', device_id: 'dev-1' }) } as never)

    expect(await useDocsStore.getState().openForDevice('dev-1', 'bazarr')).toBe(true)
    expect(api.create).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledWith('doc-dev')
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-dev')
  })

  it('fetches the listing first when the section was never opened', async () => {
    useDocsStore.setState({ docs: [], loaded: false })
    api.list.mockResolvedValue({ data: [deviceDoc] } as never)
    api.get.mockResolvedValue({ data: doc({ id: 'doc-dev', device_id: 'dev-1' }) } as never)

    expect(await useDocsStore.getState().openForDevice('dev-1', 'bazarr')).toBe(true)
    expect(api.list).toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('writes one from the device facts when there is none', async () => {
    useDocsStore.setState({ docs: [], loaded: true })
    api.create.mockResolvedValue({ data: doc({ id: 'doc-new', device_id: 'dev-1' }) } as never)
    api.get.mockResolvedValue({ data: doc({ id: 'doc-new', device_id: 'dev-1' }) } as never)

    expect(await useDocsStore.getState().openForDevice('dev-1', 'bazarr')).toBe(true)
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'bazarr', kind: 'device', device_id: 'dev-1' }),
    )
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-new')
  })

  it('falls back to a title rather than creating an unnamed document', async () => {
    useDocsStore.setState({ docs: [], loaded: true })
    api.create.mockResolvedValue({ data: doc({ id: 'doc-new' }) } as never)
    api.get.mockResolvedValue({ data: doc({ id: 'doc-new' }) } as never)

    await useDocsStore.getState().openForDevice('dev-1', '   ')
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Untitled device' }))
  })

  it('reports a failure rather than switching to an empty section', async () => {
    useDocsStore.setState({ docs: [], loaded: true })
    api.create.mockRejectedValue(new Error('nope'))

    expect(await useDocsStore.getState().openForDevice('dev-1', 'bazarr')).toBe(false)
    expect(useDocsStore.getState().openDoc).toBeNull()
  })
})

// ── update-from-device ────────────────────────────────────────────────────

describe('openUpdatePreview', () => {
  it('fetches the preview for the open document', async () => {
    const previewResponse = {
      preview_id: 'abc123',
      changes: [],
      proposed_body: 'updated body',
      summary: [],
      unresolved: [],
    }
    useDocsStore.setState({ openDoc: doc({ id: 'doc-1', device_id: 'dev-1' }) as Doc })
    api.updatePreview.mockResolvedValue({ data: previewResponse } as never)

    const result = await useDocsStore.getState().openUpdatePreview()

    expect(result).toEqual(previewResponse)
    expect(api.updatePreview).toHaveBeenCalledWith('doc-1', [])
    expect(useDocsStore.getState().preview?.preview_id).toBe('abc123')
  })

  it('drops a superseded answer that resolves after the newest request', async () => {
    const first = deferred<{ data: UpdatePreview }>()
    const second = deferred<{ data: UpdatePreview }>()
    api.updatePreview
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    useDocsStore.setState({ openDoc: doc() })

    // The first request answers with the resolutions of the moment it was
    // issued; by the time it returns, a newer request owns the review.
    const firstCall = useDocsStore.getState().openUpdatePreview()
    useDocsStore.setState({ resolutions: { a: { id: 'a', choice: 'device' } } })
    const secondCall = useDocsStore.getState().openUpdatePreview()

    second.resolve({ data: preview({ preview_id: 'newest' }) })
    first.resolve({ data: preview({ preview_id: 'stale' }) })

    expect(await firstCall).toBeNull()
    expect(await secondCall).toEqual(preview({ preview_id: 'newest' }))
    expect(useDocsStore.getState().preview?.preview_id).toBe('newest')
    expect(useDocsStore.getState().previewLoading).toBe(false)
    expect(api.updatePreview).toHaveBeenNthCalledWith(1, 'doc-1', [])
    expect(api.updatePreview).toHaveBeenNthCalledWith(2, 'doc-1', [{ id: 'a', choice: 'device' }])
  })

  it('does not clear the current preview when a superseded request fails', async () => {
    const stale = deferred<{ data: UpdatePreview }>()
    const newest = deferred<{ data: UpdatePreview }>()
    api.updatePreview
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => newest.promise)
    useDocsStore.setState({ openDoc: doc() })

    const staleCall = useDocsStore.getState().openUpdatePreview()
    const newestCall = useDocsStore.getState().openUpdatePreview()

    newest.resolve({ data: preview({ preview_id: 'newest' }) })
    stale.reject(new Error('connection dropped'))

    expect(await staleCall).toBeNull()
    expect(await newestCall).toEqual(preview({ preview_id: 'newest' }))
    expect(useDocsStore.getState().preview?.preview_id).toBe('newest')
    expect(useDocsStore.getState().previewLoading).toBe(false)
    // The superseded failure must not surface as if the review had failed.
    expect(useDocsStore.getState().loadError).toBeNull()
  })

  it('ignores an answer for a document that was closed meanwhile', async () => {
    const inFlight = deferred<{ data: UpdatePreview }>()
    api.updatePreview.mockImplementationOnce(() => inFlight.promise)
    useDocsStore.setState({ openDoc: doc() })

    const call = useDocsStore.getState().openUpdatePreview()
    useDocsStore.getState().close()
    inFlight.resolve({ data: preview({ preview_id: 'ghost' }) })

    expect(await call).toBeNull()
    expect(useDocsStore.getState().preview).toBeNull()
    expect(useDocsStore.getState().previewLoading).toBe(false)
  })

  it('ignores an answer for a document the user already switched away from', async () => {
    const inFlight = deferred<{ data: UpdatePreview }>()
    api.updatePreview.mockImplementationOnce(() => inFlight.promise)
    api.get.mockResolvedValue({ data: doc({ id: 'doc-2' }) } as never)
    useDocsStore.setState({ openDoc: doc({ id: 'doc-1' }) })

    const call = useDocsStore.getState().openUpdatePreview()
    const opening = useDocsStore.getState().open('doc-2')
    inFlight.resolve({ data: preview({ preview_id: 'ghost' }) })

    expect(await call).toBeNull()
    await opening
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-2')
    expect(useDocsStore.getState().preview).toBeNull()
  })

  it('ignores an answer when the review was cancelled during the request', async () => {
    const inFlight = deferred<{ data: UpdatePreview }>()
    api.updatePreview.mockImplementationOnce(() => inFlight.promise)
    useDocsStore.setState({ openDoc: doc() })

    const call = useDocsStore.getState().openUpdatePreview()
    expect(useDocsStore.getState().previewLoading).toBe(true)
    useDocsStore.getState().clearResolutions()
    // The cancel stops the spinner itself: the in-flight request is now going
    // to be ignored, so it can never be the one to clear the flag.
    expect(useDocsStore.getState().previewLoading).toBe(false)
    inFlight.resolve({ data: preview({ preview_id: 'ghost' }) })

    expect(await call).toBeNull()
    expect(useDocsStore.getState().preview).toBeNull()
    expect(useDocsStore.getState().previewLoading).toBe(false)
  })
})

describe('setResolution', () => {
  it('stores the decision and re-previews', async () => {
    const previewResponse = {
      preview_id: 'xyz',
      changes: [{ id: 'conflict-1', name: 'IP', status: 'conflict', documented: 'old', device: 'new' }],
      proposed_body: 'body',
      summary: [],
      unresolved: ['conflict-1'],
    }
    useDocsStore.setState({ openDoc: doc({ id: 'doc-1' }) as Doc })
    api.updatePreview.mockResolvedValue({ data: previewResponse } as never)

    useDocsStore.getState().setResolution('conflict-1', { id: 'conflict-1', choice: 'device' })

    expect(useDocsStore.getState().resolutions['conflict-1']?.choice).toBe('device')
    expect(api.updatePreview).toHaveBeenCalledTimes(1)
  })

  it('keeps the preview of the newest decision when two reviews race', async () => {
    const first = deferred<{ data: UpdatePreview }>()
    const second = deferred<{ data: UpdatePreview }>()
    api.updatePreview
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    useDocsStore.setState({ openDoc: doc() })

    // Two decisions land back to back; each fires its own preview, and the
    // older one answers last — it must not undo the newer review.
    useDocsStore.getState().setResolution('a', { id: 'a', choice: 'device' })
    useDocsStore.getState().setResolution('b', { id: 'b', choice: 'custom', custom: '10.0.0.5' })

    second.resolve({ data: preview({ preview_id: 'newest' }) })
    first.resolve({ data: preview({ preview_id: 'stale' }) })
    await Promise.resolve()

    expect(useDocsStore.getState().preview?.preview_id).toBe('newest')
    expect(useDocsStore.getState().resolutions).toEqual({
      a: { id: 'a', choice: 'device' },
      b: { id: 'b', choice: 'custom', custom: '10.0.0.5' },
    })
    expect(useDocsStore.getState().previewLoading).toBe(false)
  })
})

describe('applyUpdate', () => {
  it('applies the merge and refreshes the document', async () => {
    const updatedDoc = doc({ id: 'doc-1', body: 'merged', device_id: 'dev-1' })
    const previewResponse = {
      preview_id: 'preview-1',
      changes: [],
      proposed_body: 'merged',
      summary: ['Applied IP'],
      unresolved: [],
    }
    useDocsStore.setState({
      openDoc: doc({ id: 'doc-1', device_id: 'dev-1', body: 'old' }) as Doc,
      resolutions: { 'conflict-1': { id: 'conflict-1', choice: 'device' } },
    })
    // The preview is installed the way the review installs it, so apply can
    // verify the merge on screen was computed over these exact decisions.
    api.updatePreview.mockResolvedValue({ data: previewResponse } as never)
    await useDocsStore.getState().openUpdatePreview()

    api.updateFromDevice.mockResolvedValue({ data: updatedDoc } as never)
    api.get.mockResolvedValue({ data: updatedDoc } as never)

    const result = await useDocsStore.getState().applyUpdate()

    expect(result).toBe('applied')
    expect(api.updateFromDevice).toHaveBeenCalledWith('doc-1', 'preview-1', [
      { id: 'conflict-1', choice: 'device' },
    ])
    expect(useDocsStore.getState().preview).toBeNull()
    expect(useDocsStore.getState().resolutions).toEqual({})
  })

  it('returns stale on 409 and resets the review', async () => {
    const error = Object.assign(new Error('Conflict'), { response: { status: 409 } })
    useDocsStore.setState({ openDoc: doc({ id: 'doc-1' }) as Doc })
    api.updatePreview.mockResolvedValue({
      data: { preview_id: 'p1', changes: [], proposed_body: '', summary: [], unresolved: [] },
    } as never)
    await useDocsStore.getState().openUpdatePreview()
    api.updateFromDevice.mockRejectedValue(error)

    const result = await useDocsStore.getState().applyUpdate()

    expect(result).toBe('stale')
    expect(useDocsStore.getState().loadError).toBeTruthy()
    // The stale merge and the choices that went with it are void; the fresh
    // review must start clean rather than carry decisions made on a baseline
    // that no longer holds.
    expect(useDocsStore.getState().preview).toBeNull()
    expect(useDocsStore.getState().resolutions).toEqual({})
    expect(useDocsStore.getState().previewLoading).toBe(false)
  })

  it('refuses to apply once the latest preview has failed', async () => {
    useDocsStore.setState({ openDoc: doc() })
    api.updatePreview.mockResolvedValueOnce({ data: preview({ preview_id: 'first' }) } as never)
    await useDocsStore.getState().openUpdatePreview()
    expect(useDocsStore.getState().preview?.preview_id).toBe('first')

    // The re-preview that would supersede it fails. The merge on screen is no
    // longer the one that would land, so it must not be applicable either.
    api.updatePreview.mockRejectedValueOnce({ response: { data: { detail: 'device offline' } } })
    expect(await useDocsStore.getState().openUpdatePreview()).toBeNull()
    expect(useDocsStore.getState().preview).toBeNull()
    expect(useDocsStore.getState().loadError).toBe('device offline')

    expect(await useDocsStore.getState().applyUpdate()).toBe('failed')
    expect(api.updateFromDevice).not.toHaveBeenCalled()
  })

  it('refuses to apply while a newer preview is still loading', async () => {
    const inFlight = deferred<{ data: UpdatePreview }>()
    api.updatePreview.mockImplementationOnce(() => inFlight.promise)
    useDocsStore.setState({ openDoc: doc(), resolutions: {} })
    const previewing = useDocsStore.getState().openUpdatePreview()

    expect(await useDocsStore.getState().applyUpdate()).toBe('failed')
    expect(api.updateFromDevice).not.toHaveBeenCalled()

    inFlight.resolve({ data: preview({ preview_id: 'p' }) })
    await previewing
    expect(useDocsStore.getState().previewLoading).toBe(false)
  })

  it('refuses to apply while conflicts are still open', async () => {
    api.updatePreview.mockResolvedValue({
      data: preview({ preview_id: 'p1', unresolved: ['conflict-1'] }),
    } as never)
    useDocsStore.setState({ openDoc: doc(), resolutions: {} })
    await useDocsStore.getState().openUpdatePreview()

    expect(useDocsStore.getState().preview?.unresolved).toEqual(['conflict-1'])
    expect(await useDocsStore.getState().applyUpdate()).toBe('failed')
    expect(api.updateFromDevice).not.toHaveBeenCalled()
  })

  it('refuses to apply a preview computed before the latest decision', async () => {
    api.updatePreview.mockResolvedValue({ data: preview({ preview_id: 'p1', unresolved: [] }) } as never)
    useDocsStore.setState({
      openDoc: doc(),
      resolutions: { a: { id: 'a', choice: 'device' } },
    })
    await useDocsStore.getState().openUpdatePreview()

    // A further decision lands after the preview was computed, and its
    // re-preview has not answered yet: applying now would merge with decisions
    // the user has never seen on top of this body.
    useDocsStore.setState({
      resolutions: { a: { id: 'a', choice: 'device' }, b: { id: 'b', choice: 'keep' } },
    })
    expect(await useDocsStore.getState().applyUpdate()).toBe('failed')
    expect(api.updateFromDevice).not.toHaveBeenCalled()

    // Once the matching preview for the fuller set of decisions has arrived,
    // the same apply is accepted and lands exactly that set.
    api.updatePreview.mockResolvedValue({ data: preview({ preview_id: 'p2', unresolved: [] }) } as never)
    await useDocsStore.getState().openUpdatePreview()
    api.updateFromDevice.mockResolvedValue({ data: doc({ id: 'doc-1', body: 'merged' }) } as never)

    expect(await useDocsStore.getState().applyUpdate()).toBe('applied')
    expect(api.updateFromDevice).toHaveBeenCalledWith('doc-1', 'p2', [
      { id: 'a', choice: 'device' },
      { id: 'b', choice: 'keep' },
    ])
  })

  it('does not replace a newer document and review when an old apply succeeds late', async () => {
    const applying = deferred<{ data: Doc }>()
    useDocsStore.setState({ openDoc: doc({ id: 'doc-1' }) })
    api.updatePreview.mockResolvedValueOnce({ data: preview({ preview_id: 'doc-1-preview' }) } as never)
    await useDocsStore.getState().openUpdatePreview()
    api.updateFromDevice.mockImplementationOnce(() => applying.promise)
    const oldApply = useDocsStore.getState().applyUpdate()

    api.get.mockResolvedValueOnce({ data: doc({ id: 'doc-2', body: 'second' }) } as never)
    await useDocsStore.getState().open('doc-2')
    useDocsStore.setState({ resolutions: { newer: { id: 'newer', choice: 'device' } } })
    api.updatePreview.mockResolvedValueOnce({ data: preview({ preview_id: 'doc-2-preview' }) } as never)
    await useDocsStore.getState().openUpdatePreview()

    applying.resolve({ data: doc({ id: 'doc-1', body: 'applied late' }) })
    expect(await oldApply).toBe('applied')
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-2')
    expect(useDocsStore.getState().preview?.preview_id).toBe('doc-2-preview')
    expect(useDocsStore.getState().resolutions).toEqual({
      newer: { id: 'newer', choice: 'device' },
    })

    api.updateFromDevice.mockResolvedValueOnce({ data: doc({ id: 'doc-2', body: 'merged second' }) } as never)
    expect(await useDocsStore.getState().applyUpdate()).toBe('applied')
  })

  it('does not clear a newer document review when an old apply rejects late', async () => {
    const applying = deferred<{ data: Doc }>()
    useDocsStore.setState({ openDoc: doc({ id: 'doc-1' }) })
    api.updatePreview.mockResolvedValueOnce({ data: preview({ preview_id: 'doc-1-preview' }) } as never)
    await useDocsStore.getState().openUpdatePreview()
    api.updateFromDevice.mockImplementationOnce(() => applying.promise)
    const oldApply = useDocsStore.getState().applyUpdate()

    api.get.mockResolvedValueOnce({ data: doc({ id: 'doc-2', body: 'second' }) } as never)
    await useDocsStore.getState().open('doc-2')
    useDocsStore.setState({ resolutions: { newer: { id: 'newer', choice: 'device' } } })
    api.updatePreview.mockResolvedValueOnce({ data: preview({ preview_id: 'doc-2-preview' }) } as never)
    await useDocsStore.getState().openUpdatePreview()

    applying.reject(Object.assign(new Error('stale'), { response: { status: 409 } }))
    expect(await oldApply).toBe('stale')
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-2')
    expect(useDocsStore.getState().preview?.preview_id).toBe('doc-2-preview')
    expect(useDocsStore.getState().resolutions).toEqual({
      newer: { id: 'newer', choice: 'device' },
    })
    expect(useDocsStore.getState().previewLoading).toBe(false)
  })
})
