import { useState, useCallback, useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Search } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { documentsApi, scanApi } from '@/api/client'
import type { DocSearchHit } from '@/documentation/types'
import type { InventoryEntry } from '@/components/modals/InventoryDeviceModal'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

/** Long enough that a stray keystroke does not hit the server. */
const DOC_SEARCH_DEBOUNCE = 250

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onOpenInventory: (deviceId: string) => void
  /** Omitted in standalone, where there are no documents to open. */
  onOpenDocument?: (docId: string) => void
}

export function SearchModal({ open, onClose, onOpenInventory, onOpenDocument }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [inventoryDevices, setInventoryEntrys] = useState<InventoryEntry[]>([])
  // Kept with the query it answered, so a stale answer is never shown against a
  // newer query and no effect has to clear it.
  const [docHits, setDocHits] = useState<{ query: string; hits: DocSearchHit[] }>({ query: '', hits: [] })
  const nodes = useCanvasStore((s) => s.nodes)
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode)
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!open) return
    scanApi.pending().then((res) => setInventoryEntrys(res.data)).catch(() => {})
  }, [open])

  const q = query.toLowerCase()

  // Documents are not in memory — the tree only ever holds their metadata, and
  // the body is what makes a search worth running — so this one goes to the
  // server's index rather than filtering a local list.
  useEffect(() => {
    if (!open || STANDALONE || !onOpenDocument) return
    const needle = query.trim()
    if (needle.length < 2) return
    let live = true
    const timer = setTimeout(async () => {
      try {
        const { data } = await documentsApi.search(needle, 5)
        if (live) setDocHits({ query: needle, hits: data.hits })
      } catch {
        // The rest of the modal still works without the index.
        if (live) setDocHits({ query: needle, hits: [] })
      }
    }, DOC_SEARCH_DEBOUNCE)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [open, query, onOpenDocument])

  const searchable = nodes.filter((n) => n.data.type !== 'groupRect')

  const nodeResults = q.length === 0 ? [] : searchable.filter((n) =>
    n.data.label?.toLowerCase().includes(q) ||
    n.data.ip?.toLowerCase().includes(q) ||
    n.data.hostname?.toLowerCase().includes(q)
  ).slice(0, 6)

  const pendingResults = q.length === 0 ? [] : inventoryDevices.filter((d) =>
    d.ip?.toLowerCase().includes(q) ||
    d.hostname?.toLowerCase().includes(q) ||
    d.friendly_name?.toLowerCase().includes(q) ||
    d.ieee_address?.toLowerCase().includes(q) ||
    d.services.some((s) =>
      s.service_name?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q)
    )
  ).slice(0, 4)

  const documentResults = docHits.query && docHits.query === query.trim() ? docHits.hits : []

  const totalResults = nodeResults.length + pendingResults.length + documentResults.length

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNode(nodeId)
    fitView({ nodes: [{ id: nodeId }], duration: 600, padding: 0.4, maxZoom: 1.5 })
    onClose()
    setQuery('')
  }, [fitView, setSelectedNode, onClose])

  const handleSelectInventoryDevice = useCallback((deviceId: string) => {
    onOpenInventory(deviceId)
    onClose()
    setQuery('')
  }, [onOpenInventory, onClose])

  const handleSelectDocument = useCallback((docId: string) => {
    onOpenDocument?.(docId)
    onClose()
    setQuery('')
  }, [onOpenDocument, onClose])

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
            placeholder="Search nodes, devices and documents…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { onClose(); setQuery('') }
              // Enter takes the first result in the order they are listed.
              if (e.key === 'Enter' && nodeResults.length > 0) handleSelectNode(nodeResults[0].id)
              else if (e.key === 'Enter' && pendingResults.length > 0) handleSelectInventoryDevice(pendingResults[0].id)
              else if (e.key === 'Enter' && documentResults.length > 0) handleSelectDocument(documentResults[0].doc_id)
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
                  onClick={() => handleSelectInventoryDevice(device.id)}
                >
                  <span className="text-xs font-mono text-[#e3b341] w-16 shrink-0">pending</span>
                  <span className="text-sm text-foreground font-medium flex-1 truncate font-mono">{device.hostname ?? device.ip}</span>
                  <span className="text-xs font-mono text-muted-foreground shrink-0">{serviceName ?? device.ip}</span>
                </li>
              )
            })}
            {documentResults.length > 0 && nodeResults.length + pendingResults.length > 0 && (
              <li className="px-4 py-1">
                <div className="h-px bg-border" />
              </li>
            )}
            {documentResults.map((hit) => (
              <li
                key={hit.doc_id}
                className="flex items-center gap-3 px-4 py-2 hover:bg-[#21262d] cursor-pointer"
                onClick={() => handleSelectDocument(hit.doc_id)}
              >
                <span className="text-xs font-mono text-[#a855f7] w-16 shrink-0">
                  {hit.kind === 'device' ? 'doc·dev' : 'doc'}
                </span>
                <span className="text-sm text-foreground font-medium flex-1 truncate">{hit.title}</span>
                {/* The snippet is the line the match sits on; it is the only
                    reason a body search beats scanning the tree by eye. */}
                {hit.snippet && (
                  <span className="text-xs text-muted-foreground shrink-0 max-w-[45%] truncate">
                    {hit.snippet}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {q.length > 0 && totalResults === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No results match "{query}"</p>
        )}

        {q.length === 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Type to search nodes, pending devices{onOpenDocument && !STANDALONE ? ' and documents' : ''}…
          </p>
        )}
      </div>
    </div>
  )
}
