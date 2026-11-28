import { ChevronLeft, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { useDocsStore } from '@/documentation/store'
import { toast } from 'sonner'

/** Opens the navigation drawer. Rendered only below `md`, where the sidebar is hidden. */
export function NavMenuButton({ className }: { className?: string }) {
  const navOpen = useUiStore((s) => s.navOpen)
  const setNavOpen = useUiStore((s) => s.setNavOpen)
  return (
    <button
      type="button"
      aria-label="Open navigation"
      aria-controls="app-navigation"
      aria-expanded={navOpen}
      onClick={() => setNavOpen(true)}
      className={cn(
        'md:hidden flex items-center justify-center w-9 h-9 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer',
        className,
      )}
    >
      <Menu size={20} />
    </button>
  )
}

/**
 * The Documentation section's header on a phone. The canvas has its Toolbar;
 * documentation had no header at all, so without this there was no way back
 * to the navigation once the sidebar became a drawer. It also switches between
 * the document list and the open document, which cannot sit side by side.
 */
export function MobileDocsBar() {
  const openDoc = useDocsStore((s) => s.openDoc)
  const dirty = useDocsStore((s) => s.dirty)
  const close = useDocsStore((s) => s.close)
  return (
    <header className="md:hidden flex items-center gap-1 px-2 py-2 border-b border-border bg-popover shrink-0">
      <NavMenuButton />
      {openDoc ? (
        <>
          <button
            type="button"
            onClick={() => {
              if (dirty) { toast.error('Save or cancel your edit first'); return }
              close()
            }}
            className="flex items-center gap-0.5 h-9 pl-1 pr-2 rounded-md text-sm text-primary hover:bg-primary/10 cursor-pointer shrink-0"
          >
            <ChevronLeft size={16} /> Documents
          </button>
          <span className="truncate text-sm font-medium text-foreground">{openDoc.title}</span>
        </>
      ) : (
        <span className="text-sm font-medium text-foreground">Documentation</span>
      )}
    </header>
  )
}
