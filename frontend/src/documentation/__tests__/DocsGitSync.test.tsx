/**
 * The git Sync button in the Documentation footer — the canvas header's twin,
 * so a sync is reachable without leaving the documentation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { GitSyncStatus } from '@/api/client'
import { useGitSyncStore } from '@/stores/gitSyncStore'
import { DocumentationView } from '../components/DocumentationView'
import { useDocsStore } from '../store'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

vi.mock('@/api/client', () => ({
  documentsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    coverage: vi.fn().mockResolvedValue({
      data: { devices: 0, documented: 0, header_only: 0, notes_unmigrated: 0 },
    }),
    export: vi.fn(),
  },
  scanApi: {
    pending: vi.fn().mockResolvedValue({ data: [] }),
    getConfig: vi.fn().mockResolvedValue({ data: { ranges: [] } }),
  },
  docsviewApi: { getConfig: vi.fn().mockResolvedValue({ data: { enabled: false, key: null } }) },
  gitSyncApi: { status: vi.fn(), sync: vi.fn() },
}))

const STATUS: GitSyncStatus = {
  configured: true,
  repo_url: 'https://git.example.com/lab.git',
  branch: 'main',
  path: '',
  auth: 'token',
  running: false,
  last: null,
}

const sync = vi.fn(async () => null)

beforeEach(() => {
  vi.clearAllMocks()
  useGitSyncStore.setState({ status: null, syncing: false, sync })
  useDocsStore.setState({ docs: [], loaded: false, openDoc: null, filter: '' })
})

afterEach(cleanup)

async function renderView() {
  render(<DocumentationView />)
  await waitFor(() => expect(useDocsStore.getState().loaded).toBe(true))
}

describe('the Documentation Sync button', () => {
  it('is not offered while git sync is not configured', async () => {
    await renderView()
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument()
  })

  it('runs a sync from the documentation', async () => {
    useGitSyncStore.setState({ status: STATUS })
    await renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: false, subject: 'document' })
  })

  it('flags an open document with unsaved edits', async () => {
    useGitSyncStore.setState({ status: STATUS })
    await renderView()
    useDocsStore.setState({ dirty: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: true, subject: 'document' })
  })

  it('is disabled while a sync runs', async () => {
    useGitSyncStore.setState({ status: STATUS, syncing: true })
    await renderView()
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  })
})
