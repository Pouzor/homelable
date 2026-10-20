import { ChevronRight } from 'lucide-react'
import { useDesignStore } from '@/stores/designStore'

/**
 * The way back up a drill-down: one crumb per design the user clicked through
 * from, then the current one. Floats in the canvas' top-left corner, and only
 * once a node's linked design was opened.
 */
export function DesignTrail() {
  const trail = useDesignStore((s) => s.trail)
  const designs = useDesignStore((s) => s.designs)
  const activeDesignId = useDesignStore((s) => s.activeDesignId)
  const backToTrail = useDesignStore((s) => s.backToTrail)

  if (trail.length === 0) return null
  const nameOf = (id: string | null) => designs.find((d) => d.id === id)?.name ?? ''

  return (
    <nav
      aria-label="Design trail"
      className="absolute top-3 left-3 z-10 flex items-center gap-1 min-w-0 max-w-[calc(100%-1.5rem)] px-2.5 py-1.5 rounded-lg border border-[#30363d] bg-[#161b22] text-xs shadow-lg"
    >
      {trail.map((id, index) => (
        <span key={`${id}-${index}`} className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={() => backToTrail(index)}
            className="truncate max-w-40 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title={`Back to ${nameOf(id)}`}
          >
            {nameOf(id)}
          </button>
          <ChevronRight size={12} className="shrink-0 text-muted-foreground/60" />
        </span>
      ))}
      {/* Gives way first when space is tight: the crumbs are the way back, and
          the sidebar's design switcher names the current design anyway. */}
      <span className="truncate max-w-48 min-w-8 shrink-[4] font-medium text-foreground" aria-current="page">
        {nameOf(activeDesignId)}
      </span>
    </nav>
  )
}
