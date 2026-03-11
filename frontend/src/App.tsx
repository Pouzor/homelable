import { useEffect, useCallback, useRef, useState } from 'react'
import { ReactFlowProvider, type Connection, type Edge } from '@xyflow/react'
import { type Node } from '@xyflow/react'
import { applyDagreLayout } from '@/utils/layout'
import { exportToPng } from '@/utils/export'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { CanvasContainer } from '@/components/canvas/CanvasContainer'
import { Sidebar } from '@/components/panels/Sidebar'
import { Toolbar } from '@/components/panels/Toolbar'
import { DetailPanel } from '@/components/panels/DetailPanel'
import { LoginPage } from '@/components/LoginPage'
import { NodeModal } from '@/components/modals/NodeModal'
import { EdgeModal } from '@/components/modals/EdgeModal'
import { ScanConfigModal } from '@/components/modals/ScanConfigModal'
import { GroupRectModal, type GroupRectFormData } from '@/components/modals/GroupRectModal'
import { ThemeModal } from '@/components/modals/ThemeModal'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { canvasApi } from '@/api/client'
import { demoNodes, demoEdges } from '@/utils/demoData'
import { useStatusPolling } from '@/hooks/useStatusPolling'
import type { NodeData, EdgeData } from '@/types'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'
const STANDALONE_STORAGE_KEY = 'homelable_canvas'

export default function App() {
  const { loadCanvas, markSaved, selectedNodeId, addNode, updateNode, deleteNode, onConnect, updateEdge, deleteEdge, setProxmoxContainerMode, setNodeZIndex, editingGroupRectId, setEditingGroupRectId, nodes, edges } = useCanvasStore()
  const canvasRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated } = useAuthStore()
  const { activeTheme, setTheme } = useThemeStore()

  useStatusPolling()

  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [addNodeOpen, setAddNodeOpen] = useState(false)
  const [addGroupRectOpen, setAddGroupRectOpen] = useState(false)
  const [editNodeId, setEditNodeId] = useState<string | null>(null)
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null)
  const [editEdgeId, setEditEdgeId] = useState<string | null>(null)
  const [scanConfigOpen, setScanConfigOpen] = useState(false)

  // Declare handleSave before the Ctrl+S effect so it is in scope
  const handleSave = useCallback(async () => {
    try {
      if (STANDALONE) {
        localStorage.setItem(STANDALONE_STORAGE_KEY, JSON.stringify({ nodes, edges, theme_id: activeTheme }))
        markSaved()
        toast.success('Canvas saved')
        return
      }
      const nodesToSave = nodes.map((n) => {
        if (n.data.type === 'groupRect') {
          return {
            id: n.id,
            type: 'groupRect',
            label: n.data.label,
            hostname: null,
            ip: null,
            mac: null,
            os: null,
            status: 'unknown',
            check_method: null,
            check_target: null,
            services: [],
            notes: null,
            parent_id: null,
            container_mode: false,
            custom_icon: null,
            pos_x: n.position.x,
            pos_y: n.position.y,
            // Persist size and all rect config inside custom_colors
            custom_colors: {
              ...n.data.custom_colors,
              width: n.measured?.width ?? n.width ?? 360,
              height: n.measured?.height ?? n.height ?? 240,
            },
          }
        }
        return {
          id: n.id,
          type: n.data.type,
          label: n.data.label,
          hostname: n.data.hostname ?? null,
          ip: n.data.ip ?? null,
          mac: n.data.mac ?? null,
          os: n.data.os ?? null,
          status: n.data.status,
          check_method: n.data.check_method ?? null,
          check_target: n.data.check_target ?? null,
          services: n.data.services ?? [],
          notes: n.data.notes ?? null,
          parent_id: n.data.parent_id ?? null,
          container_mode: n.data.container_mode ?? false,
          custom_colors: n.data.custom_colors ?? null,
          custom_icon: n.data.custom_icon ?? null,
          pos_x: n.position.x,
          pos_y: n.position.y,
        }
      })
      const edgesToSave = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.data?.type ?? 'ethernet',
        label: e.data?.label ?? null,
        vlan_id: e.data?.vlan_id ?? null,
        speed: e.data?.speed ?? null,
        custom_color: e.data?.custom_color ?? null,
        path_style: e.data?.path_style ?? null,
        // Normalize stub handle IDs: "top-t" / "bottom-t" are invisible target stubs;
        // map them back to their canonical source handle ID so reload works correctly.
        source_handle: e.sourceHandle === 'top-t' ? 'top' : e.sourceHandle === 'bottom-t' ? 'bottom' : (e.sourceHandle ?? null),
        target_handle: e.targetHandle === 'top-t' ? 'top' : e.targetHandle === 'bottom-t' ? 'bottom' : (e.targetHandle ?? null),
      }))
      await canvasApi.save({ nodes: nodesToSave, edges: edgesToSave, viewport: { theme_id: activeTheme } })
      markSaved()
      toast.success('Canvas saved')
    } catch {
      toast.error('Save failed')
    }
  }, [nodes, edges, markSaved, activeTheme])

  // Keep a ref so the keydown handler always calls the latest version
  const handleSaveRef = useRef(handleSave)
  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])

  // Load canvas on auth (or immediately in standalone mode)
  useEffect(() => {
    if (STANDALONE) {
      try {
        const saved = localStorage.getItem(STANDALONE_STORAGE_KEY)
        if (saved) {
          const { nodes: savedNodes, edges: savedEdges, theme_id } = JSON.parse(saved)
          if (theme_id) setTheme(theme_id)
          loadCanvas(savedNodes, savedEdges)
        } else {
          loadCanvas(demoNodes, demoEdges)
        }
      } catch {
        loadCanvas(demoNodes, demoEdges)
      }
      return
    }
    if (!isAuthenticated) return
    canvasApi.load()
      .then((res) => {
        const { nodes: apiNodes, edges: apiEdges } = res.data
        if (apiNodes.length > 0) {
          // Build a map of proxmox container mode to know if children should be nested
          const proxmoxContainerMap = new Map<string, boolean>(
            apiNodes
              .filter((n: NodeData & { id: string }) => n.type === 'proxmox')
              .map((n: NodeData & { id: string }) => [n.id, n.container_mode !== false])
          )
          const rfNodes = apiNodes.map((n: NodeData & { id: string; pos_x: number; pos_y: number; parent_id?: string }) => {
            if (n.type === 'groupRect') {
              const w = n.custom_colors?.width ?? 360
              const h = n.custom_colors?.height ?? 240
              const z = n.custom_colors?.z_order ?? 1
              return {
                id: n.id,
                type: 'groupRect',
                position: { x: n.pos_x, y: n.pos_y },
                data: n,
                width: w,
                height: h,
                zIndex: z - 10,
              }
            }
            const parentIsContainer = n.parent_id ? (proxmoxContainerMap.get(n.parent_id) ?? false) : false
            return {
              id: n.id,
              type: n.type,
              position: { x: n.pos_x, y: n.pos_y },
              data: n,
              ...(n.parent_id && parentIsContainer ? { parentId: n.parent_id, extent: 'parent' as const } : {}),
              ...(n.type === 'proxmox' && n.container_mode !== false ? { width: 300, height: 200 } : {}),
            }
          })
          const rfEdges = apiEdges.map((e: EdgeData & { id: string; source: string; target: string; source_handle?: string; target_handle?: string }) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
            sourceHandle: e.source_handle ?? null,
            targetHandle: e.target_handle ?? null,
            data: e,
          }))
          const savedTheme = res.data.viewport?.theme_id
          if (savedTheme) setTheme(savedTheme)
          loadCanvas(rfNodes, rfEdges)
        } else {
          loadCanvas(demoNodes, demoEdges)
        }
      })
      .catch(() => loadCanvas(demoNodes, demoEdges))
  }, [isAuthenticated, loadCanvas, setTheme])

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSaveRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleAddNode = useCallback((data: Partial<NodeData>) => {
    const id = crypto.randomUUID()
    const isProxmox = data.type === 'proxmox'
    const parentNode = data.parent_id ? nodes.find((n) => n.id === data.parent_id) : null
    // Children position is relative to parent; place near top-left with padding
    const position = parentNode
      ? { x: 20, y: 50 }
      : { x: 300, y: 300 }

    const newNode: Node<NodeData> = {
      id,
      type: data.type ?? 'generic',
      position,
      data: { status: 'unknown', services: [], ...data } as NodeData,
      ...(data.parent_id ? { parentId: data.parent_id, extent: 'parent' as const } : {}),
      ...(isProxmox ? { width: 300, height: 200 } : {}),
    }
    addNode(newNode)
    toast.success(`Added "${data.label}"`)
  }, [addNode, nodes])

  const handleAddGroupRect = useCallback((data: GroupRectFormData) => {
    const id = crypto.randomUUID()
    const newNode: Node<NodeData> = {
      id,
      type: 'groupRect',
      position: { x: 200, y: 200 },
      data: {
        label: data.label,
        type: 'groupRect',
        status: 'unknown',
        services: [],
        custom_colors: {
          border: data.border_color,
          background: data.background_color,
          text_color: data.text_color,
          text_position: data.text_position,
          font: data.font,
          z_order: data.z_order,
        },
      },
      width: 360,
      height: 240,
      zIndex: data.z_order - 10,
    }
    addNode(newNode)
  }, [addNode])

  const handleUpdateGroupRect = useCallback((data: GroupRectFormData) => {
    if (!editingGroupRectId) return
    const existing = nodes.find((n) => n.id === editingGroupRectId)
    updateNode(editingGroupRectId, {
      label: data.label,
      custom_colors: {
        ...existing?.data.custom_colors,
        border: data.border_color,
        background: data.background_color,
        text_color: data.text_color,
        text_position: data.text_position,
        font: data.font,
        z_order: data.z_order,
      },
    })
    setNodeZIndex(editingGroupRectId, data.z_order - 10)
    setEditingGroupRectId(null)
  }, [editingGroupRectId, nodes, updateNode, setNodeZIndex, setEditingGroupRectId])

  const handleDeleteGroupRect = useCallback(() => {
    if (!editingGroupRectId) return
    deleteNode(editingGroupRectId)
    setEditingGroupRectId(null)
  }, [editingGroupRectId, deleteNode, setEditingGroupRectId])

  const handleEditNode = useCallback((id: string) => {
    setEditNodeId(id)
  }, [])

  const handleUpdateNode = useCallback((data: Partial<NodeData>) => {
    if (!editNodeId) return
    const existingNode = nodes.find((n) => n.id === editNodeId)
    updateNode(editNodeId, data)
    // If proxmox container_mode changed, apply structural changes (children parentId, node dimensions)
    if (data.type === 'proxmox' && typeof data.container_mode === 'boolean') {
      setProxmoxContainerMode(editNodeId, data.container_mode)
    }
    // Sync virtual edge when parent_id changes on an LXC/VM node
    const nodeType = data.type ?? existingNode?.data.type
    if ((nodeType === 'lxc' || nodeType === 'vm') && 'parent_id' in data) {
      const oldParentId = existingNode?.data.parent_id ?? null
      const newParentId = data.parent_id ?? null
      if (oldParentId !== newParentId) {
        // Remove any existing virtual edge between child and old parent
        if (oldParentId) {
          const oldEdge = edges.find((e) =>
            e.data?.type === 'virtual' &&
            ((e.source === editNodeId && e.target === oldParentId) ||
             (e.source === oldParentId && e.target === editNodeId))
          )
          if (oldEdge) deleteEdge(oldEdge.id)
        }
        // Create new virtual edge: LXC top → Proxmox bottom
        if (newParentId) {
          // Pass type as extra field — canvasStore.onConnect casts to Connection & Partial<EdgeData>
          onConnect({ source: editNodeId, sourceHandle: 'top', target: newParentId, targetHandle: 'bottom', type: 'virtual' } as unknown as Connection)
        }
      }
    }
    setEditNodeId(null)
  }, [editNodeId, updateNode, setProxmoxContainerMode, nodes, edges, deleteEdge, onConnect])

  const handleAutoLayout = useCallback(() => {
    const laid = applyDagreLayout(nodes, edges)
    loadCanvas(laid, edges)
    toast.success('Canvas auto-arranged')
  }, [nodes, edges, loadCanvas])

  const handleExport = useCallback(async () => {
    const el = canvasRef.current?.querySelector<HTMLElement>('.react-flow')
    if (!el) { toast.error('Canvas not ready'); return }
    try {
      await exportToPng(el)
      toast.success('Exported as PNG')
    } catch {
      toast.error('Export failed')
    }
  }, [])

  const handleEdgeConnect = useCallback((connection: Connection) => {
    setPendingConnection(connection)
  }, [])

  const handleEdgeConfirm = useCallback((edgeData: EdgeData) => {
    if (!pendingConnection) return
    onConnect({ ...pendingConnection, ...edgeData } as unknown as Connection)
    // When a virtual edge is drawn between LXC/VM (top) and Proxmox (bottom), sync parent_id
    if (edgeData.type === 'virtual') {
      const src = nodes.find((n) => n.id === pendingConnection.source)
      const tgt = nodes.find((n) => n.id === pendingConnection.target)
      const srcType = src?.data.type
      const tgtType = tgt?.data.type
      if ((srcType === 'lxc' || srcType === 'vm') && tgtType === 'proxmox') {
        updateNode(pendingConnection.source, { parent_id: pendingConnection.target })
      } else if (srcType === 'proxmox' && (tgtType === 'lxc' || tgtType === 'vm')) {
        updateNode(pendingConnection.target, { parent_id: pendingConnection.source })
      }
    }
    setPendingConnection(null)
  }, [pendingConnection, onConnect, nodes, updateNode])

  const handleEdgeDoubleClick = useCallback((edge: Edge<EdgeData>) => {
    setEditEdgeId(edge.id)
  }, [])

  const handleEdgeUpdate = useCallback((data: EdgeData) => {
    if (!editEdgeId) return
    updateEdge(editEdgeId, data)
    setEditEdgeId(null)
  }, [editEdgeId, updateEdge])

  const handleEdgeDelete = useCallback(() => {
    if (!editEdgeId) return
    deleteEdge(editEdgeId)
    setEditEdgeId(null)
  }, [editEdgeId, deleteEdge])

  const editNode = editNodeId ? nodes.find((n) => n.id === editNodeId) : null
  const editEdge = editEdgeId ? edges.find((e) => e.id === editEdgeId) : null

  if (!STANDALONE && !isAuthenticated) return <LoginPage />

  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117]">
          <Sidebar
            onAddNode={() => setAddNodeOpen(true)}
            onAddGroupRect={() => setAddGroupRectOpen(true)}
            onScan={() => setScanConfigOpen(true)}
            onSave={handleSave}
            onNodeApproved={setEditNodeId}
          />
          <div className="flex flex-col flex-1 min-w-0">
            <Toolbar
              onSave={handleSave}
              onAutoLayout={handleAutoLayout}
              onExport={handleExport}
              onChangeStyle={() => setThemeModalOpen(true)}
            />
            <div className="flex flex-1 min-h-0">
              <div ref={canvasRef} className="flex-1 min-w-0 h-full">
                <CanvasContainer onConnect={handleEdgeConnect} onEdgeDoubleClick={handleEdgeDoubleClick} />
              </div>
              {selectedNodeId && <DetailPanel onEdit={handleEditNode} />}
            </div>
          </div>
        </div>

        <NodeModal
          open={addNodeOpen}
          onClose={() => setAddNodeOpen(false)}
          onSubmit={handleAddNode}
          title="Add Node"
          proxmoxNodes={nodes.filter((n) => n.type === 'proxmox').map((n) => ({ id: n.id, label: n.data.label }))}
        />

        {/* key forces re-mount when editing a different node, resetting form state */}
        <NodeModal
          key={editNodeId ?? 'edit'}
          open={!!editNodeId}
          onClose={() => setEditNodeId(null)}
          onSubmit={handleUpdateNode}
          initial={editNode?.data}
          title="Edit Node"
          proxmoxNodes={nodes.filter((n) => n.type === 'proxmox').map((n) => ({ id: n.id, label: n.data.label }))}
        />

        <EdgeModal
          key={pendingConnection ? `${pendingConnection.source}-${pendingConnection.sourceHandle}-${pendingConnection.target}-${pendingConnection.targetHandle}` : 'conn-idle'}
          open={!!pendingConnection}
          onClose={() => setPendingConnection(null)}
          onSubmit={handleEdgeConfirm}
          initial={
            pendingConnection?.sourceHandle?.includes('cluster') || pendingConnection?.targetHandle?.includes('cluster')
              ? { type: 'cluster' }
              : undefined
          }
        />

        <EdgeModal
          key={editEdgeId ?? 'edge-edit'}
          open={!!editEdgeId}
          onClose={() => setEditEdgeId(null)}
          onSubmit={handleEdgeUpdate}
          onDelete={handleEdgeDelete}
          initial={editEdge?.data}
          title="Edit Link"
        />

        {!STANDALONE && (
          <ScanConfigModal
            open={scanConfigOpen}
            onClose={() => setScanConfigOpen(false)}
            onScanNow={() => toast.success('Scan triggered')}
          />
        )}

        <GroupRectModal
          open={addGroupRectOpen}
          onClose={() => setAddGroupRectOpen(false)}
          onSubmit={handleAddGroupRect}
          title="Add Rectangle"
        />

        {/* key forces re-mount when editing a different rect */}
        <GroupRectModal
          key={editingGroupRectId ?? 'rect-edit'}
          open={!!editingGroupRectId}
          onClose={() => setEditingGroupRectId(null)}
          onSubmit={handleUpdateGroupRect}
          onDelete={handleDeleteGroupRect}
          initial={(() => {
            const n = editingGroupRectId ? nodes.find((nd) => nd.id === editingGroupRectId) : null
            if (!n) return undefined
            const rc = n.data.custom_colors ?? {}
            return {
              label: n.data.label,
              font: rc.font ?? 'inter',
              text_color: rc.text_color ?? '#e6edf3',
              text_position: rc.text_position ?? 'top-left',
              border_color: rc.border ?? '#00d4ff',
              background_color: rc.background ?? '#00d4ff0d',
              z_order: rc.z_order ?? 1,
            }
          })()}
          title="Edit Rectangle"
        />

        {/* key forces re-mount on open so useState captures current theme as original */}
        <ThemeModal
          key={themeModalOpen ? 'theme-open' : 'theme-closed'}
          open={themeModalOpen}
          onClose={() => setThemeModalOpen(false)}
        />

        <Toaster theme="dark" position="bottom-right" />
      </ReactFlowProvider>
    </TooltipProvider>
  )
}
