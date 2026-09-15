import { useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react'

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
  const pending = preview ? preview.unresolved.filter((id) => !(id in resolutions)) : []
  const hasAnythingToApply =
    preview !== null &&
    (preview.summary.length > 0 || preview.unresolved.length > 0 || Object.keys(resolutions).length > 0)

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !loading && onCancel()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col border-border bg-[#161b22]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <RefreshCw size={16} className="text-[var(--status-online,#39d353)]" />
            Update “{docTitle}” from the device
          </DialogTitle>
          <DialogDescription className="text-xs">
            The document is compared against the device's current facts. Nothing is saved until
            you review it and press Update.
          </DialogDescription>
        </DialogHeader>

        {preview === null && (
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

        {preview !== null && (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {/* What the merge decided, in the order the user will read it. */}
            {preview.summary.length > 0 && (
              <ul className="mt-1 space-y-1 rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5">
                {preview.summary.map((line) => (
                  <li key={line} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check size={12} className="mt-px shrink-0 text-[var(--status-online,#39d353)]" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}

            {pending.length > 0 && (
              <section aria-label="Conflicts to resolve" className="mt-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  <AlertTriangle size={11} className="text-[var(--status-pending,#e3b341)]" />
                  You changed this, and the device changed it too — decide which wins
                </p>
                <div className="space-y-2">
                  {pending.map((id) => (
                    <ConflictRow key={id} change={changeById(preview, id)} onResolve={onResolve} />
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
                    body={preview.proposed_body}
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
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          {!hasAnythingToApply && (
            <Button variant="secondary" onClick={onCancel} className="cursor-pointer" disabled={loading}>
              Done
            </Button>
          )}
          {hasAnythingToApply && (
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

function changeById(preview: UpdatePreview, id: string): ReconcileChange {
  return preview.changes.find((c) => c.id === id) ?? {
    id,
    name: id,
    kind: 'field',
    status: 'conflict',
    documented: '',
    device: '',
    previous: '',
  }
}

const CHOICES: { choice: ResolutionItem['choice']; label: string }[] = [
  { choice: 'keep', label: 'Keep my text' },
  { choice: 'device', label: 'Take the device value' },
  { choice: 'custom', label: 'Write my own' },
]

function ConflictRow({ change, onResolve }: { change: ReconcileChange; onResolve: (id: string, item: ResolutionItem) => void }) {
  const [typed, setTyped] = useState(change.custom ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [choice, setChoice] = useState<ResolutionItem['choice'] | null>(null)

  function pick(next: ResolutionItem['choice']) {
    setChoice(next)
    if (next === 'custom') onResolve(change.id, { id: change.id, choice: 'custom', custom: typed })
    else onResolve(change.id, { id: change.id, choice: next })
  }

  // Typing a custom value refetches the merged preview, so wait for a pause
  // rather than hammering the server with every keystroke.
  function type(value: string) {
    setTyped(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onResolve(change.id, { id: change.id, choice: 'custom', custom: value }), 350)
  }

  return (
    <div className="rounded-md border border-border bg-[#0d1117]/60 px-3 py-2">
      <p className="text-xs font-medium text-foreground">{change.name}</p>
      <dl className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="shrink-0 uppercase tracking-wide text-muted-foreground/60">Document</dt>
          <dd className="min-w-0 break-words">{change.documented || '—'}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="shrink-0 uppercase tracking-wide text-muted-foreground/60">Device</dt>
          <dd className="min-w-0 break-words">{change.device || '—'}</dd>
        </div>
      </dl>

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
        <textarea
          autoFocus
          value={typed}
          onChange={(event) => type(event.target.value)}
          aria-label={`Your text for ${change.name}`}
          rows={2}
          className="mt-2 w-full rounded border border-border bg-[#0d1117] px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
        />
      )}
    </div>
  )
}