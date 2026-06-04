import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DESIGN_ICONS, DEFAULT_DESIGN_ICON } from '@/utils/designIcons'

export interface DesignFormData {
  name: string
  icon: string
}

interface DesignModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: DesignFormData) => void
  initial?: DesignFormData
  title?: string
  submitLabel?: string
}

export function DesignModal({ open, onClose, onSubmit, initial, title = 'New Canvas', submitLabel = 'Create' }: DesignModalProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_DESIGN_ICON)

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSubmit({ name: trimmed, icon })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="design-name">Name</Label>
            <Input
              id="design-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="e.g. Home Network, Rack Power"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid grid-cols-8 gap-1.5">
              {DESIGN_ICONS.map((entry) => {
                const Icon = entry.icon
                const selected = entry.key === icon
                return (
                  <button
                    key={entry.key}
                    type="button"
                    aria-label={entry.label}
                    aria-pressed={selected}
                    title={entry.label}
                    onClick={() => setIcon(entry.key)}
                    className={`flex items-center justify-center aspect-square rounded-md border transition-colors cursor-pointer ${
                      selected
                        ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-[#30363d]'
                    }`}
                  >
                    <Icon size={16} />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
