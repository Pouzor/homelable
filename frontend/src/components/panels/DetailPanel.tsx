import { createElement, useRef, useState } from 'react'
import { X, Edit, Trash2, ExternalLink, Plus, Pencil, Layers, Ungroup, Eye, EyeOff, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useCanvasStore, serviceStatusKey } from '@/stores/canvasStore'
import { NODE_TYPE_LABELS, STATUS_COLORS, type ServiceInfo, type ServiceStatus, type NodeData, type NodeProperty } from '@/types'
import { getServiceUrl } from '@/utils/serviceUrl'
import { splitIps } from '@/utils/maskIp'
import { PropertyList } from '@/components/common/PropertyList'
import { formatTimestamp } from '@/utils/timeFormat'
import { ServiceModal } from '@/components/modals/ServiceModal'
import { serviceToForm, type ServiceFormData, type ServiceSubmitData } from '@/utils/serviceForm'
import { ServiceIcon } from '@/components/ui/ServiceIcon'
import type { Node } from '@xyflow/react'

interface DetailPanelProps {
  onEdit: (id: string) => void
}

/** Open service editor: `index === null` means "add a new service". */
type SvcModalState = { nodeId: string; index: number | null; form?: ServiceFormData }

export function DetailPanel({ onEdit }: DetailPanelProps) {
  const { nodes, selectedNodeId, selectedNodeIds, setSelectedNode, deleteNode, updateNode, snapshotHistory, createGroup, ungroup, removeFromGroup, setNodeSize } = useCanvasStore()
  const serviceStatuses = useCanvasStore((s) => s.serviceStatuses)

  const [svcModal, setSvcModal] = useState<SvcModalState | null>(null)
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  const [dragSvcIndex, setDragSvcIndex] = useState<number | null>(null)
  const [dragOverSvcIndex, setDragOverSvcIndex] = useState<number | null>(null)

  // Multi-select panel
  const multiSelected = (selectedNodeIds ?? []).filter((id) => nodes.some((n) => n.id === id))

  if (multiSelected.length > 1) {
    return (
      <MultiSelectPanel
        nodeIds={multiSelected}
        nodes={nodes}
        groupName={groupName}
        setGroupName={setGroupName}
        creatingGroup={creatingGroup}
        setCreatingGroup={setCreatingGroup}
        onCreateGroup={(name) => { createGroup(multiSelected, name); setGroupName(''); setCreatingGroup(false) }}
        onClose={() => setSelectedNode(null)}
      />
    )
  }

  const node = nodes.find((n) => n.id === selectedNodeId)
  if (!node || node.data.type === 'groupRect') return null

  // Group detail panel
  if (node.data.type === 'group') {
    return (
      <GroupDetailPanel
        node={node}
        nodes={nodes}
        onUngroup={() => { ungroup(node.id) }}
        onRemoveChild={(id) => { snapshotHistory(); removeFromGroup(node.id, id) }}
        onChangeDescription={(value) => updateNode(node.id, { notes: value })}
        onSnapshotBeforeEdit={snapshotHistory}
        onToggleBorder={() => {
          snapshotHistory()
          updateNode(node.id, {
            custom_colors: {
              ...node.data.custom_colors,
              show_border: !(node.data.custom_colors?.show_border !== false),
            },
          })
        }}
        onClose={() => setSelectedNode(null)}
        onSelectChild={(id) => setSelectedNode(id)}
      />
    )
  }

  // Normal single-node panel
  const openSvcModal = svcModal?.nodeId === node.id ? svcModal : null
  const { data } = node
  const services = data.services ?? []
  const statusColor = STATUS_COLORS[data.status]
  const ipAddresses = data.ip ? splitIps(data.ip) : []
  const host = ipAddresses[0] ?? data.hostname

  const handleDelete = () => {
    if (confirm(`Delete "${data.label}"?`)) {
      snapshotHistory()
      deleteNode(node.id)
    }
  }

  const handleSubmitService = (data: ServiceSubmitData) => {
    if (!openSvcModal) return
    snapshotHistory()
    if (openSvcModal.index === null) {
      const svc: ServiceInfo = {
        ...(data.port != null ? { port: data.port } : {}),
        protocol: data.protocol,
        service_name: data.service_name,
        ...(data.path ? { path: data.path } : {}),
        ...(data.icon ? { icon: data.icon } : {}),
      }
      updateNode(node.id, { services: [...services, svc] })
      return
    }
    const updated = services.map((svc, i) =>
      i === openSvcModal.index
        ? {
            ...svc,
            protocol: data.protocol,
            service_name: data.service_name,
            port: data.port,
            path: data.path,
            icon: data.icon,
          }
        : svc
    )
    updateNode(node.id, { services: updated })
  }

  const handleRemoveService = (index: number) => {
    snapshotHistory()
    const updated = services.filter((_, i) => i !== index)
    updateNode(node.id, { services: updated })
    if (openSvcModal?.index === index) setSvcModal(null)
  }

  const handleStartEdit = (index: number) => {
    const svc = services[index]
    if (!svc) return
    setSvcModal({ nodeId: node.id, index, form: serviceToForm(svc) })
  }

  const handleReorderService = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= services.length || to >= services.length) return
    snapshotHistory()
    const reordered = [...services]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    updateNode(node.id, { services: reordered })
  }

  // --- Property handlers ---
  const properties: NodeProperty[] = data.properties ?? []

  const handleChangeProps = (next: NodeProperty[]) => {
    snapshotHistory()
    updateNode(node.id, { properties: next })
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-border bg-[#161b22] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm text-foreground truncate">{data.label}</span>
        <button aria-label="Close panel" onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
        <span className="text-sm capitalize" style={{ color: statusColor }}>{data.status}</span>
        {data.response_time_ms !== undefined && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">{data.response_time_ms}ms</span>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 text-sm">
        <DetailRow label="Type" value={NODE_TYPE_LABELS[data.type]} />
        {data.hostname && (
          <div className="flex justify-between gap-2 items-baseline">
            <span className="text-muted-foreground text-xs shrink-0">Hostname</span>
            <a href={`http://${data.hostname}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-[#00d4ff] hover:underline truncate flex items-center gap-1" title={data.hostname}>
              {data.hostname}<ExternalLink size={10} className="shrink-0" />
            </a>
          </div>
        )}
        {ipAddresses.length > 0 && (
          <div className="flex justify-between gap-2 items-start">
            <span className="text-muted-foreground text-xs shrink-0">{ipAddresses.length > 1 ? 'IP Addresses' : 'IP Address'}</span>
            <div className="flex flex-wrap justify-end items-center gap-x-2 gap-y-1 max-w-[65%]">
              {ipAddresses.map((ip, index) => (
                <span key={`${ip}-${index}`} className="inline-flex items-center shrink-0 whitespace-nowrap">
                  <a
                    href={`http://${ip}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#00d4ff] hover:underline inline-flex items-center gap-1"
                    title={ip}
                  >
                    {ip}
                    <ExternalLink size={10} className="shrink-0" />
                  </a>
                </span>
              ))}
            </div>
          </div>
        )}
        {data.mac && <DetailRow label="MAC" value={data.mac} mono />}
        {data.os && <DetailRow label="OS" value={data.os} />}
        {data.check_method && <DetailRow label="Check" value={data.check_method} mono />}
        {data.last_seen && <DetailRow label="Last Seen" value={formatTimestamp(data.last_seen)} />}
        {data.last_scan && <DetailRow label="Last Scan" value={formatTimestamp(data.last_scan)} />}
        {data.created_at && <DetailRow label="Created" value={formatTimestamp(data.created_at)} />}
        {data.updated_at && <DetailRow label="Last Modified" value={formatTimestamp(data.updated_at)} />}
      </div>

      {/* Size section — manual width/height entry for pixel-exact sizing */}
      <SizeFields
        key={node.id}
        node={node}
        onCommit={(size) => { snapshotHistory(); setNodeSize(node.id, size) }}
      />

      {/* Properties section */}
      <PropertyList properties={properties} onChange={handleChangeProps} />

      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Services{services.length > 0 ? ` (${services.length})` : ''}</span>
          <button onClick={() => setSvcModal({ nodeId: node.id, index: null })} className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors cursor-pointer">
            <Plus size={10} /> Add
          </button>
        </div>
        {services.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {services.map((svc, i) => (
                <ServiceBadge
                  key={`${svc.port ?? 'host'}-${svc.protocol}-${svc.path ?? ''}-${i}`}
                  svc={svc}
                  host={host}
                  status={serviceStatuses[serviceStatusKey(node.id, svc.port, svc.protocol)]}
                  draggable={services.length > 1}
                  isDragging={dragSvcIndex === i}
                  isDragOver={dragOverSvcIndex === i && dragSvcIndex !== i}
                  onDragStart={() => setDragSvcIndex(i)}
                  onDragEnter={() => { if (dragSvcIndex !== null) setDragOverSvcIndex(i) }}
                  onDragEnd={() => { setDragSvcIndex(null); setDragOverSvcIndex(null) }}
                  onDrop={() => {
                    if (dragSvcIndex !== null) handleReorderService(dragSvcIndex, i)
                    setDragSvcIndex(null)
                    setDragOverSvcIndex(null)
                  }}
                  onEdit={() => handleStartEdit(i)}
                  onRemove={() => handleRemoveService(i)}
                />
            ))}
          </div>
        )}
        {services.length === 0 && <p className="text-[10px] text-muted-foreground/50">No services — click Add to register one.</p>}
      </div>

      {openSvcModal && (
        <ServiceModal
          key={`svc-${openSvcModal.index ?? 'new'}`}
          open
          onClose={() => setSvcModal(null)}
          onSubmit={handleSubmitService}
          initial={openSvcModal.form}
          title={openSvcModal.index === null ? 'Add Service' : 'Edit Service'}
          confirmLabel={openSvcModal.index === null ? 'Add' : 'Save'}
        />
      )}

      {data.notes && (
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">Notes</div>
          <p className="text-xs text-foreground/80 whitespace-pre-wrap">{data.notes}</p>
        </div>
      )}

      <div className="mt-auto flex gap-2 px-4 py-3 border-t border-border">
        <Button size="sm" variant="secondary" className="flex-1 gap-1.5 cursor-pointer" onClick={() => onEdit(node.id)}>
          <Edit size={14} /> Edit
        </Button>
        <Button size="sm" variant="destructive" className="gap-1.5 cursor-pointer" aria-label="Delete node" onClick={handleDelete}>
          <Trash2 size={14} />
        </Button>
      </div>
    </aside>
  )
}

// --- Size fields (manual width/height entry) ---

const round = (v: number | undefined): string => (v != null ? String(Math.round(v)) : '')

function SizeFields({ node, onCommit }: { node: Node<NodeData>; onCommit: (size: { width?: number; height?: number }) => void }) {
  // Live size from the explicit dimension, falling back to the DOM-measured
  // size so the field shows the node's current footprint even before resize.
  const liveWidth = round(node.width ?? node.measured?.width)
  const liveHeight = round(node.height ?? node.measured?.height)
  const [width, setWidth] = useState(liveWidth)
  const [height, setHeight] = useState(liveHeight)

  // Resync the fields when the node is resized by dragging its corner handle
  // (which mutates node.width/height in the store). Adjusting state during
  // render — the React-blessed alternative to an effect — keeps it in step
  // without cascading renders. The field the user is actively editing is left
  // alone so we don't clobber their keystrokes mid-type.
  const [editing, setEditing] = useState<'width' | 'height' | null>(null)
  const [prev, setPrev] = useState({ w: liveWidth, h: liveHeight })
  if (prev.w !== liveWidth || prev.h !== liveHeight) {
    setPrev({ w: liveWidth, h: liveHeight })
    if (editing !== 'width') setWidth(liveWidth)
    if (editing !== 'height') setHeight(liveHeight)
  }

  const commit = (raw: string, axis: 'width' | 'height') => {
    const n = Number(raw)
    if (!raw.trim() || Number.isNaN(n) || n <= 0) {
      // Reset the field to the live value on invalid input — no mutation.
      if (axis === 'width') setWidth(round(node.width ?? node.measured?.width))
      else setHeight(round(node.height ?? node.measured?.height))
      return
    }
    onCommit({ [axis]: n })
  }

  return (
    <div className="px-4 py-3 border-t border-border">
      <span className="text-xs text-muted-foreground">Size</span>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex flex-1 items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/70 w-3">W</span>
          <Input
            type="number"
            min={140}
            aria-label="Width"
            value={width}
            onFocus={() => setEditing('width')}
            onChange={(e) => setWidth(e.target.value)}
            onBlur={() => { setEditing(null); commit(width, 'width') }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="h-7 text-xs font-mono"
          />
        </label>
        <label className="flex flex-1 items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/70 w-3">H</span>
          <Input
            type="number"
            min={50}
            aria-label="Height"
            value={height}
            onFocus={() => setEditing('height')}
            onChange={(e) => setHeight(e.target.value)}
            onBlur={() => { setEditing(null); commit(height, 'height') }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="h-7 text-xs font-mono"
          />
        </label>
      </div>
    </div>
  )
}

// --- Multi-select panel ---

interface MultiSelectPanelProps {
  nodeIds: string[]
  nodes: Node<NodeData>[]
  groupName: string
  setGroupName: (v: string) => void
  creatingGroup: boolean
  setCreatingGroup: (v: boolean) => void
  onCreateGroup: (name: string) => void
  onClose: () => void
}

function MultiSelectPanel({ nodeIds, nodes, groupName, setGroupName, creatingGroup, setCreatingGroup, onCreateGroup, onClose }: MultiSelectPanelProps) {
  const selectedNodes = nodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as Node<NodeData>[]

  const handleCreate = () => {
    const name = groupName.trim() || 'Group'
    onCreateGroup(name)
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-border bg-[#161b22] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[#00d4ff]" />
          <span className="font-semibold text-sm text-foreground">{nodeIds.length} nodes selected</span>
        </div>
        <button aria-label="Close panel" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-1.5 overflow-y-auto">
        {selectedNodes.map((n) => (
          <div key={n.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#21262d] text-xs">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[n.data.status] }} />
            <span className="truncate text-foreground font-medium">{n.data.label}</span>
            <span className="ml-auto text-muted-foreground shrink-0">{NODE_TYPE_LABELS[n.data.type] ?? n.data.type}</span>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-border space-y-2">
        {creatingGroup ? (
          <>
            <Input
              autoFocus
              placeholder="Group name…"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreatingGroup(false) }}
              className="bg-[#21262d] border-[#30363d] text-xs h-7"
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-7 text-[10px] bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90" onClick={handleCreate}>
                Create Group
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setCreatingGroup(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button
            data-tour="create-group"
            size="sm"
            className="w-full gap-2 bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/20"
            variant="ghost"
            onClick={() => setCreatingGroup(true)}
          >
            <Layers size={13} /> Create Group
          </Button>
        )}
      </div>
    </aside>
  )
}

// --- Group detail panel ---

interface GroupDetailPanelProps {
  node: Node<NodeData>
  nodes: Node<NodeData>[]
  onUngroup: () => void
  onRemoveChild: (id: string) => void
  onChangeDescription: (value: string) => void
  onSnapshotBeforeEdit: () => void
  onToggleBorder: () => void
  onClose: () => void
  onSelectChild: (id: string) => void
}

function GroupDetailPanel({ node, nodes, onUngroup, onRemoveChild, onChangeDescription, onSnapshotBeforeEdit, onToggleBorder, onClose, onSelectChild }: GroupDetailPanelProps) {
  const children = nodes.filter((n) => n.parentId === node.id)
  const onlineCount = children.filter((n) => n.data.status === 'online').length
  const offlineCount = children.filter((n) => n.data.status === 'offline').length
  const showBorder = node.data.custom_colors?.show_border !== false

  // Description reuses data.notes, which already round-trips to the backend.
  // Controlled + committed on every keystroke so ANY save path (incl. Ctrl+S,
  // which never blurs the field) captures it. History is snapshotted once at the
  // start of an edit session so the whole edit is a single undo step.
  const snappedRef = useRef(false)
  const handleDescriptionChange = (value: string) => {
    if (!snappedRef.current) {
      onSnapshotBeforeEdit()
      snappedRef.current = true
    }
    onChangeDescription(value)
  }

  const handleUngroup = () => {
    if (confirm(`Ungroup "${node.data.label}"? Nodes will be released to the canvas.`)) {
      onUngroup()
    }
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-border bg-[#161b22] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={14} className="text-[#00d4ff] shrink-0" />
          <span className="font-semibold text-sm text-foreground truncate">{node.data.label}</span>
        </div>
        <button aria-label="Close panel" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <X size={16} />
        </button>
      </div>

      {/* Status summary */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border text-xs">
        <span className="text-muted-foreground">{children.length} node{children.length !== 1 ? 's' : ''}</span>
        {onlineCount > 0 && <span style={{ color: STATUS_COLORS.online }}>● {onlineCount} online</span>}
        {offlineCount > 0 && <span style={{ color: STATUS_COLORS.offline }}>● {offlineCount} offline</span>}
      </div>

      {/* Description */}
      <div className="px-4 py-3 border-b border-border">
        <label htmlFor="group-description" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          Description
        </label>
        <textarea
          id="group-description"
          value={node.data.notes ?? ''}
          onFocus={() => { snappedRef.current = false }}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder="Add a description for this group…"
          rows={3}
          className="mt-1.5 w-full resize-y rounded-md bg-[#21262d] border border-[#30363d] px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-[#00d4ff]/50"
        />
      </div>

      {/* Children list */}
      <div className="flex-1 px-4 py-3 space-y-1.5 overflow-y-auto">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Members</span>
        {children.length === 0 && <p className="text-xs text-muted-foreground/50">No nodes in this group.</p>}
        {children.map((child) => (
          <div
            key={child.id}
            className="group/member w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#21262d] text-xs hover:bg-[#30363d] transition-colors"
          >
            <button
              onClick={() => onSelectChild(child.id)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[child.data.status] }} />
              <span className="truncate text-foreground font-medium">{child.data.label}</span>
              <span className="ml-auto text-muted-foreground shrink-0">{NODE_TYPE_LABELS[child.data.type] ?? child.data.type}</span>
            </button>
            <button
              onClick={() => onRemoveChild(child.id)}
              aria-label={`Remove ${child.data.label} from group`}
              title="Remove from group"
              className="shrink-0 opacity-0 group-hover/member:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149] cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <button
          onClick={onToggleBorder}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-[#21262d] transition-colors"
        >
          {showBorder ? <Eye size={13} /> : <EyeOff size={13} />}
          {showBorder ? 'Hide border & title' : 'Show border & title'}
        </button>
        <Button
          size="sm"
          variant="destructive"
          className="w-full gap-2"
          onClick={handleUngroup}
        >
          <Ungroup size={13} /> Ungroup
        </Button>
      </div>
    </aside>
  )
}

// --- Helpers ---

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 items-baseline">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span className={`text-xs text-right truncate ${mono ? 'font-mono text-[#00d4ff]' : 'text-foreground'}`} title={value}>
        {value}
      </span>
    </div>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  web: '#00d4ff', database: '#a855f7', monitoring: '#39d353', storage: '#e3b341', security: '#f85149', remote: '#8b949e',
}

function ServiceBadge({ svc, host, status, draggable, isDragging, isDragOver, onDragStart, onDragEnter, onDragEnd, onDrop, onEdit, onRemove }: {
  svc: ServiceInfo
  host?: string
  status?: ServiceStatus
  draggable: boolean
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  onDrop: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const url = getServiceUrl(svc, host)
  // Manually-added services carry no category, so they fell back to grey even
  // when they're reachable HTTP/HTTPS. Treat any resolvable web URL as `web`.
  const categoryColor = CATEGORY_COLORS[svc.category ?? ''] ?? (url ? CATEGORY_COLORS.web : '#8b949e')
  // A live offline service overrides the category colour with red.
  const color = status === 'offline' ? '#f85149' : categoryColor
  const pathLabel = svc.path?.trim() ? svc.path.trim() : ''

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors min-w-0"
      style={{
        background: '#21262d',
        borderColor: isDragOver ? '#00d4ff' : '#30363d',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {draggable && (
          <span className="shrink-0 cursor-grab active:cursor-grabbing text-[#8b949e] hover:text-[#00d4ff]" title="Drag to reorder">
            {createElement(GripVertical, { size: 11 })}
          </span>
        )}
        <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <ServiceIcon iconKey={svc.icon} size={12} className="shrink-0" color={color} />

        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium truncate min-w-0 flex-1"
            style={{ color }}
            title={svc.service_name}
            onClick={e => e.stopPropagation()}
          >
            {svc.service_name}
          </a>
        ) : (
          <span
            className="font-medium truncate min-w-0 flex-1"
            style={{ color }}
            title={svc.service_name}
          >
            {svc.service_name}
          </span>
        )}

        {pathLabel && (
          <span
            className="shrink-0 text-[#8b949e] text-right w-16 truncate"
            title={pathLabel}
          >
            {pathLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {svc.port != null && (
          <span className="font-mono text-[#8b949e]">
            {svc.port}/{svc.protocol}
          </span>
        )}

        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-2.5 h-2.5 items-center justify-center"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={10} className="text-muted-foreground" />
          </a>
        ) : (
          <span className="w-2.5" />
        )}

        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit() }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#00d4ff] ml-0.5 cursor-pointer"
          title="Edit service"
        >
          <Pencil size={10} />
        </button>

        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149] ml-0.5 cursor-pointer"
          title="Remove service"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  )
}
