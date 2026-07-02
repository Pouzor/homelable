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

interface ConfirmAddToGroupModalProps {
  open: boolean
  nodeLabel: string
  /** Label of the destination group/container. */
  targetLabel: string
  /** Destination kind — drives the wording. Defaults to 'group'. */
  variant?: 'group' | 'container'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmAddToGroupModal({
  open,
  nodeLabel,
  targetLabel,
  variant = 'group',
  onConfirm,
  onCancel,
}: ConfirmAddToGroupModalProps) {
  const action = variant === 'container' ? 'Add to container' : 'Add to group'
  const noun = variant === 'container' ? 'container' : 'group'
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers size={16} className="text-[#00d4ff]" />
            {action}
          </DialogTitle>
          <DialogDescription>
            Add <span className="font-medium text-foreground">{nodeLabel}</span> to the {noun}{' '}
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
