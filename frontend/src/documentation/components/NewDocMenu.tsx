import { useEffect, useRef, useState, type ReactNode } from 'react'

import { DOC_TEMPLATES } from '../types'

interface Props {
  trigger: ReactNode
  parentId?: string | null
  onCreate: (input: { title: string; templateId: string; parentId?: string | null }) => void | Promise<void>
}

/**
 * The template picker.
 *
 * A plain popover rather than a shadcn dropdown: the project only ships a
 * handful of primitives and this needs no focus trapping beyond closing on an
 * outside click or Escape.
 */
export function NewDocMenu({ trigger, parentId, onCreate }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <div onClick={() => setOpen((value) => !value)}>{trigger}</div>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {DOC_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
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
        </div>
      )}
    </div>
  )
}
