/**
 * The read-only documentation link, offered in the Documentation footer.
 *
 * The key lives in `.env` and is admin-only, so the app has to ask the server
 * for it: with the feature off there is no button at all, and with it on the
 * button has to hand over a link a reader can actually open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { docsviewApi } from '@/api/client'
import { copyToClipboard } from '@/utils/clipboard'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn() }))

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    coverage: vi.fn().mockResolvedValue({
      data: { devices: 0, documented: 0, header_only: 0, notes_unmigrated: 0 },
    }),
    export: vi.fn(),
  },
  scanApi: { pending: vi.fn().mockResolvedValue({ data: [] }) },
  docsviewApi: { getConfig: vi.fn() },
}))

const getConfig = vi.mocked(docsviewApi.getConfig)
const copy = vi.mocked(copyToClipboard)

beforeEach(() => {
  vi.clearAllMocks()
  copy.mockResolvedValue(true)
  useDocsStore.setState({ docs: [], loaded: false, openDoc: null, filter: '' })
})

afterEach(cleanup)

async function renderView() {
  render(<DocumentationView />)
  await waitFor(() => expect(useDocsStore.getState().loaded).toBe(true))
}

describe('the read-only documentation link', () => {
  it('is not offered while DOCS_VIEW_KEY is unset', async () => {
    getConfig.mockResolvedValue({ data: { enabled: false, key: null } } as never)
    await renderView()

    await waitFor(() => expect(getConfig).toHaveBeenCalled())
    expect(screen.queryByText('Share link')).not.toBeInTheDocument()
  })

  it('copies the link a reader opens, key and all', async () => {
    getConfig.mockResolvedValue({ data: { enabled: true, key: 'a key' } } as never)
    await renderView()

    fireEvent.click(await screen.findByText('Share link'))

    // The key is escaped: it is whatever the admin typed into .env.
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(`${window.location.origin}/docs?key=a%20key`),
    )
    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalledWith('Read-only link copied')
  })

  it('says so when the clipboard refuses', async () => {
    getConfig.mockResolvedValue({ data: { enabled: true, key: 'a-key' } } as never)
    copy.mockResolvedValue(false)
    await renderView()

    fireEvent.click(await screen.findByText('Share link'))

    const { toast } = await import('sonner')
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not copy the link'))
  })

  // The section has to keep working for the logged-in user whatever this
  // answers: it is a footer button, not a precondition.
  it('stays quiet when the server cannot be asked', async () => {
    getConfig.mockRejectedValue(new Error('500'))
    await renderView()

    await waitFor(() => expect(getConfig).toHaveBeenCalled())
    expect(screen.queryByText('Share link')).not.toBeInTheDocument()
    expect(screen.getByText(/Export all|Exporting/)).toBeInTheDocument()
  })
})
