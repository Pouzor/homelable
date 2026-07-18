import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider, type Connection, type Edge } from '@xyflow/react'
import { type Node } from '@xyflow/react'
import { applyDagreLayout } from '@/utils/layout'
import { serializeNode, serializeEdge, deserializeApiNode, deserializeApiEdge, migrateClusterHandles, type ApiNode, type ApiEdge } from '@/utils/canvasSerializer'
import { generateUUID } from '@/utils/uuid'
import { getCenteredPosition } from '@/utils/viewportCenter'
import { resolveVirtualEdgeParent } from '@/utils/virtualEdgeParent'
import { generateMarkdownTable } from '@/utils/exportMarkdown'
import { copyToClipboard } from '@/utils/clipboard'
import { getDesignIdFromUrl, setDesignIdInUrl } from '@/utils/designUrl'
import { ExportModal } from '@/components/modals/ExportModal'
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
import { SettingsModal } from '@/components/modals/SettingsModal'
import { ZigbeeImportModal } from '@/components/zigbee/ZigbeeImportModal'
import { ZwaveImportModal } from '@/components/zwave/ZwaveImportModal'
import { ProxmoxImportModal } from '@/components/proxmox/ProxmoxImportModal'
import { GroupRectModal, type GroupRectFormData } from '@/components/modals/GroupRectModal'
import { TextModal, type TextFormData } from '@/components/modals/TextModal'
import { ThemeModal } from '@/components/modals/ThemeModal'
import { CustomStyleModal } from '@/components/modals/CustomStyleModal'
import { SearchModal } from '@/components/modals/SearchModal'
import { PendingDevicesModal } from '@/components/modals/PendingDevicesModal'
import { ScanHistoryModal } from '@/components/modals/ScanHistoryModal'
import { ShortcutsModal } from '@/components/modals/ShortcutsModal'
import { ConfirmAddToGroupModal } from '@/components/modals/ConfirmAddToGroupModal'
import { useCanvasStore } from '@/stores/canvasStore'
import { readAutosaveSettings, subscribeAutosaveSettings, type AutosaveSettings } from '@/utils/autosaveSettings'
import { useAutosave } from '@/hooks/useAutosave'
import { useDesignStore } from '@/stores/designStore'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { canvasApi, designsApi, liveviewApi } from '@/api/client'
import * as standaloneStorage from '@/utils/standaloneStorage'
import { demoNodes, demoEdges } from '@/utils/demoData'
import { decideCanvasLoad, isNewUserCanvas } from '@/utils/canvasLoadDecision'
import { WalkthroughActionsProvider, type WalkthroughActionApi } from '@/walkthrough/actions'
import { WalkthroughInvite } from '@/walkthrough/WalkthroughInvite'
import { WalkthroughOverlay } from '@/walkthrough/WalkthroughOverlay'
import { DEMO_SCAN_RUNS, DEMO_PENDING_DEVICES } from '@/walkthrough/demoTourData'
import { useStatusPolling } from '@/hooks/useStatusPolling'
import type { NodeData, EdgeData, CustomStyleDef, FloorMapConfig, NodeType } from '@/types'
import type { ZigbeeNode, ZigbeeEdge } from '@/components/zigbee/types'
import type { ZwaveNode, ZwaveEdge } from '@/components/zwave/types'
import type { ProxmoxNode, ProxmoxEdge } from '@/components/proxmox/types'
import { buildProxmoxClusterEdges } from '@/components/proxmox/clusterEdges'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

export default function App() {
  const { loadCanvas, applyLayout, markSaved, markUnsaved, hasUnsavedChanges, editSeq, selectedNodeId, selectedNodeIds, addNode, updateNode, deleteNode, onConnect, updateEdge, deleteEdge, setProxmoxContainerMode, setNodeZIndex, editingGroupRectId, setEditingGroupRectId, editingTextId, setEditingTextId, nodes, edges, snapshotHistory, undo, redo, addToGroup, addToContainer, floorMap, setFloorMap } = useCanvasStore()
  const canvasRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated } = useAuthStore()
  const { activeTheme, setTheme, customStyle, setCustomStyle } = useThemeStore()
  const { activeDesignId, setDesigns, setActiveDesign } = useDesignStore()

  useStatusPolling()

  const [autosave, setAutosave] = useState<AutosaveSettings>(readAutosaveSettings)
  useEffect(() => subscribeAutosaveSettings(setAutosave), [])

  // Provenance: which design the in-memory canvas was loaded as. Differs from
  // activeDesignId (the selection) during a switch, so autosave gates on this to
  // avoid writing one design's canvas under another's id. Ref mirror for the
  // fire-time guard, which must read the live value without re-arming the timer.
  const [loadedDesignId, setLoadedDesignId] = useState<string | null>(null)
  const loadedDesignIdRef = useRef<string | null>(loadedDesignId)
  useEffect(() => { loadedDesignIdRef.current = loadedDesignId }, [loadedDesignId])

  // True while the last canvas load failed (backend down/error). Drives the error
  // banner and keeps us from masking a real failure with the demo canvas.
  const [loadError, setLoadError] = useState(false)
  // True when the loaded canvas is the demo (a brand-new user). Reserved as the
  // entry signal for the upcoming Getting Started walkthrough.
  const [isNewUser, setIsNewUser] = useState(false)

  // Getting Started tour: when true, the corresponding modal renders injected demo
  // data instead of hitting the backend.
  const [tourScanHistoryDemo, setTourScanHistoryDemo] = useState(false)
  const [tourInventoryDemo, setTourInventoryDemo] = useState(false)

  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [styleEditorType, setStyleEditorType] = useState<NodeType | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [scanHistoryOpen, setScanHistoryOpen] = useState(false)
  const [pendingModalOpen, setPendingModalOpen] = useState(false)
  const [pendingModalStatus, setPendingModalStatus] = useState<'pending' | 'hidden'>('pending')
  const [pendingHighlightId, setPendingHighlightId] = useState<string | undefined>(undefined)
  const openPendingModal = useCallback((deviceId?: string, status: 'pending' | 'hidden' = 'pending') => {
    setPendingHighlightId(undefined)
    setPendingModalStatus(status)
    setPendingModalOpen(true)
    if (deviceId) setTimeout(() => setPendingHighlightId(deviceId), 0)
  }, [])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [addNodeOpen, setAddNodeOpen] = useState(false)
  const [addGroupRectOpen, setAddGroupRectOpen] = useState(false)
  const [addTextOpen, setAddTextOpen] = useState(false)
  const [editNodeId, setEditNodeId] = useState<string | null>(null)
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null)
  const [pendingGroupAdd, setPendingGroupAdd] = useState<{ nodeId: string; groupId: string } | null>(null)
  const [pendingContainerAdd, setPendingContainerAdd] = useState<{ nodeId: string; containerId: string } | null>(null)
  const [editEdgeId, setEditEdgeId] = useState<string | null>(null)
  const [scanConfigOpen, setScanConfigOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [zigbeeImportOpen, setZigbeeImportOpen] = useState(false)
  const [zwaveImportOpen, setZwaveImportOpen] = useState(false)
  const [proxmoxImportOpen, setProxmoxImportOpen] = useState(false)

  // Declare handleSave before the Ctrl+S effect so it is in scope.
  // Returns true on success, false on failure — the design-switch effect relies
  // on this to avoid loading (and clobbering) the canvas when a save fails.
  const handleSave = useCallback(async (designIdOverride?: string, options?: { silent?: boolean }): Promise<boolean> => {
    try {
      const saveDesignId = designIdOverride ?? activeDesignId
      if (STANDALONE) {
        if (!saveDesignId) return false
        // Floor plans are backend-only (upload/serve), so standalone never persists one.
        standaloneStorage.saveCanvas(saveDesignId, { nodes, edges, theme_id: activeTheme, custom_style: customStyle })
        markSaved()
        if (!options?.silent) toast.success('Canvas saved')
        return true
      }
      const nodesToSave = nodes.map(serializeNode)
      const edgesToSave = edges.map(serializeEdge)
      const viewport: Record<string, unknown> = { theme_id: activeTheme }
      if (floorMap) viewport.floor_map = floorMap
      await canvasApi.save({ nodes: nodesToSave, edges: edgesToSave, viewport, custom_style: customStyle, design_id: saveDesignId })
      markSaved()
      if (!options?.silent) toast.success('Canvas saved')
      return true
    } catch {
      toast.error('Save failed')
      return false
    }
  }, [nodes, edges, markSaved, activeTheme, customStyle, activeDesignId, floorMap])

  // Keep a ref so the keydown handler always calls the latest version
  const handleSaveRef = useRef(handleSave)
  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])

  // Debounced, opt-in autosave. Pins the active design when armed and re-checks
  // it at fire time so a mid-switch save can't clobber the wrong design.
  useAutosave({
    enabled: autosave.enabled,
    delaySeconds: autosave.delay,
    hasUnsavedChanges,
    designId: loadedDesignId,
    // Debounce resets on each real user edit (editSeq), not on raw nodes/edges
    // identity — live status polling churns those arrays without a user edit and
    // would otherwise keep re-arming (and starving) the timer during monitoring.
    changeSignals: [editSeq],
    getLiveDesignId: () => loadedDesignIdRef.current,
    onSave: (designId) => { void handleSaveRef.current(designId, { silent: true }) },
  })

  const loadCanvasFromApi = useCallback(async (designId?: string) => {
    let res
    try {
      res = await canvasApi.load(designId)
    } catch {
      // Backend down / errored. Surface it and STOP — never fall back to the demo
      // canvas, which would hide the real error and look like a fresh account.
      // Leave the on-screen canvas and provenance untouched so an autosave can't
      // clobber real data with an empty canvas.
      setLoadError(true)
      toast.error('Could not load canvas — backend not responding')
      return
    }
    const { nodes: apiNodes, edges: apiEdges } = res.data
    const mode = decideCanvasLoad(apiNodes.length > 0, res.data.initialized === true)
    if (mode === 'real') {
      const proxmoxContainerMap = new Map<string, boolean>(
        (apiNodes as ApiNode[])
          .filter((n) => n.type === 'group' || n.container_mode === true)
          .map((n) => [n.id, true])
      )
      const { nodes: rfNodes, edges: rfEdges } = migrateClusterHandles(
        (apiNodes as ApiNode[]).map((n) => deserializeApiNode(n, proxmoxContainerMap)),
        (apiEdges as ApiEdge[]).map(deserializeApiEdge),
      )
      const savedTheme = res.data.viewport?.theme_id
      if (savedTheme) setTheme(savedTheme)
      if (res.data.custom_style) setCustomStyle(res.data.custom_style as CustomStyleDef)
      const savedFloorMap = res.data.viewport?.floor_map as FloorMapConfig | undefined
      // Clear when the target design has no floor plan, so it doesn't bleed
      // across canvases when switching designs.
      setFloorMap(savedFloorMap ?? null)
      loadCanvas(rfNodes, rfEdges)
    } else if (mode === 'empty') {
      // Initialized but no nodes: the user cleared this canvas on purpose — respect
      // it and keep it empty instead of re-seeding the demo.
      const savedTheme = res.data.viewport?.theme_id
      if (savedTheme) setTheme(savedTheme)
      if (res.data.custom_style) setCustomStyle(res.data.custom_style as CustomStyleDef)
      setFloorMap(null)
      loadCanvas([], [])
    } else {
      // Brand-new, never-saved canvas: seed the demo.
      setFloorMap(null)
      loadCanvas(demoNodes, demoEdges)
    }
    setLoadError(false)
    setIsNewUser(isNewUserCanvas(mode))
    // Record provenance so autosave writes back under the design just loaded.
    setLoadedDesignId(designId ?? null)
  }, [loadCanvas, setTheme, setCustomStyle, setFloorMap])

  // Standalone counterpart of loadCanvasFromApi — reads a design's canvas from
  // localStorage, falling back to the demo canvas when it has never been saved.
  const loadStandaloneCanvas = useCallback((designId: string) => {
    const saved = standaloneStorage.loadCanvas(designId)
    // A stored entry (even with zero nodes) means the user has saved this canvas,
    // so treat it as initialized and don't re-seed the demo on top of a canvas
    // they deliberately cleared.
    const mode = decideCanvasLoad((saved?.nodes.length ?? 0) > 0, saved !== null)
    if (mode === 'real' && saved) {
      if (saved.theme_id) setTheme(saved.theme_id)
      if (saved.custom_style) setCustomStyle(saved.custom_style)
      // Floor plans are backend-only; keep the store clear in standalone mode.
      setFloorMap(null)
      const migrated = migrateClusterHandles(saved.nodes, saved.edges)
      loadCanvas(migrated.nodes, migrated.edges)
    } else if (mode === 'empty' && saved) {
      if (saved.theme_id) setTheme(saved.theme_id)
      if (saved.custom_style) setCustomStyle(saved.custom_style)
      setFloorMap(null)
      loadCanvas([], [])
    } else {
      setFloorMap(null)
      loadCanvas(demoNodes, demoEdges)
    }
    setLoadError(false)
    setIsNewUser(isNewUserCanvas(mode))
    // Record provenance so autosave writes back under the design just loaded.
    setLoadedDesignId(designId)
  }, [loadCanvas, setTheme, setCustomStyle, setFloorMap])

  const loadDesignsAndCanvas = useCallback(async () => {
    // Prefer a design id explicitly requested via the URL (?design=<id>), so a
    // refresh or shared link opens that design. Ignore it when it doesn't match
    // a known design and fall back to the current/default one.
    const urlDesignId = getDesignIdFromUrl()
    if (STANDALONE) {
      const designs = standaloneStorage.ensureSeed()
      setDesigns(designs)
      const fromUrl = urlDesignId && designs.some((d) => d.id === urlDesignId) ? urlDesignId : null
      const targetId = fromUrl ?? activeDesignId ?? designs[0]?.id
      if (targetId) {
        setActiveDesign(targetId)
        loadStandaloneCanvas(targetId)
      }
      return
    }
    try {
      const res = await designsApi.list()
      const loadedDesigns = res.data
      setDesigns(loadedDesigns)
      const fromUrl = urlDesignId && loadedDesigns.some((d) => d.id === urlDesignId) ? urlDesignId : null
      const targetId = fromUrl ?? activeDesignId ?? loadedDesigns[0]?.id
      if (targetId) {
        setActiveDesign(targetId)
        await loadCanvasFromApi(targetId)
      }
    } catch {
      // Backend unreachable/errored — surface it. Do NOT seed the demo: that would
      // hide a real outage behind a fake "new account" canvas.
      setLoadError(true)
      toast.error('Could not reach backend — check the server and retry')
    }
  }, [setDesigns, setActiveDesign, loadCanvasFromApi, loadStandaloneCanvas, activeDesignId])

  // Keep a ref so the auth effect can call the latest loader without listing it
  // as a dependency (which would re-fire on every design switch).
  const loadDesignsAndCanvasRef = useRef(loadDesignsAndCanvas)
  useEffect(() => { loadDesignsAndCanvasRef.current = loadDesignsAndCanvas }, [loadDesignsAndCanvas])

  // Retry a failed load from the error banner.
  const handleRetryLoad = useCallback(() => {
    setLoadError(false)
    void loadDesignsAndCanvasRef.current()
  }, [])

  // Bridge the Getting Started tour steps to the App's modal controls. The overlay
  // calls closeAll() before each step, then the step's action to open the target.
  const walkthroughActions = useMemo<WalkthroughActionApi>(() => ({
    closeAll: () => {
      setScanConfigOpen(false)
      setScanHistoryOpen(false)
      setTourScanHistoryDemo(false)
      setPendingModalOpen(false)
      setTourInventoryDemo(false)
      setEditNodeId(null)
      setThemeModalOpen(false)
      setZigbeeImportOpen(false)
      // Clear any tour-driven multi-selection so the DetailPanel closes.
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        selectedNodeIds: [],
        selectedNodeId: null,
      }))
    },
    openScanConfig: () => setScanConfigOpen(true),
    openScanHistoryDemo: () => {
      setTourScanHistoryDemo(true)
      setScanHistoryOpen(true)
    },
    openInventoryDemo: () => {
      setTourInventoryDemo(true)
      openPendingModal(undefined, 'pending')
    },
    editFirstNode: () => {
      const first = useCanvasStore.getState().nodes.find((n) => n.data.type !== 'groupRect' && n.data.type !== 'text')
      if (first) setEditNodeId(first.id)
    },
    selectTwoNodes: () => {
      const ids = useCanvasStore.getState().nodes
        .filter((n) => n.data.type !== 'groupRect' && n.data.type !== 'text')
        .slice(0, 2)
        .map((n) => n.id)
      if (ids.length < 2) return
      const set = new Set(ids)
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: set.has(n.id) })),
        selectedNodeIds: ids,
        selectedNodeId: null,
      }))
    },
    openStyle: () => setThemeModalOpen(true),
    openZigbeeImport: () => setZigbeeImportOpen(true),
  }), [openPendingModal])

  // Load designs + canvas on auth (or immediately in standalone mode, which has
  // no auth gate).
  useEffect(() => {
    if (STANDALONE) {
      loadDesignsAndCanvasRef.current()
      return
    }
    if (!isAuthenticated) return
    loadDesignsAndCanvasRef.current()
  }, [isAuthenticated]) // only on auth change, not design change

  // Reload canvas when active design changes (after initial load)
  const initialLoadDone = useRef(false)
  const prevDesignRef = useRef<string | null>(null)
  // Set while we programmatically revert activeDesignId after a failed save, so
  // the re-entrant effect run skips save/load and just re-syncs the refs.
  const revertingRef = useRef(false)
  useEffect(() => {
    if (revertingRef.current) {
      revertingRef.current = false
      prevDesignRef.current = activeDesignId
      return
    }
    // Standalone has no auth gate; backed mode requires authentication.
    const ready = STANDALONE || isAuthenticated
    const loadForDesign = STANDALONE ? loadStandaloneCanvas : loadCanvasFromApi
    if (ready && activeDesignId && initialLoadDone.current) {
      const oldId = prevDesignRef.current
      // If the previous design was deleted (no longer in the list), don't try to
      // save into it — just load the newly-selected design.
      const oldStillExists = oldId ? useDesignStore.getState().designs.some((d) => d.id === oldId) : false
      if (oldId && oldId !== activeDesignId && oldStillExists) {
        // Save current (old) canvas data under the old design ID before switching.
        // We call handleSave directly (not via ref) so it runs in this effect's
        // closure where activeDesignId is already the NEW value — the override
        // ensures data is stored under the correct design_id.
        const targetId = activeDesignId
        handleSave(oldId).then((ok) => {
          if (ok) {
            loadForDesign(targetId)
          } else {
            // Save failed: don't load the new design — that would overwrite the
            // unsaved in-memory canvas. Revert the selection back to the old
            // design so the UI matches the data still on screen.
            toast.error('Switch cancelled — unsaved changes kept')
            revertingRef.current = true
            setActiveDesign(oldId)
          }
        })
      } else {
        loadForDesign(activeDesignId)
      }
    }
    if (activeDesignId) {
      prevDesignRef.current = activeDesignId
      initialLoadDone.current = true
    }
  }, [activeDesignId])

  // Reflect the active design into the URL so refresh/share reopens it.
  useEffect(() => {
    if (activeDesignId) setDesignIdInUrl(activeDesignId)
  }, [activeDesignId])

  // Keep refs for store actions so keydown handler is always up-to-date without re-registering
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  useEffect(() => { undoRef.current = undo }, [undo])
  useEffect(() => { redoRef.current = redo }, [redo])

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
      // Copy/paste (Ctrl/Cmd+C/V) handled in CanvasContainer so paste can place
      // nodes under the cursor / viewport center.
      if (e.key === '?' && !isInput) { setShortcutsOpen(true); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleAddNode = useCallback((data: Partial<NodeData>) => {
    snapshotHistory()
    const id = generateUUID()
    const isContainerNode = data.container_mode === true
    const parentNode = data.parent_id ? nodes.find((n) => n.id === data.parent_id) : null
    // Only nest when the parent is an actual container. For a non-container
    // parent the LXC/VM stays a free node (linked by a virtual edge) — setting
    // extent:'parent' on a non-container would trap it inside the parent's tiny
    // bounding box with no way to drag it out (issue #205 follow-up).
    const nestInParent = !!parentNode?.data.container_mode
    // Seed an ABSOLUTE position near the container's top-left; addNode converts
    // it to container-relative. addNode is the single authority for parentId /
    // extent, so we don't set them here.
    const position = nestInParent && parentNode
      ? { x: parentNode.position.x + 20, y: parentNode.position.y + 50 }
      : getCenteredPosition(isContainerNode ? 300 : 0, isContainerNode ? 200 : 0)

    const newNode: Node<NodeData> = {
      id,
      type: data.type ?? 'generic',
      position,
      data: { status: 'unknown', services: [], ...data } as NodeData,
      ...(isContainerNode ? { width: 300, height: 200 } : {}),
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
      position: getCenteredPosition(360, 240),
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

  const handleAddText = useCallback((data: TextFormData) => {
    snapshotHistory()
    const id = generateUUID()
    const newNode: Node<NodeData> = {
      id,
      // Text lives in `label` because the API serializer only persists top-level
      // node fields; text_content is not in the schema and was lost on reload.
      // TextNode and the edit modal both already fall back to label.
      type: 'text',
      position: getCenteredPosition(200, 60),
      data: {
        label: data.text,
        type: 'text',
        status: 'unknown',
        services: [],
        custom_colors: {
          border: data.border_color,
          border_style: data.border_style,
          border_width: data.border_width,
          background: data.background_color,
          text_color: data.text_color,
          text_size: data.text_size,
          font: data.font,
        },
      },
      width: 200,
      height: 60,
    }
    addNode(newNode)
  }, [addNode, snapshotHistory])

  const handleUpdateText = useCallback((data: TextFormData) => {
    if (!editingTextId) return
    snapshotHistory()
    const existing = nodes.find((n) => n.id === editingTextId)
    updateNode(editingTextId, {
      label: data.text,
      // Clear stale text_content if present from older builds — label is the
      // source of truth now.
      text_content: undefined,
      custom_colors: {
        ...existing?.data.custom_colors,
        border: data.border_color,
        border_style: data.border_style,
        border_width: data.border_width,
        background: data.background_color,
        text_color: data.text_color,
        text_size: data.text_size,
        font: data.font,
      },
    })
    setEditingTextId(null)
  }, [editingTextId, nodes, updateNode, setEditingTextId, snapshotHistory])

  const handleDeleteText = useCallback(() => {
    if (!editingTextId) return
    snapshotHistory()
    deleteNode(editingTextId)
    setEditingTextId(null)
  }, [editingTextId, deleteNode, setEditingTextId, snapshotHistory])

  const handleDeleteGroupRect = useCallback(() => {
    if (!editingGroupRectId) return
    snapshotHistory()
    deleteNode(editingGroupRectId)
    setEditingGroupRectId(null)
  }, [editingGroupRectId, deleteNode, setEditingGroupRectId, snapshotHistory])

  const handleEditNode = useCallback((id: string) => {
    setEditNodeId(id)
  }, [])

  const handleUpdateNode = useCallback((data: Partial<NodeData>) => {
    if (!editNodeId) return
    snapshotHistory()
    const existingNode = nodes.find((n) => n.id === editNodeId)
    updateNode(editNodeId, data)
    // Only run the structural container transition when container_mode ACTUALLY
    // changed. The modal always includes container_mode in its payload, so firing
    // on presence alone re-ran the absolute<->relative child-position conversion on
    // every edit (e.g. an icon change), corrupting nested child positions (they pile
    // up in a corner). Gate on a real toggle instead.
    const prevContainerMode = !!existingNode?.data.container_mode
    if (typeof data.container_mode === 'boolean' && data.container_mode !== prevContainerMode) {
      setProxmoxContainerMode(editNodeId, data.container_mode)
    }
    // Sync virtual edge when parent_id changes on an LXC/VM node
    const nodeType = data.type ?? existingNode?.data.type
    if ((nodeType === 'lxc' || nodeType === 'vm' || nodeType === 'docker_container') && 'parent_id' in data) {
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
    // applyLayout keeps undo history so the user can revert an accidental
    // Auto Layout (#280); loadCanvas would wipe it.
    applyLayout(laid, edges)
    toast.success('Canvas auto-arranged')
  }, [nodes, edges, applyLayout])

  const handleExportMd = useCallback(async () => {
    const md = generateMarkdownTable(nodes)
    if (!md) { toast.error('No nodes to export'); return }
    if (await copyToClipboard(md)) {
      toast.success('Markdown table copied to clipboard')
    } else {
      toast.error('Markdown copy failed')
    }
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
      // applyLayout keeps undo history so an import can be reverted; loadCanvas
      // would wipe it (#280).
      applyLayout(merged, mergedEdges)
      toast.success(`Imported ${imported} node${imported !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [nodes, edges, applyLayout])

  // Open the read-only live view of the currently active design in a new tab.
  // Standalone has no backend/key — it reads localStorage, so just open /view.
  // Otherwise fetch the configured live view key and build /view?key=...&design=<id>.
  const handleViewOnly = useCallback(async () => {
    if (STANDALONE) {
      // Standalone reads canvas from localStorage; pass the active design id so
      // the read-only tab renders the same canvas the user is viewing.
      const url = activeDesignId ? `/view?design=${encodeURIComponent(activeDesignId)}` : '/view'
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    try {
      const res = await liveviewApi.getConfig()
      if (!res.data.enabled || !res.data.key) {
        toast.error('Live view is disabled — set LIVEVIEW_KEY in the backend .env')
        return
      }
      const params = new URLSearchParams({ key: res.data.key })
      if (activeDesignId) params.set('design', activeDesignId)
      window.open(`/view?${params.toString()}`, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Failed to open live view')
    }
  }, [activeDesignId])

  const handleExport = useCallback(() => {
    const el = canvasRef.current?.querySelector<HTMLElement>('.react-flow')
    if (!el) { toast.error('Canvas not ready'); return }
    setExportModalOpen(true)
  }, [])

  const handleZigbeeAddToCanvas = useCallback((zigbeeNodes: ZigbeeNode[], zigbeeEdges: ZigbeeEdge[]) => {
    snapshotHistory()
    // Place nodes in a grid centred on the visible canvas.
    const COLS = 4
    const SPACING_X = 170
    const SPACING_Y = 100
    const cols = Math.min(COLS, zigbeeNodes.length)
    const rows = Math.ceil(zigbeeNodes.length / COLS)
    const origin = getCenteredPosition(cols * SPACING_X, rows * SPACING_Y)
    zigbeeNodes.forEach((zn, i) => {
      const id = zn.id
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const position = { x: origin.x + col * SPACING_X, y: origin.y + row * SPACING_Y }
      const newNode: import('@xyflow/react').Node<NodeData> = {
        id,
        type: zn.type,
        position,
        data: {
          label: zn.friendly_name,
          type: zn.type as NodeData['type'],
          status: 'unknown' as const,
          services: [],
          ...(zn.lqi != null ? { properties: [{ key: 'LQI', value: String(zn.lqi), icon: 'signal', visible: true }] } : {}),
          ...(zn.model ? { os: zn.model } : {}),
          ...(zn.parent_id ? { parent_id: zn.parent_id } : {}),
        },
      }
      addNode(newNode)
    })
    // Add IoT edges between Zigbee devices: parent bottom -> child top
    zigbeeEdges.forEach((ze) => {
      onConnect({
        source: ze.source,
        sourceHandle: 'bottom',
        target: ze.target,
        targetHandle: 'top-t',
        type: 'iot',
      } as unknown as import('@xyflow/react').Connection)
    })
    // Auto-select only the freshly imported nodes so the user can drag the
    // whole subtree as a group.
    const importedIds = new Set(zigbeeNodes.map((zn) => zn.id))
    useCanvasStore.setState((state) => ({
      nodes: state.nodes.map((n) => ({ ...n, selected: importedIds.has(n.id) })),
      selectedNodeIds: Array.from(importedIds),
      selectedNodeId: importedIds.size === 1 ? Array.from(importedIds)[0] : null,
    }))
    markUnsaved()
  }, [addNode, onConnect, snapshotHistory, markUnsaved])

  const handleZwaveAddToCanvas = useCallback((zwaveNodes: ZwaveNode[], zwaveEdges: ZwaveEdge[]) => {
    snapshotHistory()
    const COLS = 4
    const SPACING_X = 170
    const SPACING_Y = 100
    const cols = Math.min(COLS, zwaveNodes.length)
    const rows = Math.ceil(zwaveNodes.length / COLS)
    const origin = getCenteredPosition(cols * SPACING_X, rows * SPACING_Y)
    zwaveNodes.forEach((zn, i) => {
      const id = zn.id
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const position = { x: origin.x + col * SPACING_X, y: origin.y + row * SPACING_Y }
      const newNode: import('@xyflow/react').Node<NodeData> = {
        id,
        type: zn.type,
        position,
        data: {
          label: zn.friendly_name,
          type: zn.type as NodeData['type'],
          status: 'unknown' as const,
          services: [],
          ...(zn.model ? { os: zn.model } : {}),
          ...(zn.parent_id ? { parent_id: zn.parent_id } : {}),
        },
      }
      addNode(newNode)
    })
    // Add IoT edges between Z-Wave devices: parent bottom -> child top
    zwaveEdges.forEach((ze) => {
      onConnect({
        source: ze.source,
        sourceHandle: 'bottom',
        target: ze.target,
        targetHandle: 'top-t',
        type: 'iot',
      } as unknown as import('@xyflow/react').Connection)
    })
    const importedIds = new Set(zwaveNodes.map((zn) => zn.id))
    useCanvasStore.setState((state) => ({
      nodes: state.nodes.map((n) => ({ ...n, selected: importedIds.has(n.id) })),
      selectedNodeIds: Array.from(importedIds),
      selectedNodeId: importedIds.size === 1 ? Array.from(importedIds)[0] : null,
    }))
    markUnsaved()
  }, [addNode, onConnect, snapshotHistory, markUnsaved])

  const handleProxmoxAddToCanvas = useCallback((pmNodes: ProxmoxNode[], pmEdges: ProxmoxEdge[]) => {
    snapshotHistory()
    const COLS = 4
    const SPACING_X = 190
    const SPACING_Y = 110
    const cols = Math.min(COLS, pmNodes.length)
    const rows = Math.ceil(pmNodes.length / COLS)
    const origin = getCenteredPosition(cols * SPACING_X, rows * SPACING_Y)
    // Multiple hosts from one import = a cluster → chain them via left/right
    // 'cluster' edges. Those endpoints need one left + one right handle each
    // (both default to 0), so grant them to the host nodes up front.
    const clusterEdges = buildProxmoxClusterEdges(pmNodes)
    const cluster = clusterEdges.length > 0
    pmNodes.forEach((pn, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const position = { x: origin.x + col * SPACING_X, y: origin.y + row * SPACING_Y }
      const isClusterHost = cluster && pn.type === 'proxmox'
      const newNode: import('@xyflow/react').Node<NodeData> = {
        id: pn.id,
        type: pn.type,
        position,
        data: {
          label: pn.label,
          type: pn.type as NodeData['type'],
          status: (pn.status === 'online' ? 'online' : 'unknown') as NodeData['status'],
          services: [],
          ...(pn.ip ? { ip: pn.ip } : {}),
          ...(pn.hostname ? { hostname: pn.hostname } : {}),
          ...(isClusterHost ? { left_handles: 1, right_handles: 1 } : {}),
        },
      }
      addNode(newNode)
    })
    // Host → guest links render as 'virtual' edges (VM/LXC ↔ host).
    pmEdges.forEach((pe) => {
      onConnect({
        source: pe.source,
        sourceHandle: 'bottom',
        target: pe.target,
        targetHandle: 'top-t',
        type: 'virtual',
      } as unknown as import('@xyflow/react').Connection)
    })
    // Host ↔ host links render as 'cluster' edges (left → right chain).
    clusterEdges.forEach((ce) => {
      onConnect({
        source: ce.source,
        sourceHandle: ce.sourceHandle,
        target: ce.target,
        targetHandle: ce.targetHandle,
        type: 'cluster',
      } as unknown as import('@xyflow/react').Connection)
    })
    const importedIds = new Set(pmNodes.map((pn) => pn.id))
    useCanvasStore.setState((state) => ({
      nodes: state.nodes.map((n) => ({ ...n, selected: importedIds.has(n.id) })),
      selectedNodeIds: Array.from(importedIds),
      selectedNodeId: importedIds.size === 1 ? Array.from(importedIds)[0] : null,
    }))
    markUnsaved()
  }, [addNode, onConnect, snapshotHistory, markUnsaved])

  const handleEdgeConnect = useCallback((connection: Connection) => {
    setPendingConnection(connection)
  }, [])

  const handleEdgeConfirm = useCallback((edgeData: EdgeData) => {
    if (!pendingConnection) return
    snapshotHistory()
    onConnect({ ...pendingConnection, ...edgeData } as unknown as Connection)
    // When a virtual edge is drawn between a child node and a container node, sync parent_id
    if (edgeData.type === 'virtual') {
      const src = nodes.find((n) => n.id === pendingConnection.source)
      const tgt = nodes.find((n) => n.id === pendingConnection.target)
      if (src && tgt) {
        const assignment = resolveVirtualEdgeParent(
          { id: src.id, type: src.data.type as NodeData['type'] },
          { id: tgt.id, type: tgt.data.type as NodeData['type'] },
        )
        if (assignment) {
          updateNode(assignment.childId, { parent_id: assignment.parentId })
        }
      }
    }
    setPendingConnection(null)
  }, [pendingConnection, onConnect, nodes, updateNode, snapshotHistory])

  const handleEdgeDoubleClick = useCallback((edge: Edge<EdgeData>) => {
    setEditEdgeId(edge.id)
  }, [])

  const handleNodeDoubleClick = useCallback((node: Node<NodeData>) => {
    // 'group' uses inline rename (pencil button in header). Opening the
    // generic NodeModal would clobber the group's height (via the
    // properties-clears-height rule in updateNode) and lose its children.
    // 'groupRect' has its own onDoubleClick that already routes to GroupRectModal.
    if (node.data.type === 'group' || node.data.type === 'groupRect') return
    handleEditNode(node.id)
  }, [handleEditNode])

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
    <WalkthroughActionsProvider value={walkthroughActions}>
    <TooltipProvider>
      <ReactFlowProvider>
        {/* data-new-user marks a first-time (demo) canvas — the hook the upcoming
            Getting Started walkthrough keys off. */}
        <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117]" data-new-user={isNewUser}>
          <Sidebar
            onAddNode={() => setAddNodeOpen(true)}
            onAddGroupRect={() => setAddGroupRectOpen(true)}
            onAddText={() => setAddTextOpen(true)}
            onScan={() => setScanConfigOpen(true)}
            onZigbeeImport={() => setZigbeeImportOpen(true)}
            onZwaveImport={() => setZwaveImportOpen(true)}
            onProxmoxImport={() => setProxmoxImportOpen(true)}
            onSave={handleSave}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHistory={() => setScanHistoryOpen(true)}
            onOpenPending={openPendingModal}
          />
          <div className="flex flex-col flex-1 min-w-0">
            {loadError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 bg-[#3d1418] border-b border-[#f85149] px-4 py-2 text-sm text-[#ffa198]"
              >
                <span>Backend not responding — the canvas could not be loaded.</span>
                <button
                  type="button"
                  onClick={handleRetryLoad}
                  className="rounded border border-[#f85149] px-2 py-0.5 text-[#ffa198] hover:bg-[#f85149]/20"
                >
                  Retry
                </button>
              </div>
            )}
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
              onViewOnly={handleViewOnly}
            />
            <div className="flex flex-1 min-h-0">
              <div ref={canvasRef} className="flex-1 min-w-0 h-full">
                <CanvasContainer
                  onConnect={handleEdgeConnect}
                  onEdgeDoubleClick={handleEdgeDoubleClick}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onNodeDragStart={snapshotHistory}
                  onRequestAddToGroup={setPendingGroupAdd}
                  onRequestAddToContainer={setPendingContainerAdd}
                  onOpenPending={(deviceId) => openPendingModal(deviceId)}
                />
              </div>
              {(selectedNodeId || selectedNodeIds.length > 1) && <DetailPanel onEdit={handleEditNode} />}
            </div>
          </div>
        </div>

        <NodeModal
          key={addNodeOpen ? 'add-open' : 'add-closed'}
          open={addNodeOpen}
          onClose={() => setAddNodeOpen(false)}
          onSubmit={handleAddNode}
          title="Add Node"
          parentCandidates={nodes.map((n) => ({ id: n.id, label: n.data.label ?? n.id, type: n.data.type, container_mode: n.data.container_mode }))}
          onEditTypeStyle={setStyleEditorType}
        />

        {/* key forces re-mount when editing a different node, resetting form state */}
        <NodeModal
          key={editNodeId ?? 'edit'}
          open={!!editNodeId}
          onClose={() => setEditNodeId(null)}
          onSubmit={handleUpdateNode}
          initial={editNode?.data}
          title="Edit Node"
          parentCandidates={(() => {
            const descendants = new Set<string>()
            if (editNodeId) {
              const queue = [editNodeId]
              while (queue.length) {
                const id = queue.shift()!
                for (const n of nodes) {
                  if (n.data.parent_id === id && !descendants.has(n.id)) {
                    descendants.add(n.id)
                    queue.push(n.id)
                  }
                }
              }
            }
            return nodes
              .filter((n) => !descendants.has(n.id))
              .map((n) => ({ id: n.id, label: n.data.label ?? n.id, type: n.data.type, container_mode: n.data.container_mode }))
          })()}
          currentNodeId={editNodeId ?? undefined}
          onEditTypeStyle={setStyleEditorType}
        />

        <EdgeModal
          key={pendingConnection ? `${pendingConnection.source}-${pendingConnection.sourceHandle}-${pendingConnection.target}-${pendingConnection.targetHandle}` : 'conn-idle'}
          open={!!pendingConnection}
          onClose={() => setPendingConnection(null)}
          onSubmit={handleEdgeConfirm}
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
            }}
          />
        )}

        {!STANDALONE && (
          <ZigbeeImportModal
            open={zigbeeImportOpen}
            onClose={() => setZigbeeImportOpen(false)}
            onAddToCanvas={handleZigbeeAddToCanvas}
            onPendingImported={() => {
              toast.success('Zigbee import started — check Scan History for results')
            }}
          />
        )}

        {!STANDALONE && (
          <ZwaveImportModal
            open={zwaveImportOpen}
            onClose={() => setZwaveImportOpen(false)}
            onAddToCanvas={handleZwaveAddToCanvas}
            onPendingImported={() => {
              toast.success('Z-Wave import started — check Scan History for results')
            }}
          />
        )}

        {!STANDALONE && (
          <ProxmoxImportModal
            open={proxmoxImportOpen}
            onClose={() => setProxmoxImportOpen(false)}
            onAddToCanvas={handleProxmoxAddToCanvas}
            onPendingImported={() => {
              toast.success('Proxmox import started — check Scan History for results')
            }}
          />
        )}

        {!STANDALONE && (
          <ScanHistoryModal
            open={scanHistoryOpen}
            onClose={() => setScanHistoryOpen(false)}
            demoRuns={tourScanHistoryDemo ? DEMO_SCAN_RUNS : undefined}
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

        <TextModal
          open={addTextOpen}
          onClose={() => setAddTextOpen(false)}
          onSubmit={handleAddText}
          title="Add Text"
        />

        <TextModal
          key={editingTextId ?? 'text-edit'}
          open={!!editingTextId}
          onClose={() => setEditingTextId(null)}
          onSubmit={handleUpdateText}
          onDelete={handleDeleteText}
          initial={(() => {
            const n = editingTextId ? nodes.find((nd) => nd.id === editingTextId) : null
            if (!n) return undefined
            const rc = n.data.custom_colors ?? {}
            return {
              text: n.data.text_content ?? n.data.label ?? '',
              font: rc.font ?? 'inter',
              text_color: rc.text_color ?? '#e6edf3',
              text_size: rc.text_size ?? 14,
              border_color: rc.border ?? '#30363d',
              border_style: (rc.border_style ?? 'none') as TextFormData['border_style'],
              border_width: rc.border_width ?? 1,
              background_color: rc.background ?? '#00000000',
            }
          })()}
          title="Edit Text"
        />

        {/* key forces re-mount on open so useState captures current theme as original */}
        <ThemeModal
          key={themeModalOpen ? 'theme-open' : 'theme-closed'}
          open={themeModalOpen}
          onClose={() => setThemeModalOpen(false)}
        />

        {/* Standalone Custom Style editor, opened from a node's Appearance
            shortcut with that node's type preselected. */}
        <CustomStyleModal
          key={styleEditorType ? `style-${styleEditorType}` : 'style-closed'}
          open={styleEditorType !== null}
          initialNodeType={styleEditorType ?? undefined}
          onClose={() => setStyleEditorType(null)}
        />

        <SearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onOpenPending={(deviceId) => openPendingModal(deviceId)}
        />
        <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

        <ConfirmAddToGroupModal
          open={!!pendingGroupAdd}
          nodeLabel={pendingGroupAdd ? (nodes.find((n) => n.id === pendingGroupAdd.nodeId)?.data.label ?? '') : ''}
          targetLabel={pendingGroupAdd ? (nodes.find((n) => n.id === pendingGroupAdd.groupId)?.data.label ?? '') : ''}
          onConfirm={() => {
            if (pendingGroupAdd) addToGroup(pendingGroupAdd.groupId, pendingGroupAdd.nodeId)
            setPendingGroupAdd(null)
          }}
          onCancel={() => setPendingGroupAdd(null)}
        />

        <ConfirmAddToGroupModal
          open={!!pendingContainerAdd}
          variant="container"
          nodeLabel={pendingContainerAdd ? (nodes.find((n) => n.id === pendingContainerAdd.nodeId)?.data.label ?? '') : ''}
          targetLabel={pendingContainerAdd ? (nodes.find((n) => n.id === pendingContainerAdd.containerId)?.data.label ?? '') : ''}
          onConfirm={() => {
            if (pendingContainerAdd) addToContainer(pendingContainerAdd.containerId, pendingContainerAdd.nodeId)
            setPendingContainerAdd(null)
          }}
          onCancel={() => setPendingContainerAdd(null)}
        />

        {/* Mounted in standalone too: status-check settings are hidden inside,
            but canvas prefs (snap, hide-IP) still apply. */}
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <PendingDevicesModal
          open={pendingModalOpen}
          onClose={() => setPendingModalOpen(false)}
          highlightId={pendingHighlightId}
          initialStatus={pendingModalStatus}
          demoDevices={tourInventoryDemo ? DEMO_PENDING_DEVICES : undefined}
        />

        <ExportModal
          open={exportModalOpen}
          onClose={() => setExportModalOpen(false)}
          getElement={() => canvasRef.current?.querySelector<HTMLElement>('.react-flow') ?? null}
        />

        <Toaster theme="dark" position="bottom-right" />
        <WalkthroughInvite />
        <WalkthroughOverlay />
      </ReactFlowProvider>
    </TooltipProvider>
    </WalkthroughActionsProvider>
  )
}
