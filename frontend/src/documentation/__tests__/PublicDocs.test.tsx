/**
 * The page served at `/docs?key=…`.
 *
 * It boots with no session, so every test here renders it exactly as a reader
 * gets it: a URL, and whatever the public endpoints answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { docsviewApi } from '@/api/client'
import PublicDocs from '../components/PublicDocs'
import { usePublicDocsStore } from '../publicStore'
import type { Doc, DocumentSummary } from '../types'

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

const INITIAL = usePublicDocsStore.getState()

function visit(search: string) {
  window.history.replaceState({}, '', `/docs${search}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  usePublicDocsStore.setState({ ...INITIAL })
  visit('?key=the-key')
})

describe('PublicDocs — the link itself', () => {
  it('asks for nothing when the URL carries no key', () => {
    visit('')
    render(<PublicDocs />)

    expect(screen.getByText('This link is missing its key')).toBeInTheDocument()
    expect(api.tree).not.toHaveBeenCalled()
  })

  it('says what the server said when the key is refused', async () => {
    api.tree.mockReturnValue(
      Promise.reject({ response: { data: { detail: 'Invalid documentation view key' } } }) as never,
    )
    render(<PublicDocs />)

    expect(await screen.findByText('Invalid documentation view key')).toBeInTheDocument()
  })

  it('keeps the page out of search engines', async () => {
    api.tree.mockResolvedValue({ data: [] } as never)
    render(<PublicDocs />)

    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain(
        'noindex',
      ),
    )
  })
})

describe('PublicDocs — the tree', () => {
  it('renders the Library and the linked documents from one call', async () => {
    api.tree.mockResolvedValue({
      data: [
        summary({ id: 'doc-1', title: 'Offsite backups' }),
        summary({ id: 'doc-2', kind: 'device', title: 'nas-01' }),
      ],
    } as never)
    render(<PublicDocs />)

    expect(await screen.findByText('Offsite backups')).toBeInTheDocument()
    expect(screen.getByText('nas-01')).toBeInTheDocument()
    expect(api.tree).toHaveBeenCalledWith('the-key')
  })

  it('narrows to what the filter matches', async () => {
    api.tree.mockResolvedValue({
      data: [
        summary({ id: 'doc-1', title: 'Offsite backups' }),
        summary({ id: 'doc-2', title: 'Where mail is hosted' }),
      ],
    } as never)
    render(<PublicDocs />)
    await screen.findByText('Offsite backups')

    fireEvent.change(screen.getByLabelText('Filter documents'), { target: { value: 'mail' } })

    expect(screen.getByText('Where mail is hosted')).toBeInTheDocument()
    expect(screen.queryByText('Offsite backups')).not.toBeInTheDocument()
  })

  // Every other pivot the app offers reads the inventory, the canvas or the
  // racks — none of which this page is given.
  it('offers only the two pivots a document can answer by itself', async () => {
    api.tree.mockResolvedValue({ data: [summary()] } as never)
    render(<PublicDocs />)
    await screen.findByText('Offsite backups')

    const options = Array.from(
      screen.getByLabelText('Group by').querySelectorAll('option'),
    ).map((option) => option.textContent)
    expect(options).toEqual(['A–Z', 'Tag'])
  })
})

describe('PublicDocs — reading a document', () => {
  function doc(overrides: Partial<Doc> = {}): Doc {
    return { ...summary(), body: '# Offsite backups\n\nThey are in the shed.\n', ...overrides } as Doc
  }

  it('opens the one that was clicked and puts it in the URL', async () => {
    api.tree.mockResolvedValue({ data: [summary()] } as never)
    api.get.mockResolvedValue({ data: doc() } as never)
    render(<PublicDocs />)

    fireEvent.click(await screen.findByText('Offsite backups'))

    expect(await screen.findByText('They are in the shed.')).toBeInTheDocument()
    expect(window.location.search).toContain('doc=doc-1')
  })

  it('opens the document named in the URL on arrival', async () => {
    visit('?key=the-key&doc=doc-1')
    api.tree.mockResolvedValue({ data: [summary()] } as never)
    api.get.mockResolvedValue({ data: doc() } as never)
    render(<PublicDocs />)

    expect(await screen.findByText('They are in the shed.')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('the-key', 'doc-1')
  })

  it('renders it read-only — nothing on the page writes', async () => {
    api.tree.mockResolvedValue({ data: [summary({ tags: ['prod'] })] } as never)
    api.get.mockResolvedValue({ data: doc({ tags: ['prod'] }) } as never)
    render(<PublicDocs />)
    fireEvent.click(await screen.findByText('Offsite backups'))
    await screen.findByText('They are in the shed.')

    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete this document')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Regenerate this document')).not.toBeInTheDocument()
    // The pivot's "Tag" option is a different thing with the same word on it.
    expect(screen.queryByRole('button', { name: 'Tag' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Remove tag prod')).not.toBeInTheDocument()
  })
})
