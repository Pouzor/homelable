import { X, Edit, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCanvasStore } from '@/stores/canvasStore'
import { NODE_TYPE_LABELS, STATUS_COLORS, type ServiceInfo } from '@/types'

interface DetailPanelProps {
  onEdit: (id: string) => void
}

export function DetailPanel({ onEdit }: DetailPanelProps) {
  const { nodes, selectedNodeId, setSelectedNode, deleteNode } = useCanvasStore()
  const node = nodes.find((n) => n.id === selectedNodeId)

  if (!node) return null

  const { data } = node
  const statusColor = STATUS_COLORS[data.status]

  const handleDelete = () => {
    if (confirm(`Delete "${data.label}"?`)) {
      deleteNode(node.id)
    }
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
        {data.hostname && <DetailRow label="Hostname" value={data.hostname} mono />}
        {data.ip && <DetailRow label="IP Address" value={data.ip} mono />}
        {data.mac && <DetailRow label="MAC" value={data.mac} mono />}
        {data.os && <DetailRow label="OS" value={data.os} />}
        {data.check_method && <DetailRow label="Check" value={data.check_method} mono />}
        {data.last_seen && (
          <DetailRow
            label="Last Seen"
            value={new Date(data.last_seen).toLocaleString()}
          />
        )}
      </div>

      {/* Services */}
      {data.services.length > 0 && (
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-2">Services ({data.services.length})</div>
          <div className="flex flex-col gap-1.5">
            {data.services.map((svc) => (
              <ServiceBadge key={`${svc.port}-${svc.protocol}`} svc={svc} ip={data.ip} />
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {data.notes && (
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">Notes</div>
          <p className="text-xs text-foreground/80 whitespace-pre-wrap">{data.notes}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex gap-2 px-4 py-3 border-t border-border">
        <Button
          size="sm"
          variant="secondary"
          className="flex-1 gap-1.5"
          onClick={() => onEdit(node.id)}
        >
          <Edit size={14} /> Edit
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          onClick={handleDelete}
        >
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

function getServiceUrl(svc: ServiceInfo, ip?: string): string | null {
  if (!ip) return null
  const name = svc.service_name.toLowerCase()
  const isHttps = name.includes('https') || name.includes('ssl') || svc.port === 443 || svc.port === 8443
  const isHttp = name.includes('http') || [80, 8080, 8000, 3000, 8888, 9000, 8090, 7080].includes(svc.port)
  if (isHttps) return `https://${ip}:${svc.port}`
  if (isHttp) return `http://${ip}:${svc.port}`
  return null
}

function ServiceBadge({ svc, ip }: { svc: ServiceInfo; ip?: string }) {
  const url = getServiceUrl(svc, ip)
  const color = CATEGORY_COLORS[svc.category ?? ''] ?? '#8b949e'

  const inner = (
    <div
      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors"
      style={{
        background: '#21262d',
        borderColor: '#30363d',
        ...(url ? { cursor: 'pointer' } : {}),
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-medium truncate" style={{ color }}>{svc.service_name}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-mono text-[#8b949e]">{svc.port}/{svc.protocol}</span>
        {url && <ExternalLink size={10} className="text-muted-foreground" />}
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
