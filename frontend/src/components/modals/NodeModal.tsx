import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NODE_TYPE_LABELS, type NodeData, type NodeType, type CheckMethod } from '@/types'

const NODE_TYPES = Object.entries(NODE_TYPE_LABELS) as [NodeType, string][]

const CHECK_METHODS: CheckMethod[] = ['ping', 'http', 'https', 'tcp', 'ssh', 'prometheus', 'health']

const DEFAULT_DATA: Partial<NodeData> = {
  type: 'server',
  label: '',
  hostname: '',
  ip: '',
  status: 'unknown',
  check_method: 'ping',
  services: [],
  container_mode: true,
}

interface NodeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: Partial<NodeData>) => void
  initial?: Partial<NodeData>
  title?: string
  proxmoxNodes?: { id: string; label: string }[]
}

const CHILD_TYPES: NodeType[] = ['vm', 'lxc']

// NodeModal is always mounted with a key that changes on open/edit, so useState
// initial value is enough — no need for a reset effect.
export function NodeModal({ open, onClose, onSubmit, initial, title = 'Add Node', proxmoxNodes = [] }: NodeModalProps) {
  const [form, setForm] = useState<Partial<NodeData>>({ ...DEFAULT_DATA, ...initial })

  const set = (key: keyof NodeData, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.label?.trim()) return
    onSubmit(form)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            {/* Type */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as NodeType)}>
                <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#21262d] border-[#30363d]">
                  {NODE_TYPES.map(([value, label]) => (
                    <SelectItem key={value} value={value} className="text-sm">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Label */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Label *</Label>
              <Input
                value={form.label ?? ''}
                onChange={(e) => set('label', e.target.value)}
                placeholder="My Server"
                className="bg-[#21262d] border-[#30363d] text-sm h-8"
                required
              />
            </div>

            {/* Hostname */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Hostname</Label>
              <Input
                value={form.hostname ?? ''}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="server.lan"
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>

            {/* IP */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">IP Address</Label>
              <Input
                value={form.ip ?? ''}
                onChange={(e) => set('ip', e.target.value)}
                placeholder="192.168.1.x"
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>

            {/* Check method */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Check Method</Label>
              <Select value={form.check_method ?? 'ping'} onValueChange={(v) => set('check_method', v as CheckMethod)}>
                <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#21262d] border-[#30363d]">
                  {CHECK_METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="text-sm font-mono">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Check target */}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Check Target</Label>
              <Input
                value={form.check_target ?? ''}
                onChange={(e) => set('check_target', e.target.value)}
                placeholder="http://..."
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>

            {/* Parent Proxmox (VM / LXC only) */}
            {CHILD_TYPES.includes(form.type as NodeType) && proxmoxNodes.length > 0 && (
              <div className="flex flex-col gap-1.5 col-span-2">
                <Label className="text-xs text-muted-foreground">Parent Proxmox</Label>
                <Select
                  value={form.parent_id ?? 'none'}
                  onValueChange={(v) => set('parent_id', v === 'none' ? undefined : v)}
                >
                  <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                    <SelectValue placeholder="None (standalone)" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#21262d] border-[#30363d]">
                    <SelectItem value="none" className="text-sm">None (standalone)</SelectItem>
                    {proxmoxNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-sm">{n.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Container mode (proxmox only) */}
            {form.type === 'proxmox' && (
              <div className="flex items-center justify-between col-span-2 py-1">
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs text-muted-foreground">Container Mode</Label>
                  <span className="text-[10px] text-muted-foreground/60">Show VM/LXC nodes nested inside</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!form.container_mode}
                  onClick={() => set('container_mode', !form.container_mode)}
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
                  style={{ background: form.container_mode ? '#ff6e00' : '#30363d' }}
                >
                  <span
                    className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                    style={{ transform: form.container_mode ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>
            )}

            {/* Notes */}
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Input
                value={form.notes ?? ''}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Optional notes"
                className="bg-[#21262d] border-[#30363d] text-sm h-8"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
            >
              {title === 'Add Node' ? 'Add' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
