import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  title: string
  /** A device document regenerates from live facts; a page from its template. */
  fromDevice: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * The confirmation for the one action that overwrites a body the user owns.
 *
 * Regenerating is not an edit that can be walked back in the editor, so it is
 * spelled out here in full — including the one consolation, that the replaced
 * body is snapshotted into the document's history first.
 */
export function RegenerateDocModal({ open, title, fromDevice, busy, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="max-w-md border-border bg-[#161b22]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle size={16} className="text-[var(--status-pending,#e3b341)]" />
            Regenerate “{title}”?
          </DialogTitle>
          <DialogDescription className="text-xs">
            Everything written in this document is erased and replaced by a freshly generated one.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5 rounded-md border border-border bg-[#0d1117]/60 px-3 py-2.5 text-xs text-muted-foreground">
          <li>
            The body is rebuilt {fromDevice ? "from the device's current facts in the database" : 'from the template this page was created with'}.
          </li>
          <li>Your notes, sections and edits in it are lost.</li>
          <li>The current body is saved to the history first, so this can be undone from there.</li>
        </ul>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            className="gap-1.5 bg-[var(--status-offline,#f85149)] text-[#0d1117] hover:bg-[var(--status-offline,#f85149)]/90"
          >
            <RefreshCw size={13} />
            {busy ? 'Regenerating…' : 'Erase and regenerate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
