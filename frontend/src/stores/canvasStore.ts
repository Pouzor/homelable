import { create } from 'zustand'
import {
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import { generateUUID } from '@/utils/uuid'

type HistoryEntry = { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] }

interface CanvasState {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  hasUnsavedChanges: boolean
  selectedNodeId: string | null
  scanEventTs: number

  // History
  past: HistoryEntry[]
  future: HistoryEntry[]
  snapshotHistory: () => void
  undo: () => void
  redo: () => void

  // Clipboard
  clipboard: Node<NodeData>[]
  copySelectedNodes: () => void
  pasteNodes: () => void

  onNodesChange: (changes: NodeChange<Node<NodeData>>[]) => void
  onEdgesChange: (changes: EdgeChange<Edge<EdgeData>>[]) => void
  onConnect: (connection: Connection) => void
  setSelectedNode: (id: string | null) => void
  addNode: (node: Node<NodeData>) => void
  updateNode: (id: string, data: Partial<NodeData>) => void
  deleteNode: (id: string) => void
  updateEdge: (id: string, data: Partial<EdgeData>) => void
  deleteEdge: (id: string) => void
  setProxmoxContainerMode: (proxmoxId: string, enabled: boolean) => void
  setNodeZIndex: (id: string, zIndex: number) => void
  editingGroupRectId: string | null
  setEditingGroupRectId: (id: string | null) => void
  markSaved: () => void
  markUnsaved: () => void
  loadCanvas: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void
  notifyScanDeviceFound: () => void
  hideIp: boolean
  toggleHideIp: () => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  nodes: [],
  edges: [],
  hasUnsavedChanges: false,
  selectedNodeId: null,
  editingGroupRectId: null,
  hideIp: false,
  scanEventTs: 0,

  past: [],
  future: [],
  clipboard: [],

  snapshotHistory: () =>
    set((state) => ({
      past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
      future: [],
    })),

  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        nodes: previous.nodes,
        edges: previous.edges,
        past: state.past.slice(0, -1),
        future: [{ nodes: state.nodes, edges: state.edges }, ...state.future.slice(0, 49)],
        hasUnsavedChanges: true,
      }
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        nodes: next.nodes,
        edges: next.edges,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: state.future.slice(1),
        hasUnsavedChanges: true,
      }
    }),

  copySelectedNodes: () =>
    set((state) => ({
      clipboard: state.nodes.filter((n) => n.selected),
    })),

  pasteNodes: () =>
    set((state) => {
      if (state.clipboard.length === 0) return state
      const newNodes = state.clipboard.map((n) => ({
        ...n,
        id: generateUUID(),
        position: { x: n.position.x + 50, y: n.position.y + 50 },
        selected: false,
        parentId: undefined,
        extent: undefined,
        data: { ...n.data, parent_id: undefined },
      }))
      return {
        nodes: [...state.nodes, ...newNodes],
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
        hasUnsavedChanges: true,
      }
    }),

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      hasUnsavedChanges: state.hasUnsavedChanges || changes.some((c) => c.type !== 'select'),
    })),

  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      hasUnsavedChanges: state.hasUnsavedChanges || changes.some((c) => c.type !== 'select'),
    })),

  onConnect: (connection) =>
    set((state) => {
      const extra = connection as Connection & Partial<EdgeData>
      const edgeType = extra.type ?? 'ethernet'
      // Normalize invisible stub handle IDs so React Flow can locate the handle
      // and render the edge immediately (top-t / bottom-t are opacity:0 helpers).
      const normalizeHandle = (h: string | null | undefined) =>
        h === 'top-t' ? 'top' : h === 'bottom-t' ? 'bottom' : (h ?? null)
      return {
        edges: addEdge({
          ...connection,
          sourceHandle: normalizeHandle(extra.sourceHandle),
          targetHandle: normalizeHandle(extra.targetHandle),
          type: edgeType,
          data: { type: edgeType, label: extra.label, vlan_id: extra.vlan_id, custom_color: extra.custom_color, path_style: extra.path_style, animated: extra.animated },
        }, state.edges),
        hasUnsavedChanges: true,
      }
    }),

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addNode: (node) =>
    set((state) => {
      const enriched = node.data.parent_id
        ? { ...node, parentId: node.data.parent_id, extent: 'parent' as const }
        : node
      // Parents must come before children in the array (React Flow requirement)
      const withoutNew = state.nodes.filter((n) => n.id !== node.id)
      if (enriched.parentId) {
        const parentIdx = withoutNew.findIndex((n) => n.id === enriched.parentId)
        const insertAt = parentIdx >= 0 ? parentIdx + 1 : withoutNew.length
        const nodes = [...withoutNew.slice(0, insertAt), enriched, ...withoutNew.slice(insertAt)]
        return { nodes, hasUnsavedChanges: true }
      }
      return { nodes: [...withoutNew, enriched], hasUnsavedChanges: true }
    }),

  updateNode: (id, data) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
      hasUnsavedChanges: true,
    })),

  deleteNode: (id) =>
    set((state) => {
      const idsToRemove = new Set<string>()
      const collect = (nodeId: string) => {
        idsToRemove.add(nodeId)
        state.nodes.filter((n) => n.parentId === nodeId).forEach((n) => collect(n.id))
      }
      collect(id)
      return {
        nodes: state.nodes.filter((n) => !idsToRemove.has(n.id)),
        edges: state.edges.filter((e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target)),
        selectedNodeId: idsToRemove.has(state.selectedNodeId ?? '') ? null : state.selectedNodeId,
        hasUnsavedChanges: true,
      }
    }),

  updateEdge: (id, data) =>
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === id ? { ...e, type: data.type ?? e.type, data: { ...e.data, ...data } as EdgeData } : e
      ),
      hasUnsavedChanges: true,
    })),

  deleteEdge: (id) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      hasUnsavedChanges: true,
    })),

  setProxmoxContainerMode: (proxmoxId, enabled) =>
    set((state) => {
      let nodes = state.nodes.map((n) => {
        if (n.id === proxmoxId) {
          const withMode = { ...n, data: { ...n.data, container_mode: enabled } }
          return enabled
            ? { ...withMode, width: 300, height: 200 }
            : { ...withMode, width: undefined, height: undefined }
        }
        if (n.data.parent_id === proxmoxId) {
          return enabled
            ? { ...n, parentId: proxmoxId, extent: 'parent' as const }
            : { ...n, parentId: undefined, extent: undefined }
        }
        return n
      })
      if (enabled) {
        const parents = nodes.filter((n) => !n.parentId)
        const children = nodes.filter((n) => !!n.parentId)
        nodes = [...parents, ...children]
      }
      return { nodes, hasUnsavedChanges: true }
    }),

  setNodeZIndex: (id, zIndex) =>
    set((state) => ({
      nodes: state.nodes.map((n) => n.id === id ? { ...n, zIndex } : n),
      hasUnsavedChanges: true,
    })),

  setEditingGroupRectId: (id) => set({ editingGroupRectId: id }),

  markSaved: () => set({ hasUnsavedChanges: false }),

  markUnsaved: () => set({ hasUnsavedChanges: true }),

  notifyScanDeviceFound: () => set({ scanEventTs: Date.now() }),

  toggleHideIp: () => set((s) => ({ hideIp: !s.hideIp })),

  loadCanvas: (nodes, edges) => {
    // React Flow requires parents before children in the array
    const parents = nodes.filter((n) => !n.parentId)
    const children = nodes.filter((n) => !!n.parentId)
    set({ nodes: [...parents, ...children], edges, hasUnsavedChanges: false, selectedNodeId: null, past: [], future: [], clipboard: [] })
  },
}))
