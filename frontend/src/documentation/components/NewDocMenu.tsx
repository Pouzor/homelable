import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

import { DOC_TEMPLATES } from '../types'

interface Props {
  trigger: ReactNode
  /** Which way the popover opens from the trigger. */
  placement?: 'up' | 'down'
  parentId?: string | null
  onCreate: (input: { title: string; templateId: string; parentId?: string | null }) => void | Promise<void>
}

/**
 * The template picker.
 *
 * A plain popover rather than a shadcn dropdown: the project only ships a
 * handful of primitives and this needs no focus trapping beyond closing on an
 * outside click or Escape.
 *
 * It is **portalled to the body and positioned in viewport coordinates**. The
 * trigger sits at the right edge of the document tree, which is a narrow,
 * resizable, vertically scrolling column: an absolutely positioned menu wider
 * than the space to its left escaped that column, where it was both clipped by
 * the scroll container and painted under the app sidebar. Out of the column
 * there is nothing to clip it, and the left edge is clamped to the viewport so
 * a narrow tree cannot push it off screen.
 */

/** Matches `w-64` below; the clamp needs the width before the menu is drawn. */
const MENU_WIDTH = 256
const MARGIN = 8
const GAP = 4

export function NewDocMenu({ trigger, placement = 'up', parentId, onCreate }: Props) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const place = useCallback(() => {
    const rect = anchor.current?.getBoundingClientRect()
    if (!rect) return
    setAt({
      // Right-aligned on the trigger, then pulled back inside the viewport.
      left: Math.min(
        Math.max(rect.right - MENU_WIDTH, MARGIN),
        Math.max(window.innerWidth - MENU_WIDTH - MARGIN, MARGIN),
      ),
      ...(placement === 'down'
        ? { top: rect.bottom + GAP }
        : { bottom: window.innerHeight - rect.top + GAP }),
    })
  }, [placement])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      // The menu is no longer a descendant of the trigger, so both are checked.
      if (!anchor.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // Fixed coordinates go stale the moment anything moves underneath them;
    // closing is honest, and cheaper than following the trigger around.
    const onMove = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  return (
    <div ref={anchor} className="relative">
      <div
        onClick={() => {
          place()
          setOpen((value) => !value)
        }}
      >
        {trigger}
      </div>
      {open &&
        at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ left: at.left, top: at.top, bottom: at.bottom }}
            className={cn(
              'fixed z-50 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg',
            )}
          >
            {DOC_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                role="menuitem"
                onClick={async () => {
                  setOpen(false)
                  const title = window.prompt('Document title', template.label)
                  if (!title?.trim()) return
                  await onCreate({ title: title.trim(), templateId: template.id, parentId })
                }}
                className="flex w-full cursor-pointer flex-col items-start px-3 py-1.5 text-left hover:bg-muted"
              >
                <span className="text-xs">{template.label}</span>
                <span className="text-[10px] text-muted-foreground">{template.hint}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
