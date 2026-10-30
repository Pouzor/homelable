import { beforeEach, describe, expect, it, vi } from 'vitest'

import { documentsApi } from '@/api/client'
import { useDocsStore } from '../store'
import type { Doc, DocumentSummary } from '../types'

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    backlinks: vi.fn(),
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
  return { ...summary(), body: 'body', ...overrides } as Doc
}

const INITIAL = useDocsStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.backlinks.mockResolvedValue({ data: [] } as never)
  useDocsStore.setState({ ...INITIAL, docs: [], loaded: false, openDoc: null, openLoading: false, draft: null, dirty: false, loadError: null })
})

describe('openHome', () => {
  const home = summary({ id: 'home', title: 'Home', is_homepage: true })

  it('opens the homepage when nothing is open', async () => {
    useDocsStore.setState({ docs: [summary(), home], loaded: true })
    api.get.mockResolvedValue({ data: doc({ id: 'home', is_homepage: true }) } as never)

    expect(await useDocsStore.getState().openHome()).toBe(true)
    expect(api.get).toHaveBeenCalledWith('home')
    expect(useDocsStore.getState().openDoc?.id).toBe('home')
  })

  it('fetches the listing first when the section was never opened', async () => {
    api.list.mockResolvedValue({ data: [home] } as never)
    api.get.mockResolvedValue({ data: doc({ id: 'home', is_homepage: true }) } as never)

    expect(await useDocsStore.getState().openHome()).toBe(true)
    expect(api.list).toHaveBeenCalled()
    expect(useDocsStore.getState().openDoc?.id).toBe('home')
  })

  it('opens nothing when there is no homepage', async () => {
    useDocsStore.setState({ docs: [summary()], loaded: true })

    expect(await useDocsStore.getState().openHome()).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
    expect(useDocsStore.getState().openDoc).toBeNull()
  })

  it('replaces the document left open on a previous visit', async () => {
    useDocsStore.setState({ docs: [summary(), home], loaded: true, openDoc: doc() })
    api.get.mockResolvedValue({ data: doc({ id: 'home', is_homepage: true }) } as never)

    expect(await useDocsStore.getState().openHome()).toBe(true)
    expect(api.get).toHaveBeenCalledWith('home')
    expect(useDocsStore.getState().openDoc?.id).toBe('home')
  })

  it('keeps a document with unsaved edits', async () => {
    useDocsStore.setState({ docs: [summary(), home], loaded: true, openDoc: doc(), draft: 'edited', dirty: true })

    expect(await useDocsStore.getState().openHome()).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
    expect(useDocsStore.getState().openDoc?.id).toBe('doc-1')
    expect(useDocsStore.getState().draft).toBe('edited')
  })

  it('does not refetch the homepage when it is already open', async () => {
    useDocsStore.setState({ docs: [home], loaded: true, openDoc: doc({ id: 'home', is_homepage: true }) })

    expect(await useDocsStore.getState().openHome()).toBe(true)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('does not race a document that is already opening', async () => {
    useDocsStore.setState({ docs: [home], loaded: true, openLoading: true })

    expect(await useDocsStore.getState().openHome()).toBe(false)
    expect(api.get).not.toHaveBeenCalled()
  })
})

describe('setHomepage', () => {
  it('moves the flag onto the new page and off every other', async () => {
    useDocsStore.setState({
      docs: [summary({ id: 'old', is_homepage: true }), summary({ id: 'new' })],
      openDoc: doc({ id: 'new' }),
    })
    api.update.mockResolvedValue({ data: doc({ id: 'new', is_homepage: true }) } as never)

    expect(await useDocsStore.getState().setHomepage('new')).toBe(true)
    expect(api.update).toHaveBeenCalledWith('new', { is_homepage: true })
    const { docs, openDoc } = useDocsStore.getState()
    expect(docs.filter((d) => d.is_homepage).map((d) => d.id)).toEqual(['new'])
    expect(openDoc?.is_homepage).toBe(true)
  })

  it('clears the flag on an open document that lost it', async () => {
    useDocsStore.setState({
      docs: [summary({ id: 'old', is_homepage: true }), summary({ id: 'new' })],
      openDoc: doc({ id: 'old', is_homepage: true }),
    })
    api.update.mockResolvedValue({ data: doc({ id: 'new', is_homepage: true }) } as never)

    await useDocsStore.getState().setHomepage('new')
    expect(useDocsStore.getState().openDoc?.is_homepage).toBe(false)
  })

  it('surfaces the server message and changes nothing on failure', async () => {
    useDocsStore.setState({ docs: [summary({ id: 'old', is_homepage: true }), summary({ id: 'f', kind: 'folder' })] })
    api.update.mockRejectedValue({ response: { data: { detail: 'Only a page can be the homepage' } } })

    expect(await useDocsStore.getState().setHomepage('f')).toBe(false)
    expect(useDocsStore.getState().loadError).toBe('Only a page can be the homepage')
    expect(useDocsStore.getState().docs.find((d) => d.id === 'old')?.is_homepage).toBe(true)
  })
})
