/**
 * The Export all button in the Documentation layout.
 *
 * It is the only control in the view that acts on the whole space rather than
 * the open document, so it lives in the tree footer and has to stay usable with
 * no document selected — and unusable when there is nothing to export.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { documentsApi } from '@/api/client'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'
import type { DocumentSummary } from '../types'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    coverage: vi.fn().mockResolvedValue({
      data: { devices: 0, documented: 0, header_only: 0, notes_unmigrated: 0 },
    }),
    export: vi.fn(),
  },
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
}))

const exportAll = vi.mocked(documentsApi.export)
const listDocs = vi.mocked(documentsApi.list)

function summary(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: 'doc-1',
    kind: 'page',
    title: 'VLAN plan',
    slug: 'vlan-plan',
    sort_order: 0,
    tags: [],
    frontmatter: {},
    starred: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as DocumentSummary
}

let clicks = 0
let savedName: string | null = null

beforeEach(() => {
  clicks = 0
  savedName = null
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zip')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks += 1
    savedName = this.download
  })
  useDocsStore.setState({ docs: [], loaded: false, openDoc: null, filter: '' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** The view loads the tree itself on mount, so the docs come from the server. */
async function renderView(docs: DocumentSummary[]) {
  listDocs.mockResolvedValue({ data: docs } as never)
  render(<DocumentationView />)
  await waitFor(() => expect(useDocsStore.getState().loaded).toBe(true))
  return screen.getByText(/Export all|Exporting/).closest('button') as HTMLButtonElement
}

describe('Export all', () => {
  it('is offered with no document open', async () => {
    const button = await renderView([summary()])
    expect(button).toBeEnabled()
    expect(useDocsStore.getState().openDoc).toBeNull()
  })

  it('is disabled while there is nothing written down', async () => {
    expect(await renderView([])).toBeDisabled()
  })

  it('saves the archive the server returns', async () => {
    exportAll.mockResolvedValue({
      data: new Blob(['PK']),
      headers: { 'content-disposition': 'attachment; filename="homelable-documentation-20260909.zip"' },
    } as never)

    fireEvent.click(await renderView([summary()]))

    await waitFor(() => expect(clicks).toBe(1))
    expect(savedName).toBe('homelable-documentation-20260909.zip')
  })

  // The request is a server round trip on every document body — a second click
  // mid-flight would download the same archive twice.
  it('cannot be fired again while it is running', async () => {
    let release: (value: unknown) => void = () => {}
    exportAll.mockReturnValue(new Promise((resolve) => {
      release = resolve
    }) as never)

    const button = await renderView([summary()])
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByText('Exporting…')).toBeInTheDocument()

    release({ data: new Blob(['PK']), headers: {} })
    await waitFor(() => expect(exportAll).toHaveBeenCalledTimes(1))
  })

  it('says so and stays usable when the export fails', async () => {
    exportAll.mockRejectedValue(new Error('500'))
    const { toast } = await import('sonner')

    const button = await renderView([summary()])
    fireEvent.click(button)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not export the documentation'))
    expect(clicks).toBe(0)
    await waitFor(() => expect(button).toBeEnabled())
  })
})
