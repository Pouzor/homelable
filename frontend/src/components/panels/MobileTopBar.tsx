import { ChevronLeft, Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { useDocsStore } from '@/documentation/store'
import { toast } from 'sonner'

/** Opens the navigation drawer, at every screen size. M does the same from the keyboard. */
export function NavMenuButton({ className }: { className?: string }) {
  const navOpen = useUiStore((s) => s.navOpen)
  const setNavOpen = useUiStore((s) => s.setNavOpen)
  return (
    <button
      type="button"
      aria-label="Open navigation"
      title="Navigation (M)"
      aria-keyshortcuts="m"
      aria-controls="app-navigation"
      aria-expanded={navOpen}
      onClick={() => setNavOpen(true)}
      className={cn(
        'flex items-center justify-center w-9 h-9 shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer',
        className,
      )}
    >
      <Menu size={20} />
    </button>
  )
}

/**
 * The Documentation section's header. The canvas has its Toolbar; documentation
 * had no header at all, so without this there was no way to the navigation once
 * the sidebar became a drawer. On a phone it also switches between the document
 * list and the open document, which cannot sit side by side there.
 */
export function DocsHeader() {
  const openDoc = useDocsStore((s) => s.openDoc)
  const dirty = useDocsStore((s) => s.dirty)
  const close = useDocsStore((s) => s.close)
  return (
    <header className="flex items-center gap-1 px-2 md:px-4 py-2 border-b border-border bg-popover shrink-0">
      <NavMenuButton />
      <span className="hidden md:inline ml-1 text-sm font-medium text-foreground">Documentation</span>
      {openDoc ? (
        <div className="flex md:hidden items-center gap-1 min-w-0">
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
        </div>
      ) : (
        <span className="md:hidden text-sm font-medium text-foreground">Documentation</span>
      )}
    </header>
  )
}
