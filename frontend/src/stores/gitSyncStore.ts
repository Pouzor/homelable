import { create } from 'zustand'
import { toast } from 'sonner'
import { gitSyncApi, type GitSyncResult, type GitSyncStatus } from '@/api/client'

/**
 * Git sync — push the documentation and every diagram to the repository set in
 * the server .env (GIT_SYNC_*).
 *
 * Shared by the header's Sync button and the Settings section, so both show the
 * same configuration and the same "syncing" state, and a sync started from one
 * disables the other. The connection is env-only: nothing here edits it.
 */
/** What holds the unsaved edits a sync leaves out. */
export type SyncSubject = 'canvas' | 'document'

interface GitSyncState {
  /** null until loaded — or when the backend could not say (older backend, error). */
  status: GitSyncStatus | null
  syncing: boolean
  load: () => Promise<void>
  /**
   * Run one sync and toast the outcome. `unsaved` notes that the open canvas —
   * or document, per `subject` — has unsaved edits: the sync pushes what the
   * server holds, so they are not in it.
   */
  sync: (opts?: { unsaved?: boolean; subject?: SyncSubject }) => Promise<GitSyncResult | null>
}

function errorDetail(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : 'Git sync failed'
}

function shortSha(commit: string | null): string {
  return commit ? commit.slice(0, 7) : ''
}

export const useGitSyncStore = create<GitSyncState>()((set, get) => ({
  status: null,
  syncing: false,

  load: async () => {
    try {
      const res = await gitSyncApi.status()
      set({ status: res.data })
    } catch {
      // Not knowing is the same as not configured: the Sync button stays hidden.
      set({ status: null })
    }
  },

  sync: async (opts = {}) => {
    if (get().syncing) return null
    set({ syncing: true })
    try {
      const { data } = await gitSyncApi.sync()
      const note = opts.unsaved
        ? ` Unsaved changes on this ${opts.subject ?? 'canvas'} were not included — save, then sync again.`
        : ''
      if (data.status === 'unchanged') {
        toast.info(`Git is already up to date.${note}`)
      } else {
        toast.success(
          `Pushed ${data.documents} document(s) and ${data.diagrams} diagram(s) — ${shortSha(data.commit)}.${note}`,
        )
      }
      return data
    } catch (error) {
      toast.error(errorDetail(error))
      return null
    } finally {
      set({ syncing: false })
      // The server recorded the outcome, success or failure: show it.
      void get().load()
    }
  },
}))
