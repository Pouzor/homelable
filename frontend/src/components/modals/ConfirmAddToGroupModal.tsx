import { Layers } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** Labels past this many are summarized as "+N more" instead of listed. */
const MAX_LISTED_LABELS = 5

interface ConfirmAddToGroupModalProps {
  open: boolean
  /** Labels of the nodes being added — one entry for a single drop, several for
   *  a multi-selection. */
  nodeLabels: string[]
  /** Label of the destination group/container. */
  targetLabel: string
  /** Destination kind — drives the wording. Defaults to 'group'. */
  variant?: 'group' | 'container' | 'zone'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmAddToGroupModal({
  open,
  nodeLabels,
  targetLabel,
  variant = 'group',
  onConfirm,
  onCancel,
}: ConfirmAddToGroupModalProps) {
  const noun = variant === 'container' ? 'container' : variant === 'zone' ? 'zone' : 'group'
  const action = `Add to ${noun}`
  const count = nodeLabels.length
  const listed = nodeLabels.slice(0, MAX_LISTED_LABELS).join(', ')
  const subject =
    count === 1
      ? nodeLabels[0]
      : count <= MAX_LISTED_LABELS
        ? `${count} nodes (${listed})`
        : `${count} nodes (${listed}, +${count - MAX_LISTED_LABELS} more)`
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers size={16} className="text-[#00d4ff]" />
            {action}
          </DialogTitle>
          <DialogDescription>
            Add <span className="font-medium text-foreground">{subject}</span> to the {noun}{' '}
            <span className="font-medium text-foreground">{targetLabel}</span>?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
            onClick={onConfirm}
          >
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
