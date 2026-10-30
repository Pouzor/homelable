/**
 * The homepage: the page Documentation opens on, set from the viewer's header,
 * confirmed when it replaces another, marked with a house in the Library, and
 * nudged for by a banner while there is none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { documentsApi } from '@/api/client'
import { DocTreeItem } from '../components/DocTree'
import { DocViewer } from '../components/DocViewer'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'
import type { Doc, DocumentSummary } from '../types'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn(),
    coverage: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    backlinks: vi.fn().mockResolvedValue({ data: [] }),
  },
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
  docsviewApi: { getConfig: vi.fn().mockResolvedValue({ data: { enabled: false, key: null } }) },
}))

const api = vi.mocked(documentsApi)
const INITIAL = useDocsStore.getState()

function doc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'VLAN plan',
    slug: 'vlan-plan',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    is_homepage: false,
    body: '# VLAN plan',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderView(docs: Doc[], openDoc: Doc | null) {
  api.list.mockResolvedValue({ data: docs as DocumentSummary[] } as never)
  api.coverage.mockResolvedValue({
    data: { devices: 0, documented: 0, header_only: 0, notes_unmigrated: 0 },
  } as never)
  useDocsStore.setState({ ...INITIAL, docs, loaded: true, openDoc, loadError: null })
  render(<DocumentationView />)
}

const BANNER = /don.t seem to have a homepage yet/i

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => cleanup())

describe('DocumentationView — homepage', () => {
  it('shows the no-homepage banner when no page is the homepage', async () => {
    renderView([doc()], null)
    expect(await screen.findByText(BANNER)).toBeInTheDocument()
  })

  it('hides the banner once a homepage exists', async () => {
    renderView([doc({ is_homepage: true })], null)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('sets the first homepage without asking', async () => {
    const page = doc()
    api.update.mockResolvedValue({ data: { ...page, is_homepage: true } } as never)
    renderView([page], page)

    fireEvent.click(screen.getByRole('button', { name: 'Set as homepage' }))

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('doc-1', { is_homepage: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull())
  })

  it('asks before replacing the current homepage, and only sets it on confirm', async () => {
    const home = doc({ id: 'home', title: 'Welcome', is_homepage: true })
    const page = doc()
    api.update.mockResolvedValue({ data: { ...page, is_homepage: true } } as never)
    renderView([home, page], page)

    fireEvent.click(screen.getByRole('button', { name: 'Set as homepage' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('“Welcome” is the homepage now')
    expect(api.update).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set as homepage' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('doc-1', { is_homepage: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const flagged = useDocsStore.getState().docs.filter((d) => d.is_homepage).map((d) => d.id)
    expect(flagged).toEqual(['doc-1'])
  })

  it('leaves the homepage alone when the replacement is cancelled', async () => {
    const home = doc({ id: 'home', title: 'Welcome', is_homepage: true })
    const page = doc()
    renderView([home, page], page)

    fireEvent.click(screen.getByRole('button', { name: 'Set as homepage' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.update).not.toHaveBeenCalled()
  })

  it('creates a homepage from the banner and opens it', async () => {
    const created = doc({ id: 'new-home', title: 'Home' })
    api.create.mockResolvedValue({ data: created } as never)
    api.update.mockResolvedValue({ data: { ...created, is_homepage: true } } as never)
    api.get.mockResolvedValue({ data: { ...created, is_homepage: true } } as never)
    renderView([doc()], null)

    fireEvent.click(await screen.findByRole('button', { name: 'Create homepage' }))

    await waitFor(() => expect(api.update).toHaveBeenCalledWith('new-home', { is_homepage: true }))
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Home' }))
    await waitFor(() => expect(useDocsStore.getState().openDoc?.id).toBe('new-home'))
  })
})

describe('DocViewer — homepage button', () => {
  const props = {
    docs: [],
    devices: [],
    drifted: false,
    onDownload: vi.fn(),
    onOpenDoc: vi.fn(),
  }

  it('offers it on a page', () => {
    const onSetHomepage = vi.fn()
    render(<DocViewer {...props} doc={doc()} onSetHomepage={onSetHomepage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set as homepage' }))
    expect(onSetHomepage).toHaveBeenCalledTimes(1)
  })

  it('shows the homepage as such, without offering it again', () => {
    render(<DocViewer {...props} doc={doc({ is_homepage: true })} onSetHomepage={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'This page is the homepage' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('is not offered on a device document or a folder', () => {
    render(<DocViewer {...props} doc={doc({ kind: 'device', device_id: 'dev-1' })} onSetHomepage={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Set as homepage' })).toBeNull()
    cleanup()
    render(<DocViewer {...props} doc={doc({ kind: 'folder' })} onSetHomepage={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Set as homepage' })).toBeNull()
  })

  it('is not offered read-only', () => {
    render(<DocViewer {...props} readOnly doc={doc()} onSetHomepage={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Set as homepage' })).toBeNull()
  })
})

describe('DocTreeItem — homepage icon', () => {
  const base = {
    depth: 1,
    activeId: null,
    expanded: [],
    starred: new Set<string>(),
    onSelect: vi.fn(),
    onToggle: vi.fn(),
  }
  const page = { id: 'doc-1', label: 'VLAN plan', kind: 'page' as const, docId: 'doc-1', state: 'written' as const }

  it('marks the homepage with a house', () => {
    render(<DocTreeItem {...base} leaf={page} homeId="doc-1" />)
    expect(screen.getByLabelText('Homepage')).toBeInTheDocument()
  })

  it('leaves every other page unmarked', () => {
    render(<DocTreeItem {...base} leaf={page} homeId="other" />)
    expect(screen.queryByLabelText('Homepage')).toBeNull()
  })
})
