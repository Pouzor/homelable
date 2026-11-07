import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toolbar } from '../Toolbar'
import { useCanvasStore } from '@/stores/canvasStore'
import { useGitSyncStore } from '@/stores/gitSyncStore'
import type { GitSyncStatus } from '@/api/client'

vi.mock('@/stores/canvasStore')

vi.mock('@/components/ui/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}))

const props = {
  onSave: vi.fn(),
  onAutoLayout: vi.fn(),
  onExport: vi.fn(),
  onChangeStyle: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onShortcuts: vi.fn(),
  onExportYaml: vi.fn(),
  onImportYaml: vi.fn(),
  onViewOnly: vi.fn(),
}

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

function canvas(hasUnsavedChanges: boolean) {
  vi.mocked(useCanvasStore).mockReturnValue({
    hasUnsavedChanges,
    past: [],
    future: [],
  } as unknown as ReturnType<typeof useCanvasStore>)
}

describe('Toolbar — git Sync button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canvas(false)
    useGitSyncStore.setState({ status: null, syncing: false, sync })
  })

  it('is hidden until the server says git sync is configured', () => {
    render(<Toolbar {...props} />)
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull()
  })

  it('is hidden when GIT_SYNC_REPO_URL is not set', () => {
    useGitSyncStore.setState({ status: { ...STATUS, configured: false } })
    render(<Toolbar {...props} />)
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull()
  })

  it('runs a sync when configured', () => {
    useGitSyncStore.setState({ status: STATUS })
    render(<Toolbar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: false })
  })

  it('tells the sync the canvas has unsaved edits', () => {
    canvas(true)
    useGitSyncStore.setState({ status: STATUS })
    render(<Toolbar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(sync).toHaveBeenCalledWith({ unsaved: true })
  })

  it('is disabled while a sync runs', () => {
    useGitSyncStore.setState({ status: STATUS, syncing: true })
    render(<Toolbar {...props} />)
    expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  })
})
