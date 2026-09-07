import { type RefObject } from 'react'

import { cn } from '@/lib/utils'
import type { Placement } from '@/documentation/caret'

/**
 * The popover the editor opens at the caret.
 *
 * Extracted when the `[[` link picker joined the `/` insert menu: same shape —
 * a filter field over a labelled list, placed at the caret and measured before
 * it is shown — and two copies of that would have drifted apart.
 */

export interface EditorMenuItem {
  id: string
  label: string
  hint: string
}

interface Props {
  items: EditorMenuItem[]
  query: string
  onQuery: (query: string) => void
  placeholder: string
  /** Names the filter field, since the popover has no visible title. */
  ariaLabel: string
  emptyText: string
  /** Null until measured — the menu is rendered hidden to get its height. */
  at: Placement | null
  menuRef: RefObject<HTMLDivElement | null>
  /** Monospace labels suit the `/command` list; document titles are prose. */
  monoLabels?: boolean
  onPick: (item: EditorMenuItem) => void
  onClose: () => void
}

export function EditorMenu({
  items,
  query,
  onQuery,
  placeholder,
  ariaLabel,
  emptyText,
  at,
  menuRef,
  monoLabels = false,
  onPick,
  onClose,
}: Props) {
  return (
    <div
      ref={menuRef}
      style={at ? { top: at.top, left: at.left } : undefined}
      className={cn(
        'absolute z-20 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg',
        // Hidden, not unmounted, for the frame it takes to measure it —
        // placing it needs the height it only has once rendered.
        !at && 'invisible',
      )}
    >
      <input
        autoFocus
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter' && items[0]) {
            event.preventDefault()
            onPick(items[0])
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full border-b border-border bg-transparent px-3 py-2 text-xs outline-none"
      />
      <div className="max-h-56 overflow-y-auto">
        {items.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">{emptyText}</p>}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className="flex w-full cursor-pointer flex-col items-start px-3 py-1.5 text-left hover:bg-muted"
          >
            <span className={cn('text-xs', monoLabels ? 'font-mono' : 'truncate')}>{item.label}</span>
            <span className="text-[10px] text-muted-foreground">{item.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
