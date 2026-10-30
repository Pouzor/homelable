import { useState, type ReactElement } from 'react'
import { Popover } from '@base-ui/react/popover'

import { cn } from '@/lib/utils'

/**
 * The emoji a document wears in the tree, in place of its page or folder icon.
 *
 * A short curated grid covers the homelab staples; the field below takes
 * anything else, typed or pasted from the OS emoji picker. Stored as the raw
 * string in `documents.icon` — no shortcode, so it renders the same everywhere.
 */

const DOC_ICONS = [
  '📄', '📁', '📌', '⭐', '🏠', '📘', '📝', '✅',
  '⚠️', '🔥', '🚨', '🐛', '🔧', '⚙️', '🛠️', '🧰',
  '🖥️', '💻', '🗄️', '💾', '🌐', '📡', '📶', '🔌',
  '🔒', '🔑', '🛡️', '🐳', '☁️', '📦', '⚡', '🔋',
  '📷', '💡', '🌡️', '🎮', '📺', '🎵', '📊', '🧪',
]

interface Props {
  icon: string | null | undefined
  /** `null` takes the emoji off and gives the row its default icon back. */
  onChange: (icon: string | null) => void
  trigger: ReactElement
}

export function IconPicker({ icon, onChange, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')

  function pick(value: string | null) {
    onChange(value)
    setCustom('')
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={4} className="isolate z-50">
          <Popover.Popup
            aria-label="Choose an icon"
            className="w-64 rounded-lg bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            <div className="grid grid-cols-8 gap-0.5">
              {DOC_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Use ${emoji}`}
                  aria-pressed={icon === emoji}
                  onClick={() => pick(emoji)}
                  className={cn(
                    'flex size-7 cursor-pointer items-center justify-center rounded text-base hover:bg-muted',
                    icon === emoji && 'bg-primary/15 ring-1 ring-inset ring-primary/60',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                const value = custom.trim()
                if (value) pick(value)
              }}
            >
              <input
                value={custom}
                aria-label="Custom emoji"
                placeholder="Or paste any emoji…"
                maxLength={16}
                onChange={(event) => setCustom(event.target.value)}
                className="min-w-0 flex-1 rounded bg-muted px-1.5 py-1 text-xs text-foreground outline-none ring-1 ring-border focus:ring-primary"
              />
              {icon && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="cursor-pointer rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Remove
                </button>
              )}
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
