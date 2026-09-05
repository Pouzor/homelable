import { ArrowRight, StickyNote } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * The one-time move from `device_inventory.notes` to real documents.
 *
 * Explicit rather than automatic, and non-destructive: the old column is left
 * exactly as it was, so nothing is lost and the migration can be run again for
 * devices added later.
 */
export function MigrateNotesBanner({ count, onMigrate }: { count: number; onMigrate: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-1.5 text-xs">
      <StickyNote size={13} className="shrink-0 text-primary" />
      <span>
        {count === 1
          ? '1 device has notes that are not a document yet.'
          : `${count} devices have notes that are not documents yet.`}{' '}
        <span className="text-muted-foreground">The notes are copied, never moved.</span>
      </span>
      <Button size="xs" variant="secondary" className="ml-auto cursor-pointer gap-1" onClick={onMigrate}>
        Migrate <ArrowRight size={11} />
      </Button>
    </div>
  )
}
