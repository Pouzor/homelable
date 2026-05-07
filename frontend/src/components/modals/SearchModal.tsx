import { useState, useCallback, useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Search } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { scanApi } from '@/api/client'
import type { PendingDevice } from '@/components/modals/PendingDeviceModal'

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onOpenPending: (deviceId: string) => void
}

export function SearchModal({ open, onClose, onOpenPending }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([])
  const nodes = useCanvasStore((s) => s.nodes)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!open) return
    scanApi.pending().then((res) => setPendingDevices(res.data)).catch(() => {})
  }, [open])

  const searchable = nodes.filter((n) => n.data.type !== 'groupRect')
  const q = query.toLowerCase()

  const nodeResults = q.length === 0 ? [] : searchable.filter((n) =>
    n.data.label?.toLowerCase().includes(q) ||
    n.data.ip?.toLowerCase().includes(q) ||
    n.data.hostname?.toLowerCase().includes(q)
  ).slice(0, 6)

  const pendingResults = q.length === 0 ? [] : pendingDevices.filter((d) =>
    d.ip?.toLowerCase().includes(q) ||
    d.hostname?.toLowerCase().includes(q) ||
    d.friendly_name?.toLowerCase().includes(q) ||
    d.ieee_address?.toLowerCase().includes(q) ||
    d.services.some((s) =>
      s.service_name?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q)
    )
  ).slice(0, 4)

  const totalResults = nodeResults.length + pendingResults.length

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNode(nodeId)
    fitView({ nodes: [{ id: nodeId }], duration: 600, padding: 0.4, maxZoom: 1.5 })
    onClose()
    setQuery('')
  }, [fitView, setSelectedNode, onClose])

  const handleSelectPending = useCallback((deviceId: string) => {
    onOpenPending(deviceId)
    onClose()
    setQuery('')
  }, [onOpenPending, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24" onClick={onClose}>
      <div
        className="bg-[#161b22] border border-border rounded-lg shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes, pending devices by IP or service…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { onClose(); setQuery('') }
              if (e.key === 'Enter' && nodeResults.length > 0) handleSelectNode(nodeResults[0].id)
              if (e.key === 'Enter' && nodeResults.length === 0 && pendingResults.length > 0) handleSelectPending(pendingResults[0].id)
            }}
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1">ESC</kbd>
        </div>

        {totalResults > 0 && (
          <ul className="py-1 max-h-72 overflow-y-auto">
            {nodeResults.map((node) => (
              <li
                key={node.id}
                className="flex items-center gap-3 px-4 py-2 hover:bg-[#21262d] cursor-pointer"
                onClick={() => handleSelectNode(node.id)}
              >
                <span className="text-xs font-mono text-[#00d4ff] w-16 shrink-0">{node.data.type}</span>
                <span className="text-sm text-foreground font-medium flex-1 truncate">{node.data.label}</span>
                {node.data.ip && (
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{node.data.ip}</span>
                )}
              </li>
            ))}
            {pendingResults.length > 0 && nodeResults.length > 0 && (
              <li className="px-4 py-1">
                <div className="h-px bg-border" />
              </li>
            )}
            {pendingResults.map((device) => {
              const serviceName = device.services.find((s) => s.service_name)?.service_name
              return (
                <li
                  key={device.id}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-[#21262d] cursor-pointer"
                  onClick={() => handleSelectPending(device.id)}
                >
                  <span className="text-xs font-mono text-[#e3b341] w-16 shrink-0">pending</span>
                  <span className="text-sm text-foreground font-medium flex-1 truncate font-mono">{device.hostname ?? device.ip}</span>
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{serviceName ?? device.ip}</span>
                </li>
              )
            })}
          </ul>
        )}

        {q.length > 0 && totalResults === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No results match "{query}"</p>
        )}

        {q.length === 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground">Type to search nodes and pending devices…</p>
        )}
      </div>
    </div>
  )
}
