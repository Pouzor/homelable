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
  markSaved: () => void
  loadCanvas: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  nodes: [],
  edges: [],
  hasUnsavedChanges: false,
  selectedNodeId: null,

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
    set((state) => ({
      edges: addEdge({ ...connection, type: 'ethernet', data: { type: 'ethernet' } }, state.edges),
      hasUnsavedChanges: true,
    })),

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

  markSaved: () => set({ hasUnsavedChanges: false }),

  loadCanvas: (nodes, edges) => {
    // React Flow requires parents before children in the array
    const parents = nodes.filter((n) => !n.parentId)
    const children = nodes.filter((n) => !!n.parentId)
    set({ nodes: [...parents, ...children], edges, hasUnsavedChanges: false, selectedNodeId: null })
  },
}))
