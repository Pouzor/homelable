import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toast } from 'sonner'
import { gitSyncApi, type GitSyncResult } from '@/api/client'
import { useGitSyncStore } from '../gitSyncStore'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/api/client', () => ({
  gitSyncApi: { status: vi.fn(), sync: vi.fn() },
}))

const PUSHED: GitSyncResult = {
  status: 'pushed',
  commit: 'abcdef1234567890',
  files_changed: 3,
  documents: 2,
  diagrams: 1,
  synced_at: '2026-11-07T10:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  useGitSyncStore.setState({ status: null, syncing: false })
  vi.mocked(gitSyncApi.status).mockResolvedValue({ data: null } as never)
  vi.mocked(gitSyncApi.sync).mockResolvedValue({ data: PUSHED } as never)
})

describe('gitSyncStore.sync — what the unsaved note names', () => {
  it('names the document when synced from the documentation', async () => {
    await useGitSyncStore.getState().sync({ unsaved: true, subject: 'document' })
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('Unsaved changes on this document were not included')
  })

  it('adds no note without unsaved edits, whatever the subject', async () => {
    await useGitSyncStore.getState().sync({ unsaved: false, subject: 'document' })
    expect(vi.mocked(toast.success).mock.calls[0][0]).not.toContain('Unsaved')
  })
})
