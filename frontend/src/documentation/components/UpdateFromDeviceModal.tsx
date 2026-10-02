import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { diffLines, diffStat } from '../diff'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Markdown } from '../markdown/Markdown'
import type { ReconcileChange, ResolutionItem, UpdatePreview } from '../types'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'

interface Props {
  open: boolean
  docTitle: string
  preview: UpdatePreview | null
  /** The server is merging; apply and every decision are locked. */
  loading: boolean
  /** The conflicts the user has decided on so far, keyed by change id. */
  resolutions: Record<string, ResolutionItem>
  onPreview: () => void
  /** One decision, then the merge is re-run to show its effect. */
  onResolve: (id: string, item: ResolutionItem) => void
  onCancel: () => void
  onApply: () => void
  docs: LinkableDoc[]
  devices: LinkableDevice[]
}

/**
 * The guided update-from-device review.
 *
 * The server never overwrites a body on its own: a changed device value the
 * user never touched is applied automatically, a value both sides changed is a
 * conflict the user settles here (keep / take the device / their own text), and
 * the live body underneath always reflects the current decisions because it is
 * the server's own merge. Nothing is saved until every conflict is settled and
 * the Apply button is pressed.
 *
 * A custom text is applied in two explicit steps so what is shown is always
 * what is saved: revising the text only marks the row pending, the "Use this
 * text" button records the resolution and re-runs the merge, and Update stays
 * locked while that preview is loading. The merge the user looks at is by
 * construction the merge that will land.
 */
export function UpdateFromDeviceModal({
  open,
  docTitle,
  preview,
  loading,
  resolutions,
  onPreview,
  onResolve,
  onCancel,
  onApply,
  docs,
  devices,
}: Props) {
  // Keep the last successful comparison mounted while a refresh is pending or
  // has failed. ConflictRow owns unconfirmed custom text, so unmounting it on a
  // transport error would discard keystrokes. `preview`, not this retained
  // copy, remains the authority for enabling Apply.
  const [lastPreview, setLastPreview] = useState<UpdatePreview | null>(preview)
  const [previousPreview, setPreviousPreview] = useState(preview)
  if (preview !== previousPreview) {
    setPreviousPreview(preview)
    if (preview !== null) setLastPreview(preview)
  }
  if (!open && lastPreview !== null) setLastPreview(null)
  const displayedPreview = preview ?? lastPreview

  // Every conflict — settled or still open — keeps a row for the whole review,
  // so a decision can be revised and the custom editor is never torn down by
  // the re-preview that a confirmed choice triggers. The section therefore
  // descends from `changes`, never from `unresolved`.
  const conflicts = displayedPreview
    ? displayedPreview.changes.filter((change) => change.status === 'conflict')
    : []

  // A custom draft counts as pending until it is explicitly confirmed ("Use
  // this text"), so Update can never omit keystrokes the user has not reviewed.
  // The rows report their own dirty state; the store only knows confirmed
  // decisions.
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const reportDirty = useCallback((id: string, value: boolean) => {
    setDirty((current) => (current[id] === value ? current : { ...current, [id]: value }))
  }, [])
  const cancel = useCallback(() => {
    setLastPreview(null)
    setDirty({})
    onCancel()
  }, [onCancel])

  const pending = conflicts.filter((change) => !(change.id in resolutions) || dirty[change.id])
  const hasAnythingToApply =
    displayedPreview !== null &&
    (displayedPreview.summary.length > 0 || displayedPreview.unresolved.length > 0 || Object.keys(resolutions).length > 0)
  const previewReady = preview !== null

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !loading && cancel()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col border-border bg-[#161b22]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <RefreshCw size={16} className="text-[var(--status-online,#39d353)]" />
            Update "{docTitle}" from the device
          </DialogTitle>
          <DialogDescription className="text-xs">
            The document is compared against the device's current facts. Nothing is saved until
            you review it and press Update.
          </DialogDescription>
        </DialogHeader>

        {displayedPreview === null && (
          <div className="flex flex-1 flex-col items-center gap-3 py-10 text-center">
            {loading ? (
              <>
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Comparing with the device…</p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Could not compare this document with the device.</p>
                <Button size="sm" variant="secondary" onClick={onPreview} className="cursor-pointer">
                  Try again
                </Button>
              </>
            )}
          </div>
        )}

        {displayedPreview !== null && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {preview === null && !loading && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span>Could not refresh this comparison. Review your text, then try again.</span>
                <Button size="sm" variant="secondary" onClick={onPreview} className="shrink-0 cursor-pointer">
                  Try again
                </Button>
              </div>
            )}
            {/* What the merge decided, in the order the user will read it. */}
            {displayedPreview.summary.length > 0 && (
              <ul className="mt-1 space-y-1 rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5">
                {displayedPreview.summary.map((line) => (
                  <li key={line} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check size={12} className="mt-px shrink-0 text-[var(--status-online,#39d353)]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}

            {conflicts.length > 0 && (
              <section aria-label="Conflicts to resolve" className="mt-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  <AlertTriangle size={11} className="text-[var(--status-pending,#e3b341)]" />
                  {pending.length > 0
                    ? 'You changed this, and the device changed it too — decide which wins'
                    : 'Settled — pick a row again to revise it'}
                </p>
                <div className="space-y-2">
                  {conflicts.map((change) => (
                    <ConflictRow
                      key={change.id}
                      change={change}
                      onResolve={onResolve}
                      reportDirty={reportDirty}
                      docs={docs}
                      devices={devices}
                      resolved={resolutions[change.id]}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* The merged body, always the server's own merge with the current
                resolutions folded in. */}
            <section aria-label="Merged result" className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {hasAnythingToApply ? 'Result' : 'Nothing to change'}
              </p>
              {hasAnythingToApply ? (
                <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-[#0d1117]/60 px-4 py-3">
                  <Markdown
                    body={displayedPreview.proposed_body}
                    docs={docs}
                    devices={devices}
                    className="text-xs"
                  />
                </div>
              ) : (
                <p className="rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5 text-xs text-muted-foreground">
                  The document already matches the device.
                </p>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="shrink-0 gap-2">
          <Button variant="ghost" onClick={cancel} disabled={loading}>
            Cancel
          </Button>
          {previewReady && !hasAnythingToApply && (
            <Button variant="secondary" onClick={cancel} className="cursor-pointer" disabled={loading}>
              Done
            </Button>
          )}
          {previewReady && hasAnythingToApply && (
            <Button
              onClick={onApply}
              disabled={loading || pending.length > 0}
              className="gap-1.5 bg-[var(--status-online,#39d353)] text-[#0d1117] hover:bg-[var(--status-online,#39d353)]/90"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Working…
                </>
              ) : pending.length > 0 ? (
                <>
                  <RefreshCw size={13} />
                  Resolve {pending.length} more
                </>
              ) : (
                <>
                  <RefreshCw size={13} />
                  Update the document
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CHOICES: { choice: ResolutionItem['choice']; label: string }[] = [
  { choice: 'keep', label: 'Keep my text' },
  { choice: 'device', label: 'Take the device value' },
  { choice: 'custom', label: 'Write my own' },
]

/** Mark the changed run while leaving the matching context easy to scan. */
function FieldValue({ value, other, accent }: { value: string; other: string; accent: 'document' | 'device' }) {
  let start = 0
  while (start < value.length && start < other.length && value[start] === other[start]) start++

  let end = 0
  while (
    end < value.length - start &&
    end < other.length - start &&
    value[value.length - 1 - end] === other[other.length - 1 - end]
  ) {
    end++
  }

  const before = value.slice(0, start)
  const changed = value.slice(start, value.length - end)
  const after = value.slice(value.length - end)
  return (
    <p className="px-2.5 py-2 font-mono text-sm break-words text-foreground">
      {before}
      {changed && (
        <mark
          className={cn(
            'rounded px-0.5 text-inherit',
            accent === 'document'
              ? 'bg-[var(--status-pending,#e3b341)]/25'
              : 'bg-[var(--status-online,#39d353)]/25',
          )}
        >
          {changed}
        </mark>
      )}
      {after}
      {!value && <mark className="rounded bg-[var(--status-offline,#f85149)]/20 px-0.5 text-muted-foreground">removed</mark>}
    </p>
  )
}

function SectionValue({
  documented,
  device,
  accent,
}: {
  documented: string
  device: string
  accent: 'document' | 'device'
}) {
  const highlightedLines = useMemo(() => {
    let documentedLine = 1
    let deviceLine = 1
    const changed: number[] = []
    diffLines(documented, device).forEach((row) => {
      if (row.kind === 'same') {
        documentedLine++
        deviceLine++
      } else if (row.kind === 'del') {
        if (accent === 'document') changed.push(documentedLine)
        documentedLine++
      } else {
        if (accent === 'device') changed.push(deviceLine)
        deviceLine++
      }
    })
    return changed
  }, [accent, documented, device])

  return (
    <Markdown
      body={accent === 'document' ? documented : device}
      highlightedLines={highlightedLines}
      highlightClassName={accent === 'document' ? 'bg-[var(--status-pending,#e3b341)]/20' : 'bg-[var(--status-online,#39d353)]/20'}
      className="max-h-44 overflow-y-auto px-2.5 py-2 text-xs leading-relaxed"
    />
  )
}

/** One of the two sides of a conflict: labelled, readable, highlighted. */
function VersionPanel({
  label,
  value,
  kind,
  otherValue,
  accent,
}: {
  label: string
  value: string
  kind: ReconcileChange['kind']
  otherValue: string
  accent: 'document' | 'device'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-[#0d1117]/60',
        accent === 'document'
          ? 'border-[var(--status-pending,#e3b341)]/40'
          : 'border-[var(--status-online,#39d353)]/40',
      )}
    >
      <p
        className={cn(
          'border-b px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
          accent === 'document'
            ? 'border-[var(--status-pending,#e3b341)]/30 text-[var(--status-pending,#e3b341)]'
            : 'border-[var(--status-online,#39d353)]/30 text-[var(--status-online,#39d353)]',
        )}
      >
        {label}
      </p>
      {kind === 'field' ? (
        <FieldValue value={value} other={otherValue} accent={accent} />
      ) : (
        <SectionValue documented={accent === 'document' ? value : otherValue} device={accent === 'device' ? value : otherValue} accent={accent} />
      )}
    </div>
  )
}

function ConflictRow({
  change,
  onResolve,
  reportDirty,
  docs,
  devices,
  resolved,
}: {
  change: ReconcileChange
  onResolve: (id: string, item: ResolutionItem) => void
  reportDirty: (id: string, dirty: boolean) => void
  docs: LinkableDoc[]
  devices: LinkableDevice[]
  resolved?: ResolutionItem
}) {
  const [typed, setTyped] = useState(resolved?.choice === 'custom' ? (resolved.custom ?? '') : (change.custom ?? ''))
  const [choice, setChoice] = useState<ResolutionItem['choice'] | null>(resolved?.choice ?? null)
  const [previousResolved, setPreviousResolved] = useState(resolved)

  // A reset (or a decision made elsewhere) must also reset this row's local
  // selection. Adjusting state during render avoids a stale frame and leaves
  // unconfirmed text intact when the user deliberately picks keep/device.
  if (resolved !== previousResolved) {
    setPreviousResolved(resolved)
    setChoice(resolved?.choice ?? null)
    if (resolved?.choice === 'custom') setTyped(resolved.custom ?? '')
    else if (!resolved) setTyped(change.custom ?? '')
  }

  // Custom text is only committed by the explicit "Use this text" button — the
  // textarea itself never spawns a request. Nothing lands mid-review: the typed
  // value only becomes a resolution when the user confirms it, and every
  // confirmation is preceded by its own merge preview below.
  const confirmedCustom = resolved?.choice === 'custom' ? (resolved.custom ?? '') : ''
  // Choosing custom replaces a prior keep/device resolution even if its text
  // happens to be empty or equal to an earlier value, so it needs confirmation.
  const dirty = choice === 'custom' && (resolved?.choice !== 'custom' || typed !== confirmedCustom)

  // The row tells the parent whether it still has unconfirmed text, so Update
  // stays blocked until every custom edit has its matching preview.
  useEffect(() => {
    reportDirty(change.id, dirty)
    return () => reportDirty(change.id, false)
  }, [change.id, dirty, reportDirty])

  function pick(next: ResolutionItem['choice']) {
    setChoice(next)
    // keep/device are complete on their own; custom waits for a confirmation.
    if (next !== 'custom') onResolve(change.id, { id: change.id, choice: next })
  }

  function confirmText() {
    onResolve(change.id, { id: change.id, choice: 'custom', custom: typed })
  }

  const stat = useMemo(() => diffStat(diffLines(change.documented, change.device)), [change])

  return (
    <div className="rounded-md border border-border bg-[#0d1117]/60 p-2.5">
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={13} className="shrink-0 text-[var(--status-pending,#e3b341)]" />
        <p className="text-xs font-medium text-foreground">{change.name}</p>
        {(stat.added > 0 || stat.removed > 0) && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {stat.added > 0 && <span className="text-[var(--status-online,#39d353)]">+{stat.added}</span>}
            {stat.removed > 0 && <span className="ml-0.5 text-[var(--status-offline,#f85149)]">−{stat.removed}</span>}
          </span>
        )}
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <VersionPanel
          label="Your documentation"
          value={change.documented}
          kind={change.kind}
          otherValue={change.device}
          accent="document"
        />
        <VersionPanel
          label="Latest device information"
          value={change.device}
          kind={change.kind}
          otherValue={change.documented}
          accent="device"
        />
      </div>

      {change.previous && change.previous !== change.documented && change.previous !== change.device && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Show previous shared value</summary>
          <div className="mt-1 rounded border border-border bg-muted/20 px-2.5 py-2">
            {change.kind === 'field' ? (
              <p className="font-mono break-words text-foreground">{change.previous}</p>
            ) : (
              <Markdown body={change.previous} docs={docs} devices={devices} className="text-xs" />
            )}
          </div>
        </details>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        {CHOICES.map(({ choice: value, label }) => (
          <label key={value} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={`resolve-${change.id}`}
              checked={choice === value}
              onChange={() => pick(value)}
              className="cursor-pointer accent-[var(--status-online,#39d353)]"
            />
            {value === 'device' && change.device ? (
              <>
                <RefreshCw size={11} />
                Take <span className="max-w-40 truncate text-foreground">{change.device}</span>
              </>
            ) : value === 'device' ? (
              <>
                <X size={11} />
                Remove it
              </>
            ) : (
              label
            )}
          </label>
        ))}
      </div>

      {choice === 'custom' && (
        <div className="mt-2">
          <textarea
            autoFocus
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label={`Your text for ${change.name}`}
            rows={2}
            className="w-full rounded border border-border bg-[#0d1117] px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={confirmText}
            disabled={!dirty}
            className="mt-1.5 cursor-pointer"
          >
            Use this text
          </Button>
        </div>
      )}
    </div>
  )
}
