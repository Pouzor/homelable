import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t, useLocale } from '@/i18n'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  useLocale()
  if (!open) return null

  // Built inside the component so the labels go through `t`; a module-level
  // table would be created once at import, before the locale is known. The
  // `keys` stay verbatim — they are the key bindings themselves.
  const shortcuts = [
    {
      group: t('Canvas'),
      items: [
        { keys: ['Ctrl', 'S'], description: t('Save canvas') },
        { keys: ['Ctrl', 'Z'], description: t('Undo') },
        { keys: ['Ctrl', 'Y'], description: t('Redo') },
        { keys: ['Ctrl', 'K'], description: t('Search nodes') },
        { keys: ['?'], description: t('Show this help') },
      ],
    },
    {
      group: t('Nodes'),
      items: [
        { keys: ['Ctrl', 'C'], description: t('Copy selected nodes') },
        { keys: ['Ctrl', 'V'], description: t('Paste nodes') },
        { keys: ['Del'], description: t('Delete selected node/edge') },
      ],
    },
    {
      group: t('Navigation'),
      items: [
        { keys: ['Scroll'], description: t('Zoom in / out') },
        { keys: ['Space', '+', 'Drag'], description: t('Pan canvas') },
        { keys: ['Ctrl', 'Shift', 'F'], description: t('Fit view') },
      ],
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[#161b22] border border-border rounded-lg shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{t('Keyboard Shortcuts')}</h2>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {shortcuts.map((group) => (
            <div key={group.group}>
              <p className="text-xs text-[#00d4ff] font-semibold mb-2 uppercase tracking-wide">
                {group.group}
              </p>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.description} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">{item.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, i) => (
                        k === '+' ? (
                          <span key={i} className="text-xs text-muted-foreground">+</span>
                        ) : (
                          <kbd key={k} className="text-[11px] text-foreground border border-border rounded px-1.5 py-0.5 font-mono bg-[#0d1117]">
                            {k}
                          </kbd>
                        )
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
