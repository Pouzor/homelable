import { useMemo, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelative, formatTimestamp } from '@/utils/timeFormat'
import { collapseDiff, diffLines, diffStat } from '../diff'
import { Markdown } from '../markdown/Markdown'
import type { DocRevision } from '../types'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'

/**
 * Reading a document's history.
 *
 * The server has kept up to fifty revisions per document since the section
 * shipped and every destructive action says so — regenerate in particular
 * promises the old body "is in its history" — but nothing reached them. The
 * rail lists what is there, and the preview answers the question a list cannot:
 * what did this version actually say, and how does it differ from the one on
 * screen.
 */

/** Why a revision was taken, said in the words the action used. */
const REASONS: Record<DocRevision['reason'], string> = {
  edit: 'Saved',
  restore: 'Restored',
  import: 'Imported',
  migrate: 'Migrated from notes',
  scaffold: 'Generated',
  regenerate: 'Regenerated',
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`
}

interface RailProps {
  revisions: DocRevision[]
  activeId: string | null
  loading: boolean
  onSelect: (revisionId: string) => void
  onClose: () => void
}

export function DocHistoryRail({ revisions, activeId, loading, onSelect, onClose }: RailProps) {
  return (
    <nav
      aria-label="Document history"
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-l border-border"
    >
      <div className="flex items-center gap-1 px-3 py-4">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          History
        </p>
        <Button size="icon-xs" variant="ghost" aria-label="Close history" onClick={onClose} className="cursor-pointer">
          <X />
        </Button>
      </div>

      {loading && <p className="px-3 text-xs text-muted-foreground">Loading…</p>}
      {!loading && revisions.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">
          No earlier version yet. One is kept every time you save a change.
        </p>
      )}

      <ul className="pb-6">
        {revisions.map((revision) => (
          <li key={revision.id}>
            <button
              type="button"
              onClick={() => onSelect(revision.id)}
              title={formatTimestamp(revision.saved_at)}
              aria-current={revision.id === activeId}
              className={cn(
                'w-full cursor-pointer px-3 py-1.5 text-left hover:bg-muted/60',
                revision.id === activeId && 'bg-muted',
              )}
            >
              <span className="block truncate text-xs text-foreground">
                {REASONS[revision.reason] ?? revision.reason}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {formatRelative(revision.saved_at)} · {size(revision.size)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

interface PreviewProps {
  revision: DocRevision
  body: string
  currentBody: string
  docs: LinkableDoc[]
  devices: LinkableDevice[]
  onOpenDoc: (id: string) => void
  onRestore: () => void
  onClose: () => void
}

export function RevisionPreview({
  revision,
  body,
  currentBody,
  docs,
  devices,
  onOpenDoc,
  onRestore,
  onClose,
}: PreviewProps) {
  const [showChanges, setShowChanges] = useState(false)
  // The diff reads old → new, so the current body is the "after" side: what the
  // reader wants is "what happened since this version", not how to undo it.
  const rows = useMemo(() => collapseDiff(diffLines(body, currentBody)), [body, currentBody])
  const stat = useMemo(() => diffStat(diffLines(body, currentBody)), [body, currentBody])
  const identical = stat.added === 0 && stat.removed === 0

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-[var(--surface,#161b22)] px-6 py-2.5">
        <span className="text-xs text-foreground">
          {REASONS[revision.reason] ?? revision.reason}{' '}
          <span className="text-muted-foreground" title={formatTimestamp(revision.saved_at)}>
            {formatRelative(revision.saved_at)}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {identical ? (
            'Identical to the current version'
          ) : (
            <>
              <span className="text-[var(--status-online,#39d353)]">+{stat.added}</span>{' '}
              <span className="text-[var(--status-offline,#f85149)]">−{stat.removed}</span> since
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowChanges((on) => !on)}
            className="cursor-pointer"
            aria-pressed={showChanges}
          >
            {showChanges ? 'Read it' : 'Changes'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onRestore} className="cursor-pointer gap-1">
            <RotateCcw size={13} /> Restore
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Back to the current version" onClick={onClose} className="cursor-pointer">
            <X />
          </Button>
        </div>
      </div>

      {showChanges ? (
        <div className="px-6 pb-16 pt-3 font-mono text-xs">
          {rows.map((row, index) => {
            if (row.kind === 'gap') {
              return (
                <p key={index} className="my-1 text-[10px] text-muted-foreground/60">
                  ⋯ {row.text}
                </p>
              )
            }
            return (
              <p
                key={index}
                className={cn(
                  'whitespace-pre-wrap break-words border-l-2 py-px pl-2',
                  row.kind === 'add' && 'border-[var(--status-online,#39d353)] bg-[var(--status-online,#39d353)]/10',
                  row.kind === 'del' &&
                    'border-[var(--status-offline,#f85149)] bg-[var(--status-offline,#f85149)]/10',
                  row.kind === 'same' && 'border-transparent text-muted-foreground',
                )}
              >
                {row.kind === 'add' ? '+ ' : row.kind === 'del' ? '− ' : '  '}
                {row.text || ' '}
              </p>
            )
          })}
        </div>
      ) : (
        <Markdown
          body={body}
          docs={docs}
          devices={devices}
          onOpenDoc={onOpenDoc}
          className="max-w-[72ch] px-6 pb-16 pt-2 text-sm"
        />
      )}
    </div>
  )
}
