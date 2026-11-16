import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

const SHORTCUTS = [
  {
    group: 'Canvas',
    items: [
      { keys: ['Ctrl', 'S'], description: 'Save canvas' },
      { keys: ['Ctrl', 'Z'], description: 'Undo' },
      { keys: ['Ctrl', 'Y'], description: 'Redo' },
      { keys: ['Ctrl', 'K'], description: 'Search nodes' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
  {
    group: 'Nodes',
    items: [
      { keys: ['Ctrl', 'C'], description: 'Copy selected nodes' },
      { keys: ['Ctrl', 'V'], description: 'Paste nodes' },
      { keys: ['Del'], description: 'Delete selected node/edge' },
    ],
  },
  {
    group: 'Navigation',
    items: [
      { keys: ['Scroll'], description: 'Zoom in / out' },
      { keys: ['Space', '+', 'Drag'], description: 'Pan canvas' },
      { keys: ['Ctrl', 'Shift', 'F'], description: 'Fit view' },
    ],
  },
]

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-popover border border-border rounded-lg shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {SHORTCUTS.map((group) => (
            <div key={group.group}>
              <p className="text-xs text-primary font-semibold mb-2 uppercase tracking-wide">
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
                          <kbd key={k} className="text-[11px] text-foreground border border-border rounded px-1.5 py-0.5 font-mono bg-background">
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
