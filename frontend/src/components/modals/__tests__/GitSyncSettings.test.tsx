import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { GitSyncStatus } from '@/api/client'
import { useGitSyncStore } from '@/stores/gitSyncStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useDesignStore } from '@/stores/designStore'
import { GitSyncSettings } from '../GitSyncSettings'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())

const STATUS: GitSyncStatus = {
  configured: true,
  repo_url: 'https://git.example.com/lab.git',
  branch: 'main',
  path: 'docs/homelable',
  auth: 'ssh',
  running: false,
  last: null,
}

const load = vi.fn(async () => {})
const sync = vi.fn(async () => null)

function setup(status: GitSyncStatus | null, syncing = false) {
  useGitSyncStore.setState({ status, syncing, load, sync })
  return render(<GitSyncSettings />)
}

beforeEach(() => {
  vi.clearAllMocks()
  useCanvasStore.setState({ hasUnsavedChanges: false })
  useDesignStore.setState({ activeDesignType: 'network' })
})

describe('GitSyncSettings', () => {
  it('loads the status when it opens', () => {
    setup(STATUS)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('explains the .env keys when no repository is configured', () => {
    setup({ ...STATUS, configured: false })
    expect(screen.getByText(/No repository configured/)).toBeInTheDocument()
    expect(screen.getByText('GIT_SYNC_REPO_URL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })

  it('treats an unknown status as not configured', () => {
    setup(null)
    expect(screen.getByText(/No repository configured/)).toBeInTheDocument()
  })

  it('shows where the sync pushes', () => {
    setup(STATUS)
    expect(screen.getByText('https://git.example.com/lab.git')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('docs/homelable')).toBeInTheDocument()
    expect(screen.getByText('SSH key')).toBeInTheDocument()
  })

  it('names the repository root when no folder is set', () => {
    setup({ ...STATUS, path: '' })
    expect(screen.getByText('/ (repository root)')).toBeInTheDocument()
  })

  it('shows the last push', () => {
    setup({
      ...STATUS,
      last: { status: 'pushed', at: new Date().toISOString(), commit: 'abcdef123456', files_changed: 4, error: null },
    })
    expect(screen.getByRole('status')).toHaveTextContent('pushed 4 file(s)')
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
  })

  it('shows why the last sync failed', () => {
    setup({
      ...STATUS,
      last: { status: 'failed', at: new Date().toISOString(), commit: null, files_changed: 0, error: 'auth denied' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('auth denied')
  })

  it('runs a sync, flagging unsaved canvas edits', () => {
    useCanvasStore.setState({ hasUnsavedChanges: true })
    setup(STATUS)
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: true })
  })

  it('disables the button while a sync runs', () => {
    setup(STATUS, true)
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  })

  it('disables the button while the server reports a sync running', () => {
    setup({ ...STATUS, running: true })
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  })
})
