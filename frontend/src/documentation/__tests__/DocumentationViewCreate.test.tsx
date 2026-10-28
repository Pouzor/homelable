/**
 * #574: a page or folder created from the Library always landed at the root —
 * nothing in the UI passed a parent. Each folder now carries a `+` that files
 * the new item inside it, opens the folder so it is in sight, and opens a page
 * for writing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { documentsApi } from '@/api/client'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'
import type { Doc, DocumentSummary } from '../types'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn(),
    coverage: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    revisions: vi.fn().mockResolvedValue({ data: [] }),
    backlinks: vi.fn().mockResolvedValue({ data: [] }),
  },
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
  docsviewApi: { getConfig: vi.fn().mockResolvedValue({ data: { enabled: false, key: null } }) },
}))

const api = vi.mocked(documentsApi)
const INITIAL = useDocsStore.getState()

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'folder-1',
    kind: 'folder',
    title: 'Runbooks',
    slug: 'runbooks',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function created(overrides: Partial<Doc> = {}): Doc {
  return { ...summary({ id: 'doc-new', kind: 'page', parent_id: 'folder-1', ...overrides }), body: '' }
}

function renderView() {
  const docs = [summary()]
  api.list.mockResolvedValue({ data: docs } as never)
  api.coverage.mockResolvedValue({
    data: { devices: 0, documented: 0, header_only: 0, notes_unmigrated: 0 },
  } as never)
  useDocsStore.setState({ ...INITIAL, docs, loaded: true, openDoc: null, expanded: [] })
  render(<DocumentationView />)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useDocsStore.setState(INITIAL)
})

describe('DocumentationView — create inside a folder', () => {
  it('files a page in the folder, opens the folder and the page', async () => {
    const page = created({ title: 'Reboot the NAS' })
    api.create.mockResolvedValue({ data: page } as never)
    api.get.mockResolvedValue({ data: page } as never)
    vi.spyOn(window, 'prompt').mockReturnValue('Reboot the NAS')
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'New in Runbooks' }))
    fireEvent.click(screen.getByText('Runbook'))

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Reboot the NAS', parent_id: 'folder-1', template_id: 'runbook' }),
      ),
    )
    await waitFor(() => expect(useDocsStore.getState().expanded).toContain('folder-1'))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('doc-new'))
  })

  it('files a folder in the folder without opening it as a document', async () => {
    api.create.mockResolvedValue({ data: created({ id: 'folder-2', kind: 'folder', title: 'Storage' }) } as never)
    vi.spyOn(window, 'prompt').mockReturnValue('Storage')
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'New in Runbooks' }))
    fireEvent.click(screen.getByText('Folder'))

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Storage', kind: 'folder', parent_id: 'folder-1' }),
      ),
    )
    await waitFor(() => expect(useDocsStore.getState().expanded).toContain('folder-1'))
    expect(api.get).not.toHaveBeenCalled()
    expect(useDocsStore.getState().openDoc).toBeNull()
  })

  it('leaves the page being edited open, so its draft cannot be saved onto the new folder', async () => {
    api.create.mockResolvedValue({ data: created({ id: 'folder-2', kind: 'folder', title: 'Storage' }) } as never)
    vi.spyOn(window, 'prompt').mockReturnValue('Storage')
    renderView()
    const page = created({ id: 'page-1', title: 'Backups', parent_id: null, body: 'Old body' })
    useDocsStore.setState({ openDoc: page, draft: 'Unsaved edit' })

    fireEvent.click(screen.getByRole('button', { name: 'New in Runbooks' }))
    fireEvent.click(screen.getByText('Folder'))

    await waitFor(() => expect(api.create).toHaveBeenCalled())
    await waitFor(() => expect(useDocsStore.getState().docs.map((d) => d.id)).toContain('folder-2'))
    expect(useDocsStore.getState().openDoc?.id).toBe('page-1')
    expect(useDocsStore.getState().draft).toBe('Unsaved edit')
  })
})
