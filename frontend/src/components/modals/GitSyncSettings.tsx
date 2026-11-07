import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useGitSyncStore } from '@/stores/gitSyncStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useRackStore } from '@/rack/store'
import { useDesignStore } from '@/stores/designStore'
import { formatRelative } from '@/utils/timeFormat'
import type { GitSyncLast } from '@/api/client'

const ACCENT = '#00d4ff'

const AUTH_LABELS = { token: 'HTTPS token', ssh: 'SSH key', none: 'none' } as const

function LastSync({ last }: { last: GitSyncLast }) {
  if (last.status === 'failed') {
    return (
      <p className="text-[10px] text-[#f85149] leading-tight break-words" role="status">
        Last sync failed {formatRelative(last.at)}: {last.error}
      </p>
    )
  }
  const sha = last.commit ? last.commit.slice(0, 7) : null
  return (
    <p className="text-[10px] text-muted-foreground leading-tight" role="status">
      Last sync {formatRelative(last.at)} —{' '}
      {last.status === 'pushed' ? `pushed ${last.files_changed} file(s)` : 'already up to date'}
      {sha && <> · <span className="font-mono">{sha}</span></>}
    </p>
  )
}

/**
 * Settings → Git sync. Shows what GIT_SYNC_* points at and runs a sync; the
 * connection itself is env-only, so there is nothing to edit here.
 */
export function GitSyncSettings() {
  const status = useGitSyncStore((s) => s.status)
  const syncing = useGitSyncStore((s) => s.syncing)
  const load = useGitSyncStore((s) => s.load)
  const sync = useGitSyncStore((s) => s.sync)
  const isRack = useDesignStore((s) => s.activeDesignType) === 'rack'
  const canvasDirty = useCanvasStore((s) => s.hasUnsavedChanges)
  const rackDirty = useRackStore((s) => s.hasUnsavedChanges)
  const unsaved = isRack ? rackDirty : canvasDirty

  useEffect(() => { void load() }, [load])

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Git sync</span>
      {!status?.configured ? (
        <p className="text-[10px] text-[#e3b341] leading-tight">
          No repository configured. Set <span className="font-mono">GIT_SYNC_REPO_URL</span> (and{' '}
          <span className="font-mono">GIT_SYNC_TOKEN</span> or <span className="font-mono">GIT_SYNC_SSH_KEY</span>)
          in the server .env to push the documentation and every diagram to git.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" aria-label="Git sync target">
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="font-mono text-foreground break-all">{status.repo_url}</dd>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="font-mono text-foreground">{status.branch}</dd>
            <dt className="text-muted-foreground">Folder</dt>
            <dd className="font-mono text-foreground">{status.path || '/ (repository root)'}</dd>
            <dt className="text-muted-foreground">Auth</dt>
            <dd className="text-foreground">{AUTH_LABELS[status.auth ?? 'none']}</dd>
          </dl>
          {status.last && <LastSync last={status.last} />}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => { void sync({ unsaved }) }}
              disabled={syncing || status.running}
              className="h-7 text-xs"
              style={{ borderColor: ACCENT, color: ACCENT }}
            >
              {syncing || status.running ? 'Syncing…' : 'Sync now'}
            </Button>
            <span className="text-[10px] text-muted-foreground leading-tight">
              Pushes what is saved: README (first sync only), Documentation/ and Diagrams/.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
