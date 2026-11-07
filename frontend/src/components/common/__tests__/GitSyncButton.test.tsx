import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { GitSyncStatus } from '@/api/client'
import { useGitSyncStore } from '@/stores/gitSyncStore'
import { GitSyncButton } from '../GitSyncButton'

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
  useGitSyncStore.setState({ status: STATUS, syncing: false, sync })
})

describe('GitSyncButton', () => {
  it('renders nothing until git sync is configured', () => {
    useGitSyncStore.setState({ status: null })
    const { container } = render(<GitSyncButton unsaved={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says what holds the unsaved edits', () => {
    render(<GitSyncButton unsaved subject="document" />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: true, subject: 'document' })
  })

  it('leaves the subject to the store default for the canvas', () => {
    render(<GitSyncButton unsaved={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: false })
  })

  // A sync started from another tab or browser holds the server lock: a click
  // here would only come back as a 409.
  it('is disabled while the server reports a sync running', () => {
    useGitSyncStore.setState({ status: { ...STATUS, running: true } })
    render(<GitSyncButton unsaved={false} />)
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  })
})
