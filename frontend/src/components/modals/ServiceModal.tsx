import { createElement, useState } from 'react'
import { ChevronDown, RotateCcw, Circle } from 'lucide-react'
import modalStyles from './modal-interactive.module.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ICON_REGISTRY, isBrandIconKey, brandIconSlug, brandIconUrl } from '@/utils/nodeIcons'
import { IconPickerPanel } from './IconPickerPanel'
import { EMPTY_SERVICE_FORM, type ServiceFormData, type ServiceSubmitData } from '@/utils/serviceForm'

interface ServiceModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: ServiceSubmitData) => void
  initial?: ServiceFormData
  title?: string
  confirmLabel?: string
}

export function ServiceModal({ open, onClose, onSubmit, initial, title = 'Add Service', confirmLabel = 'Add' }: ServiceModalProps) {
  const [form, setForm] = useState<ServiceFormData>(initial ?? EMPTY_SERVICE_FORM)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [nameError, setNameError] = useState(false)

  const set = <K extends keyof ServiceFormData>(key: K, value: ServiceFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const setPort = (value: string) => set('port', value.replace(/\D/g, '').slice(0, 5))

  const clampPort = () => {
    if (!form.port) return
    const parsed = Number.parseInt(form.port, 10)
    set('port', Number.isFinite(parsed) ? String(Math.max(1, Math.min(65535, parsed))) : '')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = form.service_name.trim()
    if (!name) {
      setNameError(true)
      return
    }
    const trimmedPort = form.port.trim()
    const port = trimmedPort === '' ? undefined : Number.parseInt(trimmedPort, 10)
    if (port != null && (Number.isNaN(port) || port < 1 || port > 65535)) return
    const path = form.path.trim()
    const hostOverride = form.host.trim()
    onSubmit({
      service_name: name,
      protocol: form.protocol,
      port,
      path: path || undefined,
      host: hostOverride || undefined,
      icon: form.icon,
    })
    onClose()
  }

  const iconPreview = () => {
    if (isBrandIconKey(form.icon)) {
      const slug = brandIconSlug(form.icon!)
      return (
        <>
          <img src={brandIconUrl(slug)} alt={slug} width={13} height={13} className="shrink-0" style={{ width: 13, height: 13, objectFit: 'contain' }} />
          <span className="text-foreground truncate">{slug}</span>
        </>
      )
    }
    const entry = ICON_REGISTRY.find((e) => e.key === form.icon)
    if (entry) {
      return (
        <>
          {createElement(entry.icon, { size: 13, className: 'text-[#00d4ff] shrink-0' })}
          <span className="text-foreground truncate">{entry.label}</span>
        </>
      )
    }
    // A key we can't resolve (e.g. a legacy scanner signature name) is still
    // shown verbatim so saving doesn't look like it silently dropped it.
    return (
      <>
        {createElement(Circle, { size: 13, className: 'text-muted-foreground shrink-0' })}
        <span className="text-muted-foreground truncate">{form.icon ?? 'None'}</span>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Name *</Label>
            <Input
              value={form.service_name}
              onChange={(e) => { set('service_name', e.target.value); if (nameError) setNameError(false) }}
              placeholder="Service name"
              autoFocus
              className={`bg-[#21262d] text-sm h-8 ${nameError ? 'border-[#f85149]' : 'border-[#30363d]'}`}
            />
            {nameError && <span className="text-[10px] text-[#f85149]">Name is required</span>}
          </div>

          {/* Port + protocol */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Port</Label>
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.port}
                onChange={(e) => setPort(e.target.value)}
                onBlur={clampPort}
                placeholder="Port"
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Protocol</Label>
              <select
                value={form.protocol}
                aria-label="Protocol"
                onChange={(e) => set('protocol', e.target.value as 'tcp' | 'udp')}
                className={`bg-[#21262d] border border-[#30363d] text-sm h-8 px-2 text-foreground ${modalStyles['modal-radius']}`}
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
              </select>
            </div>
          </div>

          {/* Host override */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Host</Label>
            <Input
              value={form.host}
              onChange={(e) => set('host', e.target.value)}
              placeholder="Node host (app.example.com)"
              className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
            />
            <span className="text-[10px] text-muted-foreground/60">
              Overrides the node host for this service only.
            </span>
          </div>

          {/* Path */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Path</Label>
            <Input
              value={form.path}
              onChange={(e) => set('path', e.target.value)}
              placeholder="Path (/admin)"
              className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
            />
          </div>

          {/* Icon */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Icon</Label>
              {form.icon && (
                <button
                  type="button"
                  onClick={() => { set('icon', undefined); setIconPickerOpen(false) }}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <RotateCcw size={10} /> Reset
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIconPickerOpen((o) => !o)}
              className={`flex items-center justify-between gap-2 h-8 px-3 bg-[#21262d] border border-[#30363d] text-sm transition-colors w-full cursor-pointer ${modalStyles['modal-interactive']} ${modalStyles['modal-radius']}`}
              aria-label="Icon picker trigger"
            >
              <span className="flex items-center gap-2 min-w-0">{iconPreview()}</span>
              <ChevronDown size={12} className="text-muted-foreground shrink-0" style={{ transform: iconPickerOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
            </button>
            {iconPickerOpen && (
              <IconPickerPanel
                value={form.icon}
                onSelect={(key) => { set('icon', key); setIconPickerOpen(false) }}
              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" className={`cursor-pointer ${modalStyles['modal-cancel-hover']}`} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 cursor-pointer">
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
