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

interface CanvasState {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  hasUnsavedChanges: boolean
  selectedNodeId: string | null
  scanEventTs: number

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
}

export const useCanvasStore = create<CanvasState>((set) => ({
  nodes: [],
  edges: [],
  hasUnsavedChanges: false,
  selectedNodeId: null,
  editingGroupRectId: null,
  scanEventTs: 0,

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      hasUnsavedChanges: true,
    })),

  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      hasUnsavedChanges: true,
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
          data: { type: edgeType, label: extra.label, vlan_id: extra.vlan_id, custom_color: extra.custom_color, path_style: extra.path_style },
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
      // Parents must come before children in the array
      const withoutNew = state.nodes.filter((n) => n.id !== node.id)
      if (enriched.parentId) {
        return { nodes: [...withoutNew, enriched], hasUnsavedChanges: true }
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
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      hasUnsavedChanges: true,
    })),

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

  loadCanvas: (nodes, edges) => {
    // React Flow requires parents before children in the array
    const parents = nodes.filter((n) => !n.parentId)
    const children = nodes.filter((n) => !!n.parentId)
    set({ nodes: [...parents, ...children], edges, hasUnsavedChanges: false, selectedNodeId: null })
  },
}))
