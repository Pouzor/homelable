import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toast } from 'sonner'
import { gitSyncApi, type GitSyncStatus, type GitSyncResult } from '@/api/client'
import { useGitSyncStore } from '../gitSyncStore'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/api/client', () => ({
  gitSyncApi: { status: vi.fn(), sync: vi.fn() },
}))

const STATUS: GitSyncStatus = {
  configured: true,
  repo_url: 'https://git.example.com/lab.git',
  branch: 'main',
  path: 'docs',
  auth: 'token',
  running: false,
  last: null,
}

const PUSHED: GitSyncResult = {
  status: 'pushed',
  commit: 'abcdef1234567890',
  files_changed: 3,
  documents: 2,
  diagrams: 1,
  synced_at: '2026-11-03T10:00:00Z',
}

const ok = <T,>(data: T) => ({ data }) as never

beforeEach(() => {
  vi.clearAllMocks()
  useGitSyncStore.setState({ status: null, syncing: false })
  vi.mocked(gitSyncApi.status).mockResolvedValue(ok(STATUS))
})

describe('gitSyncStore.load', () => {
  it('stores what the server reports', async () => {
    await useGitSyncStore.getState().load()
    expect(useGitSyncStore.getState().status).toEqual(STATUS)
  })

  it('falls back to unknown when the server cannot say', async () => {
    useGitSyncStore.setState({ status: STATUS })
    vi.mocked(gitSyncApi.status).mockRejectedValue(new Error('404'))
    await useGitSyncStore.getState().load()
    expect(useGitSyncStore.getState().status).toBeNull()
  })
})

describe('gitSyncStore.sync', () => {
  it('toasts what was pushed and the short commit', async () => {
    vi.mocked(gitSyncApi.sync).mockResolvedValue(ok(PUSHED))
    const result = await useGitSyncStore.getState().sync()
    expect(result).toEqual(PUSHED)
    expect(toast.success).toHaveBeenCalledWith('Pushed 2 document(s) and 1 diagram(s) — abcdef1.')
    expect(useGitSyncStore.getState().syncing).toBe(false)
  })

  it('says so when there was nothing new to push', async () => {
    vi.mocked(gitSyncApi.sync).mockResolvedValue(ok({ ...PUSHED, status: 'unchanged', files_changed: 0 }))
    await useGitSyncStore.getState().sync()
    expect(toast.info).toHaveBeenCalledWith('Git is already up to date.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('warns that unsaved canvas edits were not pushed', async () => {
    vi.mocked(gitSyncApi.sync).mockResolvedValue(ok(PUSHED))
    await useGitSyncStore.getState().sync({ unsaved: true })
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('Unsaved changes on this canvas were not included')
  })

  it('shows the server error detail on failure', async () => {
    vi.mocked(gitSyncApi.sync).mockRejectedValue({ response: { data: { detail: 'Git sync failed: denied' } } })
    const result = await useGitSyncStore.getState().sync()
    expect(result).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('Git sync failed: denied')
    expect(useGitSyncStore.getState().syncing).toBe(false)
  })

  it('falls back to a generic message when there is no detail', async () => {
    vi.mocked(gitSyncApi.sync).mockRejectedValue(new Error('network'))
    await useGitSyncStore.getState().sync()
    expect(toast.error).toHaveBeenCalledWith('Git sync failed')
  })

  it('reloads the status after a sync, failed or not', async () => {
    vi.mocked(gitSyncApi.sync).mockRejectedValue(new Error('network'))
    await useGitSyncStore.getState().sync()
    await vi.waitFor(() => expect(gitSyncApi.status).toHaveBeenCalledTimes(1))
  })

  it('ignores a second sync while one is running', async () => {
    useGitSyncStore.setState({ syncing: true })
    const result = await useGitSyncStore.getState().sync()
    expect(result).toBeNull()
    expect(gitSyncApi.sync).not.toHaveBeenCalled()
  })

  it('is marked syncing while the request runs', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(gitSyncApi.sync).mockReturnValue(new Promise((r) => { resolve = r }) as never)
    const pending = useGitSyncStore.getState().sync()
    expect(useGitSyncStore.getState().syncing).toBe(true)
    resolve(ok(PUSHED))
    await pending
    expect(useGitSyncStore.getState().syncing).toBe(false)
  })
})
