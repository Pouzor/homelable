/**
 * The store behind `/docs?key=…`.
 *
 * Its whole reason for existing apart from `useDocsStore` is that it cannot
 * write, so that is asserted here as plainly as the behaviour is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { docsviewApi } from '@/api/client'
import { usePublicDocsStore } from '../publicStore'
import type { Doc, DocRevision, DocumentSummary } from '../types'

vi.mock('@/api/client', () => ({
  docsviewApi: {
    tree: vi.fn(),
    get: vi.fn(),
    revisions: vi.fn(),
    revision: vi.fn(),
    getConfig: vi.fn(),
  },
}))

const api = vi.mocked(docsviewApi)

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'Offsite backups',
    slug: 'offsite-backups',
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
  return { ...summary(), body: 'the body', ...overrides } as Doc
}

function revision(overrides: Partial<DocRevision> = {}): DocRevision {
  return {
    id: 'rev-1',
    document_id: 'doc-1',
    title: 'Offsite backups',
    reason: 'edit',
    saved_at: '2026-01-01T00:00:00Z',
    size: 12,
    ...overrides,
  }
}

/** A rejected axios call, shaped the way the store reads a detail out of it. */
function refused(detail: string) {
  return Promise.reject({ response: { data: { detail } } })
}

const INITIAL = usePublicDocsStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  usePublicDocsStore.setState({ ...INITIAL })
})

describe('publicStore — loading the tree', () => {
  it('keeps the key it was given and the documents it was answered', async () => {
    api.tree.mockResolvedValue({ data: [summary()] } as never)
    await usePublicDocsStore.getState().load('the-key')

    expect(api.tree).toHaveBeenCalledWith('the-key')
    const state = usePublicDocsStore.getState()
    expect(state.key).toBe('the-key')
    expect(state.docs).toHaveLength(1)
    expect(state.loaded).toBe(true)
    expect(state.error).toBeNull()
  })

  it('surfaces what the server said when the key is refused', async () => {
    api.tree.mockReturnValue(refused('Invalid documentation view key') as never)
    await usePublicDocsStore.getState().load('wrong')

    const state = usePublicDocsStore.getState()
    expect(state.error).toBe('Invalid documentation view key')
    expect(state.docs).toEqual([])
    expect(state.loaded).toBe(true)
  })

  it('falls back to its own words when the server says nothing useful', async () => {
    api.tree.mockReturnValue(Promise.reject(new Error('network')) as never)
    await usePublicDocsStore.getState().load('the-key')
    expect(usePublicDocsStore.getState().error).toBe('Could not load the documentation')
  })
})

describe('publicStore — opening a document', () => {
  it('replays the key and stores the body', async () => {
    api.tree.mockResolvedValue({ data: [summary()] } as never)
    api.get.mockResolvedValue({ data: doc() } as never)
    await usePublicDocsStore.getState().load('the-key')
    await usePublicDocsStore.getState().open('doc-1')

    expect(api.get).toHaveBeenCalledWith('the-key', 'doc-1')
    expect(usePublicDocsStore.getState().openDoc?.body).toBe('the body')
  })

  it('leaves the previous document’s history behind', async () => {
    api.get.mockResolvedValue({ data: doc({ id: 'doc-2' }) } as never)
    usePublicDocsStore.setState({
      historyOpen: true,
      revisions: [revision()],
      revisionPreview: { revision: revision(), body: 'older' },
    })

    await usePublicDocsStore.getState().open('doc-2')

    const state = usePublicDocsStore.getState()
    expect(state.historyOpen).toBe(false)
    expect(state.revisions).toEqual([])
    expect(state.revisionPreview).toBeNull()
  })
})

describe('publicStore — history', () => {
  it('loads the revisions when the rail is opened', async () => {
    api.revisions.mockResolvedValue({ data: [revision()] } as never)
    usePublicDocsStore.setState({ key: 'the-key', openDoc: doc() })

    await usePublicDocsStore.getState().toggleHistory()

    expect(api.revisions).toHaveBeenCalledWith('the-key', 'doc-1')
    expect(usePublicDocsStore.getState().revisions).toHaveLength(1)
    expect(usePublicDocsStore.getState().historyOpen).toBe(true)
  })

  it('closing the rail drops the version being read', async () => {
    usePublicDocsStore.setState({
      historyOpen: true,
      revisionPreview: { revision: revision(), body: 'older' },
    })
    await usePublicDocsStore.getState().toggleHistory()

    expect(usePublicDocsStore.getState().historyOpen).toBe(false)
    expect(usePublicDocsStore.getState().revisionPreview).toBeNull()
  })

  it('keeps the document on screen when its history cannot be read', async () => {
    api.revisions.mockReturnValue(Promise.reject(new Error('nope')) as never)
    usePublicDocsStore.setState({ key: 'the-key', openDoc: doc() })

    await usePublicDocsStore.getState().toggleHistory()

    const state = usePublicDocsStore.getState()
    expect(state.revisions).toEqual([])
    expect(state.revisionsLoading).toBe(false)
    expect(state.openDoc).not.toBeNull()
    expect(state.error).toBeNull()
  })

  it('previews a listed revision', async () => {
    api.revision.mockResolvedValue({ data: { ...revision(), body: 'an older body' } } as never)
    usePublicDocsStore.setState({ key: 'the-key', revisions: [revision()] })

    await usePublicDocsStore.getState().previewRevision('rev-1')

    expect(api.revision).toHaveBeenCalledWith('the-key', 'rev-1')
    expect(usePublicDocsStore.getState().revisionPreview?.body).toBe('an older body')
  })

  it('ignores a revision it never listed', async () => {
    usePublicDocsStore.setState({ key: 'the-key', revisions: [] })
    await usePublicDocsStore.getState().previewRevision('rev-9')
    expect(api.revision).not.toHaveBeenCalled()
  })
})

describe('publicStore — view preferences', () => {
  it('holds the filter, the pivot and the expanded keys', () => {
    const store = usePublicDocsStore.getState()
    store.setFilter('backup')
    store.setGroupBy('tag')
    store.toggleExpanded('collapsed:tag:prod')
    expect(usePublicDocsStore.getState().filter).toBe('backup')
    expect(usePublicDocsStore.getState().groupBy).toBe('tag')
    expect(usePublicDocsStore.getState().expanded).toEqual(['collapsed:tag:prod'])

    usePublicDocsStore.getState().toggleExpanded('collapsed:tag:prod')
    expect(usePublicDocsStore.getState().expanded).toEqual([])
  })
})

describe('publicStore — cannot write', () => {
  // The separation from `useDocsStore` is the security property, so it is a
  // test rather than a comment: nothing here can save, delete or restore.
  it('exposes no action that changes a document', () => {
    const state = usePublicDocsStore.getState() as Record<string, unknown>
    for (const action of [
      'save',
      'create',
      'remove',
      'delete',
      'move',
      'rename',
      'setTags',
      'toggleStar',
      'markReviewed',
      'regenerate',
      'restore',
      'scaffold',
      'setDraft',
    ]) {
      expect(state[action]).toBeUndefined()
    }
  })
})
