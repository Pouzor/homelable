import { useEffect, useCallback, useRef, useState, type MouseEvent } from 'react'
import { ReactFlowProvider, type Connection, type Edge } from '@xyflow/react'
import { type Node } from '@xyflow/react'
import { applyDagreLayout } from '@/utils/layout'
import { serializeNode, serializeEdge, deserializeApiNode, deserializeApiEdge, type ApiNode, type ApiEdge } from '@/utils/canvasSerializer'
import { generateUUID } from '@/utils/uuid'
import { generateMarkdownTable } from '@/utils/exportMarkdown'
import { exportToPng } from '@/utils/export'
import { exportCanvasToYaml, downloadYaml } from '@/utils/exportYaml'
import { parseYamlToCanvas } from '@/utils/importYaml'
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
import { GroupNodeModal, type GroupNodeFormData } from '@/components/modals/GroupNodeModal'
import { ThemeModal } from '@/components/modals/ThemeModal'
import { SearchModal } from '@/components/modals/SearchModal'
import { ShortcutsModal } from '@/components/modals/ShortcutsModal'
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
  const { loadCanvas, markSaved, markUnsaved, selectedNodeId, selectedNodeIds, addNode, updateNode, deleteNode, onConnect, updateEdge, deleteEdge, setProxmoxContainerMode, setNodeZIndex, editingGroupRectId, setEditingGroupRectId, nodes, edges, snapshotHistory, undo, redo, copySelectedNodes, pasteNodes } = useCanvasStore()
  const canvasRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated } = useAuthStore()
  const { activeTheme, setTheme } = useThemeStore()

  useStatusPolling()

  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarForceView, setSidebarForceView] = useState<'pending' | 'history' | undefined>(undefined)
  const [highlightPendingId, setHighlightPendingId] = useState<string | undefined>(undefined)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [addNodeOpen, setAddNodeOpen] = useState(false)
  const [addGroupRectOpen, setAddGroupRectOpen] = useState(false)
  const [editNodeId, setEditNodeId] = useState<string | null>(null)
  const [editGroupNodeId, setEditGroupNodeId] = useState<string | null>(null)
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
      const nodesToSave = nodes.map(serializeNode)
      const edgesToSave = edges.map(serializeEdge)
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
          // Build a map of container-capable node IDs → container_mode
          const CONTAINER_TYPES = new Set(['proxmox', 'lxc', 'docker', 'nas', 'server', 'group'])
          const proxmoxContainerMap = new Map<string, boolean>(
            (apiNodes as ApiNode[])
              .filter((n) => CONTAINER_TYPES.has(n.type))
              .map((n) => [n.id, n.type === 'group' ? true : n.container_mode !== false])
          )
          const rfNodes = (apiNodes as ApiNode[]).map((n) => deserializeApiNode(n, proxmoxContainerMap))
          const rfEdges = (apiEdges as ApiEdge[]).map(deserializeApiEdge)
          const savedTheme = res.data.viewport?.theme_id
          if (savedTheme) setTheme(savedTheme)
          loadCanvas(rfNodes, rfEdges)
        } else {
          loadCanvas(demoNodes, demoEdges)
        }
      })
      .catch(() => loadCanvas(demoNodes, demoEdges))
  }, [isAuthenticated, loadCanvas, setTheme])

  // Keep refs for store actions so keydown handler is always up-to-date without re-registering
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  const copyRef = useRef(copySelectedNodes)
  const pasteRef = useRef(pasteNodes)
  useEffect(() => { undoRef.current = undo }, [undo])
  useEffect(() => { redoRef.current = redo }, [redo])
  useEffect(() => { copyRef.current = copySelectedNodes }, [copySelectedNodes])
  useEffect(() => { pasteRef.current = pasteNodes }, [pasteNodes])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      // Ignore shortcuts when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable

      if (ctrl && e.key === 's') { e.preventDefault(); handleSaveRef.current(); return }
      if (ctrl && e.key === 'z') { e.preventDefault(); undoRef.current(); return }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redoRef.current(); return }
      if (ctrl && e.key === 'k') { e.preventDefault(); setSearchOpen(true); return }
      if (ctrl && e.key === 'c' && !isInput) { copyRef.current(); return }
      if (ctrl && e.key === 'v' && !isInput) { pasteRef.current(); return }
      if (e.key === '?' && !isInput) { setShortcutsOpen(true); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleAddNode = useCallback((data: Partial<NodeData>) => {
    snapshotHistory()
    const id = generateUUID()
    const isContainerHost = ['proxmox', 'lxc', 'docker', 'nas', 'server'].includes(data.type ?? '')
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
      ...(isContainerHost && data.container_mode ? { width: 300, height: 200 } : {}),
      zIndex: data.custom_colors?.z_order ?? 5,
    }
    addNode(newNode)
    toast.success(`Added "${data.label}"`)
  }, [addNode, nodes, snapshotHistory])

  const handleAddGroupRect = useCallback((data: GroupRectFormData) => {
    snapshotHistory()
    const id = generateUUID()
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
          border_style: data.border_style,
          border_width: data.border_width,
          background: data.background_color,
          text_color: data.text_color,
          text_position: data.text_position,
          text_size: data.text_size,
          label_position: data.label_position,
          font: data.font,
          z_order: data.z_order,
        },
      },
      width: 360,
      height: 240,
      zIndex: data.z_order - 10,
    }
    addNode(newNode)
  }, [addNode, snapshotHistory])

  const handleUpdateGroupRect = useCallback((data: GroupRectFormData) => {
    if (!editingGroupRectId) return
    snapshotHistory()
    const existing = nodes.find((n) => n.id === editingGroupRectId)
    updateNode(editingGroupRectId, {
      label: data.label,
      custom_colors: {
        ...existing?.data.custom_colors,
        border: data.border_color,
        border_style: data.border_style,
        border_width: data.border_width,
        background: data.background_color,
        text_color: data.text_color,
        text_position: data.text_position,
        text_size: data.text_size,
        label_position: data.label_position,
        font: data.font,
        z_order: data.z_order,
      },
    })
    setNodeZIndex(editingGroupRectId, data.z_order - 10)
    setEditingGroupRectId(null)
  }, [editingGroupRectId, nodes, updateNode, setNodeZIndex, setEditingGroupRectId, snapshotHistory])

  const handleDeleteGroupRect = useCallback(() => {
    if (!editingGroupRectId) return
    snapshotHistory()
    deleteNode(editingGroupRectId)
    setEditingGroupRectId(null)
  }, [editingGroupRectId, deleteNode, setEditingGroupRectId, snapshotHistory])

  const handleEditNode = useCallback((id: string) => {
    setEditNodeId(id)
  }, [])

  const handleNodeDoubleClick = useCallback((_e: MouseEvent, node: Node<NodeData>) => {
    if (node.type === 'groupRect') return // groupRect handles its own double-click
    if (node.type === 'group') { setEditGroupNodeId(node.id); return }
    handleEditNode(node.id)
  }, [handleEditNode])

  const handleUpdateNode = useCallback((data: Partial<NodeData>) => {
    if (!editNodeId) return
    snapshotHistory()
    const existingNode = nodes.find((n) => n.id === editNodeId)
    updateNode(editNodeId, data)
    // Sync React Flow zIndex when z_order changes
      setNodeZIndex(editNodeId, data.custom_colors?.z_order ?? 5)
    // If a container-capable host's container_mode changed, apply structural changes
    const CONTAINER_HOST_TYPES = ['proxmox', 'lxc', 'docker', 'nas', 'server']
    if (CONTAINER_HOST_TYPES.includes(data.type ?? '') && typeof data.container_mode === 'boolean') {
      setProxmoxContainerMode(editNodeId, data.container_mode)
    }
    // Sync virtual edge when parent_id changes on any non-container-host node
    const nodeType = data.type ?? existingNode?.data.type
    if (nodeType !== 'groupRect' && 'parent_id' in data) {
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
        // Create virtual edge only when parent is NOT in container mode
        // (container mode shows containment visually — no edge needed)
        if (newParentId) {
          const parentNode = nodes.find((n) => n.id === newParentId)
          if (!parentNode?.data.container_mode) {
            onConnect({ source: editNodeId, sourceHandle: 'top', target: newParentId, targetHandle: 'bottom', type: 'virtual' } as unknown as Connection)
          }
        }
      }
    }
    setEditNodeId(null)
  }, [editNodeId, updateNode, setProxmoxContainerMode, nodes, edges, deleteEdge, onConnect, snapshotHistory])

  const handleAutoLayout = useCallback(() => {
    const laid = applyDagreLayout(nodes, edges)
    loadCanvas(laid, edges)
    toast.success('Canvas auto-arranged')
  }, [nodes, edges, loadCanvas])

  const handleExportMd = useCallback(async () => {
    const md = generateMarkdownTable(nodes)
    if (!md) { toast.error('No nodes to export'); return }
    await navigator.clipboard.writeText(md)
    toast.success('Markdown table copied to clipboard')
  }, [nodes])

  const handleExportYaml = useCallback(() => {
    if (nodes.length === 0) { toast.error('No nodes to export'); return }
    const content = exportCanvasToYaml(nodes, edges)
    downloadYaml(content)
    toast.success('Canvas exported as YAML')
  }, [nodes, edges])

  const handleImportYaml = useCallback((content: string) => {
    try {
      const { nodes: merged, edges: mergedEdges, imported } = parseYamlToCanvas(content, nodes, edges)
      snapshotHistory()
      loadCanvas(merged, mergedEdges)
      markUnsaved()
      toast.success(`Imported ${imported} node${imported !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [nodes, edges, snapshotHistory, loadCanvas, markUnsaved])

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

  const handleUpdateGroupNode = useCallback((data: GroupNodeFormData) => {
    if (!editGroupNodeId) return
    snapshotHistory()
    const existing = nodes.find((n) => n.id === editGroupNodeId)
    updateNode(editGroupNodeId, {
      label: data.label,
      parent_id: data.parent_id,
      custom_colors: {
        ...existing?.data.custom_colors,
        border: data.border_color,
        border_style: data.border_style,
        border_width: data.border_width,
        background: data.background_color,
        z_order: data.z_order,
        show_border: data.show_border,
      },
    })
    setNodeZIndex(editGroupNodeId, data.z_order)
    setEditGroupNodeId(null)
  }, [editGroupNodeId, nodes, updateNode, setNodeZIndex, snapshotHistory])

  const handleDeleteGroupNode = useCallback(() => {
    if (!editGroupNodeId) return
    snapshotHistory()
    deleteNode(editGroupNodeId)
    setEditGroupNodeId(null)
  }, [editGroupNodeId, deleteNode, snapshotHistory])

  const handleEdgeConfirm = useCallback((edgeData: EdgeData) => {
    if (!pendingConnection) return
    snapshotHistory()
    onConnect({ ...pendingConnection, ...edgeData } as unknown as Connection)
    // When a virtual edge is drawn to/from a container host, sync parent_id
    if (edgeData.type === 'virtual') {
      const src = nodes.find((n) => n.id === pendingConnection.source)
      const tgt = nodes.find((n) => n.id === pendingConnection.target)
      const CONTAINER_HOSTS = new Set(['proxmox', 'lxc', 'docker', 'nas', 'server', 'group'])
      const srcIsContainer = CONTAINER_HOSTS.has(src?.data.type ?? '')
      const tgtIsContainer = CONTAINER_HOSTS.has(tgt?.data.type ?? '')
      if (!srcIsContainer && tgtIsContainer) {
        updateNode(pendingConnection.source, { parent_id: pendingConnection.target })
      } else if (srcIsContainer && !tgtIsContainer) {
        updateNode(pendingConnection.target, { parent_id: pendingConnection.source })
      }
    }
    setPendingConnection(null)
  }, [pendingConnection, onConnect, nodes, updateNode, snapshotHistory])

  const handleEdgeDoubleClick = useCallback((edge: Edge<EdgeData>) => {
    setEditEdgeId(edge.id)
  }, [])

  const handleEdgeUpdate = useCallback((data: EdgeData) => {
    if (!editEdgeId) return
    snapshotHistory()
    updateEdge(editEdgeId, data)
    setEditEdgeId(null)
  }, [editEdgeId, updateEdge, snapshotHistory])

  const handleEdgeDelete = useCallback(() => {
    if (!editEdgeId) return
    snapshotHistory()
    deleteEdge(editEdgeId)
    setEditEdgeId(null)
  }, [editEdgeId, deleteEdge, snapshotHistory])

  const handleClearWaypoints = useCallback(() => {
    if (!editEdgeId) return
    snapshotHistory()
    updateEdge(editEdgeId, { waypoints: [] })
    setEditEdgeId(null)
  }, [editEdgeId, updateEdge, snapshotHistory])

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
            forceView={sidebarForceView}
            highlightPendingId={highlightPendingId}
          />
          <div className="flex flex-col flex-1 min-w-0">
            <Toolbar
              onSave={handleSave}
              onAutoLayout={handleAutoLayout}
              onExport={handleExport}
              onChangeStyle={() => setThemeModalOpen(true)}
              onUndo={undo}
              onRedo={redo}
              onShortcuts={() => setShortcutsOpen(true)}
              onExportMd={handleExportMd}
              onExportYaml={handleExportYaml}
              onImportYaml={handleImportYaml}
            />
            <div className="flex flex-1 min-h-0">
              <div ref={canvasRef} className="flex-1 min-w-0 h-full">
                <CanvasContainer
                  onConnect={handleEdgeConnect}
                  onEdgeDoubleClick={handleEdgeDoubleClick}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onNodeDragStart={snapshotHistory}
                  onOpenPending={(deviceId) => {
                    setHighlightPendingId(undefined)
                    setSidebarForceView(undefined)
                    setTimeout(() => {
                      setHighlightPendingId(deviceId)
                      setSidebarForceView('pending')
                    }, 0)
                  }}
                />
              </div>
              {(selectedNodeId || selectedNodeIds.length > 1) && <DetailPanel onEdit={handleEditNode} />}
            </div>
          </div>
        </div>

        <NodeModal
          open={addNodeOpen}
          onClose={() => setAddNodeOpen(false)}
          onSubmit={handleAddNode}
          title="Add Node"
          containerNodes={nodes
            .filter((n) => ['proxmox', 'lxc', 'docker', 'nas', 'server', 'group'].includes(n.type ?? ''))
            .map((n) => ({ id: n.id, label: n.data.label }))}
        />

        {/* key forces re-mount when editing a different node, resetting form state */}
        <NodeModal
          key={editNodeId ?? 'edit'}
          open={!!editNodeId}
          onClose={() => setEditNodeId(null)}
          onSubmit={handleUpdateNode}
          initial={editNode?.data}
          title="Edit Node"
          containerNodes={nodes
            .filter((n) => ['proxmox', 'lxc', 'docker', 'nas', 'server', 'group'].includes(n.type ?? '') && n.id !== editNodeId)
            .map((n) => ({ id: n.id, label: n.data.label }))}
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
          onClearWaypoints={handleClearWaypoints}
          initial={editEdge?.data}
          title="Edit Link"
        />

        {!STANDALONE && (
          <ScanConfigModal
            open={scanConfigOpen}
            onClose={() => setScanConfigOpen(false)}
            onScanNow={() => {
              toast.success('Network scan started — check Scan History for results')
              setSidebarForceView(undefined)
              setTimeout(() => setSidebarForceView('history'), 0)
            }}
          />
        )}

        <GroupRectModal
          open={addGroupRectOpen}
          onClose={() => setAddGroupRectOpen(false)}
          onSubmit={handleAddGroupRect}
          title="Add Zone"
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
              border_style: rc.border_style ?? 'solid',
              border_width: rc.border_width ?? 2,
              background_color: rc.background ?? '#00d4ff0d',
              text_size: rc.text_size ?? 12,
              label_position: rc.label_position ?? 'inside',
              z_order: rc.z_order ?? 1,
            }
          })()}
          title="Edit Zone"
        />

        <GroupNodeModal
          key={editGroupNodeId ?? 'grp-edit'}
          open={!!editGroupNodeId}
          onClose={() => setEditGroupNodeId(null)}
          onSubmit={handleUpdateGroupNode}
          onDelete={handleDeleteGroupNode}
          containerNodes={nodes
            .filter((n) => ['proxmox', 'lxc', 'docker', 'nas', 'server', 'group'].includes(n.type ?? '') && n.id !== editGroupNodeId)
            .map((n) => ({ id: n.id, label: n.data.label }))}
          initial={(() => {
            const n = editGroupNodeId ? nodes.find((nd) => nd.id === editGroupNodeId) : null
            if (!n) return undefined
            const rc = n.data.custom_colors ?? {}
            return {
              label: n.data.label,
              border_color: rc.border ?? '#00d4ff',
              border_style: rc.border_style ?? 'dashed',
              border_width: rc.border_width ?? 2,
              background_color: rc.background ?? '#21262d',
              z_order: rc.z_order ?? 5,
              show_border: rc.show_border !== false,
              parent_id: n.data.parent_id,
            }
          })()}
          title="Edit Group"
        />

        {/* key forces re-mount on open so useState captures current theme as original */}
        <ThemeModal
          key={themeModalOpen ? 'theme-open' : 'theme-closed'}
          open={themeModalOpen}
          onClose={() => setThemeModalOpen(false)}
        />

        <SearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onOpenPending={(deviceId) => {
            setHighlightPendingId(undefined)
            setSidebarForceView(undefined)
            setTimeout(() => {
              setHighlightPendingId(deviceId)
              setSidebarForceView('pending')
            }, 0)
          }}
        />
        <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        <Toaster theme="dark" position="bottom-right" />
      </ReactFlowProvider>
    </TooltipProvider>
  )
}
