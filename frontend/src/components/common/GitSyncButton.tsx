import { GitBranch, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGitSyncStore, type SyncSubject } from '@/stores/gitSyncStore'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

interface GitSyncButtonProps {
  /** The view has edits the server does not hold yet, so the push will not carry them. */
  unsaved: boolean
  /** What `unsaved` refers to, for the toast. The open canvas when left out. */
  subject?: SyncSubject
  size?: 'sm' | 'xs'
  className?: string
}

/**
 * The Sync button of the canvas header and the documentation footer.
 *
 * Rendered only once the server says GIT_SYNC_REPO_URL is set, and disabled
 * while a sync runs — this tab's, or one the server reports from elsewhere.
 */
export function GitSyncButton({ unsaved, subject, size = 'sm', className }: GitSyncButtonProps) {
  const configured = useGitSyncStore((s) => s.status?.configured === true)
  const running = useGitSyncStore((s) => s.syncing || s.status?.running === true)
  const sync = useGitSyncStore((s) => s.sync)
  if (STANDALONE || !configured) return null

  const iconSize = size === 'xs' ? 12 : 14
  return (
    <Button
      size={size}
      variant="ghost"
      className={cn('cursor-pointer gap-1.5 disabled:opacity-50', className)}
      onClick={() => { void sync(subject ? { unsaved, subject } : { unsaved }) }}
      disabled={running}
      title="Push the documentation and every diagram to git"
    >
      {running ? <Loader2 size={iconSize} className="animate-spin" /> : <GitBranch size={iconSize} />}
      {running ? 'Syncing…' : 'Sync'}
    </Button>
  )
}
