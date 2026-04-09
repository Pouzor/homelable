import { createElement, useState } from 'react'
import { X, Edit, Trash2, ExternalLink, Plus, Pencil, Layers, Ungroup, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCanvasStore } from '@/stores/canvasStore'
import { NODE_TYPE_LABELS, STATUS_COLORS, type ServiceInfo, type NodeData, type NodeProperty } from '@/types'
import { getServiceUrl } from '@/utils/serviceUrl'
import { PROPERTY_ICONS, PROPERTY_ICON_NAMES, resolvePropertyIcon } from '@/utils/propertyIcons'
import type { Node } from '@xyflow/react'

interface DetailPanelProps {
  onEdit: (id: string) => void
}

type SvcForm = { port: string; protocol: 'tcp' | 'udp'; service_name: string }
const EMPTY_FORM: SvcForm = { port: '', protocol: 'tcp', service_name: '' }

type PropForm = { key: string; value: string; icon: string | null; visible: boolean }
const EMPTY_PROP: PropForm = { key: '', value: '', icon: null, visible: true }

export function DetailPanel({ onEdit }: DetailPanelProps) {
  const { nodes, selectedNodeId, selectedNodeIds, setSelectedNode, deleteNode, updateNode, snapshotHistory, createGroup, ungroup } = useCanvasStore()

  const [addingForNode, setAddingForNode] = useState<string | null>(null)
  const [newSvc, setNewSvc] = useState<SvcForm>(EMPTY_FORM)
  const [editingFor, setEditingFor] = useState<{ nodeId: string; index: number } | null>(null)
  const [editSvc, setEditSvc] = useState<SvcForm>(EMPTY_FORM)
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  // Properties state
  const [addingProp, setAddingProp] = useState(false)
  const [newProp, setNewProp] = useState<PropForm>(EMPTY_PROP)
  const [editingPropIndex, setEditingPropIndex] = useState<number | null>(null)
  const [editProp, setEditProp] = useState<PropForm>(EMPTY_PROP)

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
  const addingService = addingForNode === node.id
  const editingIndex = editingFor?.nodeId === node.id ? editingFor.index : null
  const { data } = node
  const services = data.services ?? []
  const statusColor = STATUS_COLORS[data.status]
  const host = data.ip ?? data.hostname

  const handleDelete = () => {
    if (confirm(`Delete "${data.label}"?`)) {
      snapshotHistory()
      deleteNode(node.id)
    }
  }

  const handleAddService = () => {
    const port = parseInt(newSvc.port, 10)
    if (!newSvc.service_name.trim() || isNaN(port) || port < 1 || port > 65535) return
    snapshotHistory()
    const svc: ServiceInfo = { port, protocol: newSvc.protocol, service_name: newSvc.service_name.trim() }
    updateNode(node.id, { services: [...services, svc] })
    setNewSvc(EMPTY_FORM)
    setAddingForNode(null)
  }

  const handleRemoveService = (index: number) => {
    snapshotHistory()
    const updated = services.filter((_, i) => i !== index)
    updateNode(node.id, { services: updated })
    if (editingIndex === index) setEditingFor(null)
  }

  const handleStartEdit = (index: number) => {
    const svc = services[index]
    if (!svc) return
    setEditSvc({ port: String(svc.port), protocol: svc.protocol, service_name: svc.service_name })
    setEditingFor({ nodeId: node.id, index })
    setAddingForNode(null)
  }

  const handleSaveEdit = () => {
    if (editingIndex === null) return
    const port = parseInt(editSvc.port, 10)
    if (!editSvc.service_name.trim() || isNaN(port) || port < 1 || port > 65535) return
    snapshotHistory()
    const updated = services.map((svc, i) =>
      i === editingIndex ? { ...svc, port, protocol: editSvc.protocol, service_name: editSvc.service_name.trim() } : svc
    )
    updateNode(node.id, { services: updated })
    setEditingFor(null)
  }

  // --- Property handlers ---
  const properties: NodeProperty[] = data.properties ?? []

  const handleAddProp = () => {
    if (!newProp.key.trim() || !newProp.value.trim()) return
    snapshotHistory()
    const prop: NodeProperty = { key: newProp.key.trim(), value: newProp.value.trim(), icon: newProp.icon, visible: newProp.visible }
    updateNode(node.id, { properties: [...properties, prop] })
    setNewProp(EMPTY_PROP)
    setAddingProp(false)
  }

  const handleRemoveProp = (index: number) => {
    snapshotHistory()
    updateNode(node.id, { properties: properties.filter((_, i) => i !== index) })
    if (editingPropIndex === index) setEditingPropIndex(null)
  }

  const handleTogglePropVisible = (index: number) => {
    snapshotHistory()
    updateNode(node.id, {
      properties: properties.map((p, i) => i === index ? { ...p, visible: !p.visible } : p),
    })
  }

  const handleStartEditProp = (index: number) => {
    const p = properties[index]
    if (!p) return
    setEditProp({ key: p.key, value: p.value, icon: p.icon, visible: p.visible })
    setEditingPropIndex(index)
    setAddingProp(false)
  }

  const handleSaveEditProp = () => {
    if (editingPropIndex === null || !editProp.key.trim() || !editProp.value.trim()) return
    snapshotHistory()
    updateNode(node.id, {
      properties: properties.map((p, i) =>
        i === editingPropIndex
          ? { key: editProp.key.trim(), value: editProp.value.trim(), icon: editProp.icon, visible: editProp.visible }
          : p
      ),
    })
    setEditingPropIndex(null)
  }

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-border bg-[#161b22] overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-sm text-foreground truncate">{data.label}</span>
        <button aria-label="Close panel" onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground transition-colors">
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
        {data.ip && <DetailRow label="IP Address" value={data.ip} mono />}
        {data.mac && <DetailRow label="MAC" value={data.mac} mono />}
        {data.os && <DetailRow label="OS" value={data.os} />}
        {data.check_method && <DetailRow label="Check" value={data.check_method} mono />}
        {data.last_seen && <DetailRow label="Last Seen" value={new Date(data.last_seen.endsWith('Z') ? data.last_seen : data.last_seen + 'Z').toLocaleString()} />}
      </div>

      {/* Properties section */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Properties{properties.length > 0 ? ` (${properties.length})` : ''}</span>
          <button
            onClick={() => { setAddingProp((v) => !v); setEditingPropIndex(null) }}
            className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors"
          >
            <Plus size={10} /> Add
          </button>
        </div>
        {addingProp && (
          <PropertyForm
            form={newProp}
            onChange={setNewProp}
            onConfirm={handleAddProp}
            onCancel={() => { setAddingProp(false); setNewProp(EMPTY_PROP) }}
            confirmLabel="Add"
          />
        )}
        {properties.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {properties.map((prop, i) =>
              editingPropIndex === i ? (
                <PropertyForm
                  key={`edit-${i}`}
                  form={editProp}
                  onChange={setEditProp}
                  onConfirm={handleSaveEditProp}
                  onCancel={() => setEditingPropIndex(null)}
                  confirmLabel="Save"
                />
              ) : (
                <PropertyBadge
                  key={`${prop.key}-${i}`}
                  prop={prop}
                  onToggleVisible={() => handleTogglePropVisible(i)}
                  onEdit={() => handleStartEditProp(i)}
                  onRemove={() => handleRemoveProp(i)}
                />
              )
            )}
          </div>
        )}
        {properties.length === 0 && !addingProp && (
          <p className="text-[10px] text-muted-foreground/50">No properties — click Add to define one.</p>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">Services{services.length > 0 ? ` (${services.length})` : ''}</span>
          <button onClick={() => { setAddingForNode((v) => v === node.id ? null : node.id); setEditingFor(null) }} className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors">
            <Plus size={10} /> Add
          </button>
        </div>
        {addingService && <ServiceForm form={newSvc} onChange={setNewSvc} onConfirm={handleAddService} onCancel={() => setAddingForNode(null)} confirmLabel="Add" autoFocus />}
        {services.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {services.map((svc, i) =>
              editingIndex === i ? (
                <ServiceForm key={`edit-${i}`} form={editSvc} onChange={setEditSvc} onConfirm={handleSaveEdit} onCancel={() => setEditingFor(null)} confirmLabel="Save" autoFocus />
              ) : (
                <ServiceBadge key={`${svc.port}-${svc.protocol}-${i}`} svc={svc} host={host} onEdit={() => handleStartEdit(i)} onRemove={() => handleRemoveService(i)} />
              )
            )}
          </div>
        )}
        {services.length === 0 && !addingService && <p className="text-[10px] text-muted-foreground/50">No services — click Add to register one.</p>}
      </div>

      {data.notes && (
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">Notes</div>
          <p className="text-xs text-foreground/80 whitespace-pre-wrap">{data.notes}</p>
        </div>
      )}

      <div className="mt-auto flex gap-2 px-4 py-3 border-t border-border">
        <Button size="sm" variant="secondary" className="flex-1 gap-1.5" onClick={() => onEdit(node.id)}>
          <Edit size={14} /> Edit
        </Button>
        <Button size="sm" variant="destructive" className="gap-1.5" aria-label="Delete node" onClick={handleDelete}>
          <Trash2 size={14} />
        </Button>
      </div>
    </aside>
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
  onToggleBorder: () => void
  onClose: () => void
  onSelectChild: (id: string) => void
}

function GroupDetailPanel({ node, nodes, onUngroup, onToggleBorder, onClose, onSelectChild }: GroupDetailPanelProps) {
  const children = nodes.filter((n) => n.parentId === node.id)
  const onlineCount = children.filter((n) => n.data.status === 'online').length
  const offlineCount = children.filter((n) => n.data.status === 'offline').length
  const showBorder = node.data.custom_colors?.show_border !== false

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

      {/* Children list */}
      <div className="flex-1 px-4 py-3 space-y-1.5 overflow-y-auto">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Members</span>
        {children.length === 0 && <p className="text-xs text-muted-foreground/50">No nodes in this group.</p>}
        {children.map((child) => (
          <button
            key={child.id}
            onClick={() => onSelectChild(child.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#21262d] text-xs hover:bg-[#30363d] transition-colors text-left"
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[child.data.status] }} />
            <span className="truncate text-foreground font-medium">{child.data.label}</span>
            <span className="ml-auto text-muted-foreground shrink-0">{NODE_TYPE_LABELS[child.data.type] ?? child.data.type}</span>
          </button>
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

function ServiceForm({ form, onChange, onConfirm, onCancel, confirmLabel, autoFocus }: {
  form: { port: string; protocol: 'tcp' | 'udp'; service_name: string }
  onChange: (f: { port: string; protocol: 'tcp' | 'udp'; service_name: string }) => void
  onConfirm: () => void
  onCancel: () => void
  confirmLabel: string
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 mb-1 p-2 rounded-md bg-[#0d1117] border border-[#30363d]">
      <Input value={form.service_name} onChange={(e) => onChange({ ...form, service_name: e.target.value })} placeholder="Service name" className="bg-[#21262d] border-[#30363d] text-xs h-7" autoFocus={autoFocus} onKeyDown={(e) => e.key === 'Enter' && onConfirm()} />
      <div className="flex gap-1.5">
        <Input type="number" value={form.port} onChange={(e) => onChange({ ...form, port: e.target.value })} placeholder="Port" min={1} max={65535} className="bg-[#21262d] border-[#30363d] font-mono text-xs h-7 w-20 shrink-0" onKeyDown={(e) => e.key === 'Enter' && onConfirm()} />
        <select value={form.protocol} onChange={(e) => onChange({ ...form, protocol: e.target.value as 'tcp' | 'udp' })} className="flex-1 bg-[#21262d] border border-[#30363d] rounded-md text-xs h-7 px-1.5 text-foreground">
          <option value="tcp">tcp</option>
          <option value="udp">udp</option>
        </select>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" className="flex-1 h-6 text-[10px] bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90" onClick={onConfirm}>{confirmLabel}</Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// --- Property components ---

function PropertyForm({ form, onChange, onConfirm, onCancel, confirmLabel }: {
  form: PropForm
  onChange: (f: PropForm) => void
  onConfirm: () => void
  onCancel: () => void
  confirmLabel: string
}) {
  return (
    <div className="flex flex-col gap-1.5 mb-1 p-2 rounded-md bg-[#0d1117] border border-[#30363d]">
      <Input
        value={form.key}
        onChange={(e) => onChange({ ...form, key: e.target.value })}
        placeholder="Label (e.g. CPU Model)"
        className="bg-[#21262d] border-[#30363d] text-xs h-7"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
      />
      <Input
        value={form.value}
        onChange={(e) => onChange({ ...form, value: e.target.value })}
        placeholder="Value (e.g. i7-12700K)"
        className="bg-[#21262d] border-[#30363d] text-xs h-7"
        onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
      />
      {/* Icon picker */}
      <div className="flex flex-wrap gap-1 pt-0.5">
        <button
          onClick={() => onChange({ ...form, icon: null })}
          title="No icon"
          className={`w-6 h-6 rounded flex items-center justify-center text-[10px] border transition-colors ${
            form.icon === null ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]' : 'border-[#30363d] text-muted-foreground hover:border-[#8b949e]'
          }`}
        >
          –
        </button>
        {PROPERTY_ICON_NAMES.map((name) => {
          const Icon = PROPERTY_ICONS[name]
          const active = form.icon === name
          return (
            <button
              key={name}
              onClick={() => onChange({ ...form, icon: name })}
              title={name}
              className={`w-6 h-6 rounded flex items-center justify-center border transition-colors ${
                active ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]' : 'border-[#30363d] text-muted-foreground hover:border-[#8b949e]'
              }`}
            >
              {createElement(Icon, { size: 11 })}
            </button>
          )
        })}
      </div>
      {/* Visible toggle */}
      <label className="flex items-center gap-2 cursor-pointer pt-0.5">
        <input
          type="checkbox"
          checked={form.visible}
          onChange={(e) => onChange({ ...form, visible: e.target.checked })}
          className="accent-[#00d4ff] w-3 h-3"
        />
        <span className="text-[10px] text-muted-foreground">Show on node</span>
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" className="flex-1 h-6 text-[10px] bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function PropertyBadge({ prop, onToggleVisible, onEdit, onRemove }: {
  prop: NodeProperty
  onToggleVisible: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const Icon = resolvePropertyIcon(prop.icon)
  return (
    <div className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors" style={{ background: '#21262d', borderColor: '#30363d' }}>
      <div className="flex items-center gap-1.5 min-w-0">
        {Icon && createElement(Icon, { size: 11, className: 'shrink-0 text-muted-foreground' })}
        <span className="font-medium truncate text-foreground" title={prop.key}>{prop.key}</span>
        <span className="text-muted-foreground truncate" title={prop.value}>· {prop.value}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleVisible}
          title={prop.visible ? 'Hide on node' : 'Show on node'}
          className="text-[#8b949e] hover:text-[#00d4ff] transition-colors"
        >
          {prop.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#00d4ff]" title="Edit property">
          <Pencil size={10} />
        </button>
        <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149]" title="Remove property">
          <X size={10} />
        </button>
      </div>
    </div>
  )
}

const CATEGORY_COLORS: Record<string, string> = {
  web: '#00d4ff', database: '#a855f7', monitoring: '#39d353', storage: '#e3b341', security: '#f85149', remote: '#8b949e',
}

function ServiceBadge({ svc, host, onEdit, onRemove }: { svc: ServiceInfo; host?: string; onEdit: () => void; onRemove: () => void }) {
  const url = getServiceUrl(svc, host)
  const color = CATEGORY_COLORS[svc.category ?? ''] ?? '#8b949e'
  const inner = (
    <div className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors" style={{ background: '#21262d', borderColor: '#30363d', cursor: url ? 'pointer' : 'default' }}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-medium truncate" style={{ color }}>{svc.service_name}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-mono text-[#8b949e]">{svc.port}/{svc.protocol}</span>
        {url && <ExternalLink size={10} className="text-muted-foreground" />}
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit() }} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#00d4ff] ml-0.5" title="Edit service"><Pencil size={10} /></button>
        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149] ml-0.5" title="Remove service"><X size={10} /></button>
      </div>
    </div>
  )
  if (url) return <a href={url} target="_blank" rel="noopener noreferrer" className="block hover:opacity-80 transition-opacity">{inner}</a>
  return inner
}
