import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EDGE_TYPE_LABELS, type EdgeData, type EdgeType } from '@/types'

const EDGE_TYPES = Object.entries(EDGE_TYPE_LABELS) as [EdgeType, string][]

interface EdgeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: EdgeData) => void
  onDelete?: () => void
  initial?: Partial<EdgeData>
  title?: string
}

export function EdgeModal({ open, onClose, onSubmit, onDelete, initial, title = 'Connect Nodes' }: EdgeModalProps) {
  const [type, setType] = useState<EdgeType>(initial?.type ?? 'ethernet')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [vlanId, setVlanId] = useState(initial?.vlan_id?.toString() ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      type,
      label: label || undefined,
      vlan_id: type === 'vlan' && vlanId ? parseInt(vlanId) : undefined,
    })
    onClose()
  }

  const handleDelete = () => {
    onDelete?.()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#161b22] border-[#30363d] text-foreground max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Link Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as EdgeType)}>
              <SelectTrigger className="bg-[#21262d] border-[#30363d] text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#21262d] border-[#30363d]">
                {EDGE_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-sm">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === 'vlan' && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">VLAN ID</Label>
              <Input
                type="number"
                min={1}
                max={4094}
                value={vlanId}
                onChange={(e) => setVlanId(e.target.value)}
                placeholder="e.g. 20"
                className="bg-[#21262d] border-[#30363d] font-mono text-sm h-8"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Label <span className="text-muted-foreground/50">(optional)</span></Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. 1G, trunk..."
              className="bg-[#21262d] border-[#30363d] text-sm h-8"
            />
          </div>

          <div className="flex justify-between gap-2 pt-1">
            {onDelete ? (
              <Button type="button" variant="ghost" size="sm" className="text-[#f85149] hover:text-[#f85149] hover:bg-[#f85149]/10" onClick={handleDelete}>
                Delete
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button type="submit" size="sm" className="bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90">
                {onDelete ? 'Save' : 'Connect'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
