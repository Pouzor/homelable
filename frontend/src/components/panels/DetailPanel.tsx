import { useState } from 'react'
import { X, Edit, Trash2, ExternalLink, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCanvasStore } from '@/stores/canvasStore'
import { NODE_TYPE_LABELS, STATUS_COLORS, type ServiceInfo } from '@/types'
import { getServiceUrl } from '@/utils/serviceUrl'

interface DetailPanelProps {
  onEdit: (id: string) => void
}

export function DetailPanel({ onEdit }: DetailPanelProps) {
  const { nodes, selectedNodeId, setSelectedNode, deleteNode, updateNode } = useCanvasStore()
  const node = nodes.find((n) => n.id === selectedNodeId)

  const [addingService, setAddingService] = useState(false)
  const [newSvc, setNewSvc] = useState<{ port: string; protocol: 'tcp' | 'udp'; service_name: string }>({
    port: '',
    protocol: 'tcp',
    service_name: '',
  })

  if (!node || node.data.type === 'groupRect') return null

  const { data } = node
  const statusColor = STATUS_COLORS[data.status]
  const host = data.ip ?? data.hostname

  const handleDelete = () => {
    if (confirm(`Delete "${data.label}"?`)) {
      deleteNode(node.id)
    }
  }

  const handleAddService = () => {
    const port = parseInt(newSvc.port, 10)
    if (!newSvc.service_name.trim() || isNaN(port) || port < 1 || port > 65535) return
    const svc: ServiceInfo = {
      port,
      protocol: newSvc.protocol,
      service_name: newSvc.service_name.trim(),
    }
    updateNode(node.id, { services: [...(data.services ?? []), svc] })
    setNewSvc({ port: '', protocol: 'tcp', service_name: '' })
    setAddingService(false)
  }

  const handleRemoveService = (index: number) => {
    const updated = data.services.filter((_, i) => i !== index)
    updateNode(node.id, { services: updated })
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-border bg-[#161b22] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm text-foreground truncate">{data.label}</span>
        <button
          onClick={() => setSelectedNode(null)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
        <span className="text-sm capitalize" style={{ color: statusColor }}>{data.status}</span>
        {data.response_time_ms !== undefined && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">{data.response_time_ms}ms</span>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-col gap-3 px-4 py-3 text-sm">
        <DetailRow label="Type" value={NODE_TYPE_LABELS[data.type]} />
        {data.hostname && (
          <div className="flex justify-between gap-2 items-baseline">
            <span className="text-muted-foreground text-xs shrink-0">Hostname</span>
            <a
              href={`http://${data.hostname}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-[#00d4ff] hover:underline truncate flex items-center gap-1"
              title={data.hostname}
            >
              {data.hostname}
              <ExternalLink size={10} className="shrink-0" />
            </a>
          </div>
        )}
        {data.ip && <DetailRow label="IP Address" value={data.ip} mono />}
        {data.mac && <DetailRow label="MAC" value={data.mac} mono />}
        {data.os && <DetailRow label="OS" value={data.os} />}
        {data.check_method && <DetailRow label="Check" value={data.check_method} mono />}
        {data.last_seen && (
          <DetailRow label="Last Seen" value={new Date(data.last_seen).toLocaleString()} />
        )}
      </div>

      {/* Services */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">
            Services{data.services.length > 0 ? ` (${data.services.length})` : ''}
          </span>
          <button
            onClick={() => setAddingService((v) => !v)}
            className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors"
          >
            <Plus size={10} /> Add
          </button>
        </div>

        {/* Add service form */}
        {addingService && (
          <div className="flex flex-col gap-1.5 mb-2 p-2 rounded-md bg-[#0d1117] border border-[#30363d]">
            <Input
              value={newSvc.service_name}
              onChange={(e) => setNewSvc((s) => ({ ...s, service_name: e.target.value }))}
              placeholder="Service name"
              className="bg-[#21262d] border-[#30363d] text-xs h-7"
              autoFocus
            />
            <div className="flex gap-1.5">
              <Input
                type="number"
                value={newSvc.port}
                onChange={(e) => setNewSvc((s) => ({ ...s, port: e.target.value }))}
                placeholder="Port"
                min={1}
                max={65535}
                className="bg-[#21262d] border-[#30363d] font-mono text-xs h-7 w-20 shrink-0"
              />
              <select
                value={newSvc.protocol}
                onChange={(e) => setNewSvc((s) => ({ ...s, protocol: e.target.value as 'tcp' | 'udp' }))}
                className="flex-1 bg-[#21262d] border border-[#30363d] rounded-md text-xs h-7 px-1.5 text-foreground"
              >
                <option value="tcp">tcp</option>
                <option value="udp">udp</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1 h-6 text-[10px] bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
                onClick={handleAddService}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => setAddingService(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {data.services.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {data.services.map((svc, i) => (
              <ServiceBadge
                key={`${svc.port}-${svc.protocol}-${i}`}
                svc={svc}
                host={host}
                onRemove={() => handleRemoveService(i)}
              />
            ))}
          </div>
        )}

        {data.services.length === 0 && !addingService && (
          <p className="text-[10px] text-muted-foreground/50">No services — click Add to register one.</p>
        )}
      </div>

      {/* Notes */}
      {data.notes && (
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">Notes</div>
          <p className="text-xs text-foreground/80 whitespace-pre-wrap">{data.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex gap-2 px-4 py-3 border-t border-border">
        <Button size="sm" variant="secondary" className="flex-1 gap-1.5" onClick={() => onEdit(node.id)}>
          <Edit size={14} /> Edit
        </Button>
        <Button size="sm" variant="destructive" className="gap-1.5" onClick={handleDelete}>
          <Trash2 size={14} />
        </Button>
      </div>
    </aside>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 items-baseline">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span
        className={`text-xs text-right truncate ${mono ? 'font-mono text-[#00d4ff]' : 'text-foreground'}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  web: '#00d4ff',
  database: '#a855f7',
  monitoring: '#39d353',
  storage: '#e3b341',
  security: '#f85149',
  remote: '#8b949e',
}

function ServiceBadge({ svc, host, onRemove }: { svc: ServiceInfo; host?: string; onRemove: () => void }) {
  const url = getServiceUrl(svc, host)
  const color = CATEGORY_COLORS[svc.category ?? ''] ?? '#8b949e'

  const inner = (
    <div
      className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors"
      style={{
        background: '#21262d',
        borderColor: '#30363d',
        cursor: url ? 'pointer' : 'default',
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-medium truncate" style={{ color }}>{svc.service_name}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-mono text-[#8b949e]">{svc.port}/{svc.protocol}</span>
        {url && <ExternalLink size={10} className="text-muted-foreground" />}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149] ml-0.5"
          title="Remove service"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  )

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block hover:opacity-80 transition-opacity">
        {inner}
      </a>
    )
  }
  return inner
}
