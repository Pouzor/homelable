/**
 * The two halves of a document's context: what it used to say, and what points
 * at it. Both were reachable in the API and in the store long before anything
 * rendered them, so these pin the wiring as much as the logic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { documentsApi } from '@/api/client'
import { useDocsStore } from '../store'
import type { Doc, DocBacklink, DocRevision } from '../types'

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
    backlinks: vi.fn(),
    search: vi.fn(),
    block: vi.fn(),
    coverage: vi.fn(),
    scaffold: vi.fn(),
  },
}))

const api = vi.mocked(documentsApi)

function doc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'Page',
    slug: 'page',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    body: 'current body',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Doc
}

function revision(overrides: Partial<DocRevision> = {}): DocRevision {
  return {
    id: 'rev-1',
    document_id: 'doc-1',
    title: 'Page',
    reason: 'edit',
    saved_at: '2026-01-02T00:00:00Z',
    size: 12,
    ...overrides,
  }
}

function backlink(overrides: Partial<DocBacklink> = {}): DocBacklink {
  return {
    doc_id: 'doc-2',
    title: 'Runbook',
    kind: 'page',
    label: 'Page',
    context: 'see [[Page]]',
    count: 1,
    ...overrides,
  }
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
    revisions: [],
    revisionsLoading: false,
    revisionPreview: null,
    backlinks: [],
    backlinksLoading: false,
    loadError: null,
  })
})

// ── revisions ───────────────────────────────────────────────────────────────

describe('loadRevisions', () => {
  it('stores the list and clears the loading flag', async () => {
    useDocsStore.setState({ openDoc: doc() })
    api.revisions.mockResolvedValue({ data: [revision()] } as never)

    await useDocsStore.getState().loadRevisions('doc-1')

    expect(useDocsStore.getState().revisions).toHaveLength(1)
    expect(useDocsStore.getState().revisionsLoading).toBe(false)
  })

  it('drops an answer for a document the user has already left', async () => {
    useDocsStore.setState({ openDoc: doc({ id: 'doc-9' }) })
    api.revisions.mockResolvedValue({ data: [revision()] } as never)

    await useDocsStore.getState().loadRevisions('doc-1')

    expect(useDocsStore.getState().revisions).toEqual([])
  })

  it('reports a failure instead of spinning forever', async () => {
    useDocsStore.setState({ openDoc: doc() })
    api.revisions.mockRejectedValue(new Error('boom'))

    await useDocsStore.getState().loadRevisions('doc-1')

    expect(useDocsStore.getState().revisionsLoading).toBe(false)
    expect(useDocsStore.getState().loadError).toBe('Could not load the history')
  })
})

describe('previewRevision', () => {
  it('fetches the body of a revision already in the list', async () => {
    useDocsStore.setState({ openDoc: doc(), revisions: [revision()] })
    api.revision.mockResolvedValue({ data: { ...revision(), body: 'old body' } } as never)

    await useDocsStore.getState().previewRevision('rev-1')

    expect(api.revision).toHaveBeenCalledWith('rev-1')
    expect(useDocsStore.getState().revisionPreview).toEqual({
      revision: revision(),
      body: 'old body',
    })
  })

  it('asks for nothing when the revision is not in the list', async () => {
    await useDocsStore.getState().previewRevision('rev-nope')

    expect(api.revision).not.toHaveBeenCalled()
    expect(useDocsStore.getState().revisionPreview).toBeNull()
  })

  it('surfaces a failed read', async () => {
    useDocsStore.setState({ revisions: [revision()] })
    api.revision.mockRejectedValue(new Error('boom'))

    await useDocsStore.getState().previewRevision('rev-1')

    expect(useDocsStore.getState().revisionPreview).toBeNull()
    expect(useDocsStore.getState().loadError).toBe('Could not read that version')
  })

  it('closes on demand', () => {
    useDocsStore.setState({ revisionPreview: { revision: revision(), body: 'old' } })
    useDocsStore.getState().closeRevisionPreview()
    expect(useDocsStore.getState().revisionPreview).toBeNull()
  })
})

describe('restore', () => {
  it('takes the restored body and closes the version being read', async () => {
    useDocsStore.setState({
      openDoc: doc(),
      docs: [doc()],
      revisions: [revision()],
      revisionPreview: { revision: revision(), body: 'old body' },
    })
    api.restore.mockResolvedValue({ data: doc({ body: 'old body' }) } as never)
    api.revisions.mockResolvedValue({ data: [revision({ id: 'rev-2', reason: 'restore' })] } as never)

    await useDocsStore.getState().restore('doc-1', 'rev-1')

    expect(useDocsStore.getState().openDoc?.body).toBe('old body')
    expect(useDocsStore.getState().revisionPreview).toBeNull()
    // The restore itself became a revision, so the list is re-read.
    expect(useDocsStore.getState().revisions[0].reason).toBe('restore')
  })

  it('keeps the editor on the restored body when one was open', async () => {
    useDocsStore.setState({ openDoc: doc(), docs: [doc()], draft: 'half-typed' })
    api.restore.mockResolvedValue({ data: doc({ body: 'old body' }) } as never)
    api.revisions.mockResolvedValue({ data: [] } as never)

    await useDocsStore.getState().restore('doc-1', 'rev-1')

    expect(useDocsStore.getState().draft).toBe('old body')
    expect(useDocsStore.getState().dirty).toBe(false)
  })
})

// ── backlinks ───────────────────────────────────────────────────────────────

describe('loadBacklinks', () => {
  it('stores what links here', async () => {
    useDocsStore.setState({ openDoc: doc() })
    api.backlinks.mockResolvedValue({ data: [backlink()] } as never)

    await useDocsStore.getState().loadBacklinks('doc-1')

    expect(useDocsStore.getState().backlinks).toEqual([backlink()])
    expect(useDocsStore.getState().backlinksLoading).toBe(false)
  })

  it('drops an answer for a document the user has already left', async () => {
    useDocsStore.setState({ openDoc: doc({ id: 'doc-9' }) })
    api.backlinks.mockResolvedValue({ data: [backlink()] } as never)

    await useDocsStore.getState().loadBacklinks('doc-1')

    expect(useDocsStore.getState().backlinks).toEqual([])
  })

  it('stays quiet on a failure — the panel is a bonus, not the document', async () => {
    useDocsStore.setState({ openDoc: doc() })
    api.backlinks.mockRejectedValue(new Error('boom'))

    await useDocsStore.getState().loadBacklinks('doc-1')

    expect(useDocsStore.getState().backlinks).toEqual([])
    expect(useDocsStore.getState().backlinksLoading).toBe(false)
    expect(useDocsStore.getState().loadError).toBeNull()
  })

  it('leaves the document now on screen alone when an older request fails', async () => {
    useDocsStore.setState({ openDoc: doc({ id: 'doc-2' }), backlinks: [backlink()] })
    api.backlinks.mockRejectedValue(new Error('boom'))

    await useDocsStore.getState().loadBacklinks('doc-1')

    expect(useDocsStore.getState().backlinks).toEqual([backlink()])
  })
})

describe('open', () => {
  it('asks for the backlinks of the document it opened', async () => {
    api.get.mockResolvedValue({ data: doc() } as never)
    api.backlinks.mockResolvedValue({ data: [backlink()] } as never)

    await useDocsStore.getState().open('doc-1')
    // `open` does not await the backlinks; let the microtask queue drain.
    await Promise.resolve()
    await Promise.resolve()

    expect(api.backlinks).toHaveBeenCalledWith('doc-1')
    expect(useDocsStore.getState().backlinks).toEqual([backlink()])
  })

  it('clears the previous document’s history and backlinks first', async () => {
    useDocsStore.setState({
      revisions: [revision()],
      revisionPreview: { revision: revision(), body: 'old' },
      backlinks: [backlink()],
    })
    api.get.mockRejectedValue(new Error('boom'))

    await useDocsStore.getState().open('doc-2')

    expect(useDocsStore.getState().revisions).toEqual([])
    expect(useDocsStore.getState().revisionPreview).toBeNull()
    expect(useDocsStore.getState().backlinks).toEqual([])
  })
})
