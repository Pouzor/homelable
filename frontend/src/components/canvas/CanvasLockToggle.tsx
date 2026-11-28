import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'

/**
 * Switches the network canvas between view mode (locked: pan, zoom, tap to
 * inspect) and edit mode. The label names the current mode, so it reads as a
 * state rather than an action.
 */
export function CanvasLockToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const locked = useUiStore((s) => s.canvasLocked)
  const setLocked = useUiStore((s) => s.setCanvasLocked)
  const Icon = locked ? Lock : LockOpen
  const label = locked ? 'Viewing' : 'Editing'
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={locked}
      aria-label={locked ? 'Canvas locked: tap to unlock editing' : 'Canvas unlocked: tap to lock (view only)'}
      title={locked ? 'View mode: pan, zoom and inspect. Click to edit.' : 'Edit mode: drag, connect and edit. Click to lock.'}
      onClick={() => setLocked(!locked)}
      className={cn(
        'gap-1.5 cursor-pointer',
        locked ? 'text-primary hover:bg-primary/10' : 'text-warning hover:bg-warning/10',
        className,
      )}
    >
      <Icon size={14} />
      {!compact && <span>{label}</span>}
    </Button>
  )
}
