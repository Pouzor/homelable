import { House } from 'lucide-react'

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
  /** The page about to become the homepage. */
  title: string
  /** The page that is the homepage now. */
  currentTitle: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * The confirmation for replacing the homepage. Only asked when there already is
 * one — setting the first homepage takes nothing away, so it needs no question.
 */
export function SetHomepageModal({ open, title, currentTitle, busy, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="max-w-md border-border bg-[#161b22]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <House size={16} className="text-primary" />
            Make “{title}” the homepage?
          </DialogTitle>
          <DialogDescription className="text-xs">
            “{currentTitle}” is the homepage now. It stays in the Library, but Documentation will
            open on “{title}” instead.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy} className="gap-1.5">
            <House size={13} />
            {busy ? 'Setting…' : 'Set as homepage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
