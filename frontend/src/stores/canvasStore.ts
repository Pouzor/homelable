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
import { normalizeHandle, removedBottomHandleIds } from '@/utils/handleUtils'

type HistoryEntry = { nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] }

interface CanvasState {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  hasUnsavedChanges: boolean
  selectedNodeId: string | null
  selectedNodeIds: string[]
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
  createGroup: (nodeIds: string[], name: string) => void
  ungroup: (groupId: string) => void
  markSaved: () => void
  markUnsaved: () => void
  loadCanvas: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void
  fitViewPending: boolean
  clearFitViewPending: () => void
  notifyScanDeviceFound: () => void
  hideIp: boolean
  toggleHideIp: () => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  nodes: [],
  edges: [],
  hasUnsavedChanges: false,
  selectedNodeId: null,
  selectedNodeIds: [],
  editingGroupRectId: null,
  hideIp: false,
  scanEventTs: 0,
  fitViewPending: false,

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
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes)
      const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id)
      return {
        nodes,
        selectedNodeIds,
        hasUnsavedChanges: state.hasUnsavedChanges || changes.some((c) => c.type !== 'select'),
      }
    }),

  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      hasUnsavedChanges: state.hasUnsavedChanges || changes.some((c) => c.type !== 'select'),
    })),

  onConnect: (connection) =>
    set((state) => {
      const extra = connection as Connection & Partial<EdgeData>
      const edgeType = extra.type ?? 'ethernet'
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

  setSelectedNode: (id) => set({
    selectedNodeId: id,
    selectedNodeIds: id ? [id] : [],
  }),

  addNode: (node) =>
    set((state) => {
      const parent = node.data.parent_id ? state.nodes.find((n) => n.id === node.data.parent_id) : null
      const shouldNestInParent = !!(parent?.data.container_mode)
      const enriched = node.data.parent_id && shouldNestInParent
        ? {
            ...node,
            parentId: node.data.parent_id,
            extent: 'parent' as const,
            position: {
              x: Math.max(10, node.position.x - parent.position.x),
              y: Math.max(10, node.position.y - parent.position.y),
            },
          }
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
    set((state) => {
      let nodes = state.nodes.map((n) => {
        if (n.id !== id) return n
        const updated: Node<NodeData> = { ...n, data: { ...n.data, ...data } }
        // When properties change, clear stored height so the node auto-sizes to fit new content
        if ('properties' in data && n.data.type !== 'proxmox' && n.data.type !== 'groupRect') {
          updated.height = undefined
        }
        if ('parent_id' in data) {
          const newParentId = data.parent_id ?? undefined
          if (!newParentId && n.parentId) {
            // Detaching from a container: convert position back to absolute canvas coords
            const parent = state.nodes.find((p) => p.id === n.parentId)
            if (parent) {
              updated.position = {
                x: parent.position.x + n.position.x,
                y: parent.position.y + n.position.y,
              }
            }
            updated.parentId = undefined
            updated.extent = undefined
          } else if (newParentId && newParentId !== n.parentId) {
            const parent = state.nodes.find((p) => p.id === newParentId)
            if (parent?.data.container_mode) {
              // Attaching to a container-mode Proxmox: nest visually
              updated.parentId = newParentId
              updated.extent = 'parent' as const
              // Convert absolute position to parent-relative (keep node visible inside)
              updated.position = {
                x: Math.max(10, n.position.x - parent.position.x),
                y: Math.max(10, n.position.y - parent.position.y),
              }
            }
          }
        }
        return updated
      })
      // React Flow requires parent nodes to precede their children in the array
      if ('parent_id' in data) {
        const parents = nodes.filter((n) => !n.parentId)
        const children = nodes.filter((n) => !!n.parentId)
        nodes = [...parents, ...children]
      }
      // Remap edges when bottom_handles is reduced so no edge disappears
      let edges = state.edges
      if ('bottom_handles' in data && data.bottom_handles != null) {
        const currentNode = state.nodes.find((n) => n.id === id)
        const oldCount = currentNode?.data.bottom_handles ?? 1
        const newCount = data.bottom_handles
        if (newCount < oldCount) {
          const removed = removedBottomHandleIds(oldCount, newCount)
          edges = state.edges.map((e) => {
            if (e.source === id && e.sourceHandle && removed.has(e.sourceHandle))
              return { ...e, sourceHandle: 'bottom' }
            if (e.target === id && e.targetHandle && removed.has(e.targetHandle))
              return { ...e, targetHandle: 'bottom' }
            return e
          })
        }
      }

      return { nodes, edges, hasUnsavedChanges: true }
    }),

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
      const parentNode = state.nodes.find((n) => n.id === proxmoxId)
      let nodes = state.nodes.map((n) => {
        if (n.id === proxmoxId) {
          const withMode = { ...n, data: { ...n.data, container_mode: enabled } }
          if (n.data.type !== 'proxmox') return withMode
          return enabled
            ? { ...withMode, width: n.width ?? 300, height: n.height ?? 200 }
            : { ...withMode, width: undefined, height: undefined }
        }
        if (n.data.parent_id === proxmoxId) {
          if (enabled && parentNode) {
            return {
              ...n,
              parentId: proxmoxId,
              extent: 'parent' as const,
              position: {
                x: Math.max(10, n.position.x - parentNode.position.x),
                y: Math.max(10, n.position.y - parentNode.position.y),
              },
            }
          }
          if (!enabled && parentNode) {
            return {
              ...n,
              parentId: undefined,
              extent: undefined,
              position: {
                x: parentNode.position.x + n.position.x,
                y: parentNode.position.y + n.position.y,
              },
            }
          }
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

  createGroup: (nodeIds, name) =>
    set((state) => {
      const PADDING_H = 24
      const PADDING_TOP = 48
      const PADDING_BOTTOM = 24
      const targets = state.nodes.filter((n) => nodeIds.includes(n.id))
      if (targets.length === 0) return state

      // Bounding box in absolute coordinates
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of targets) {
        const w = n.width ?? 200
        const h = n.height ?? 80
        minX = Math.min(minX, n.position.x)
        minY = Math.min(minY, n.position.y)
        maxX = Math.max(maxX, n.position.x + w)
        maxY = Math.max(maxY, n.position.y + h)
      }

      const groupX = minX - PADDING_H
      const groupY = minY - PADDING_TOP
      const groupW = maxX - minX + PADDING_H * 2
      const groupH = maxY - minY + PADDING_TOP + PADDING_BOTTOM

      const groupId = generateUUID()
      const groupNode: Node<NodeData> = {
        id: groupId,
        type: 'group',
        position: { x: groupX, y: groupY },
        width: groupW,
        height: groupH,
        data: {
          label: name,
          type: 'group',
          status: 'unknown',
          services: [],
          custom_colors: { show_border: true },
        },
        selected: false,
      }

      // Convert children to relative positions and assign parentId
      const updatedNodes = state.nodes.map((n) => {
        if (!nodeIds.includes(n.id)) return n
        return {
          ...n,
          parentId: groupId,
          extent: 'parent' as const,
          position: {
            x: n.position.x - groupX,
            y: n.position.y - groupY,
          },
          selected: false,
          data: { ...n.data, parent_id: groupId },
        }
      })

      // Group node must come before its children
      const withoutTargets = updatedNodes.filter((n) => !nodeIds.includes(n.id))
      const children = updatedNodes.filter((n) => nodeIds.includes(n.id))
      const nodes = [...withoutTargets, groupNode, ...children]

      return {
        nodes,
        selectedNodeIds: [],
        selectedNodeId: null,
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  ungroup: (groupId) =>
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group) return state

      const groupAbsX = group.position.x
      const groupAbsY = group.position.y

      const nodes = state.nodes
        .filter((n) => n.id !== groupId)
        .map((n) => {
          if (n.parentId !== groupId) return n
          return {
            ...n,
            parentId: undefined,
            extent: undefined,
            position: {
              x: n.position.x + groupAbsX,
              y: n.position.y + groupAbsY,
            },
            data: { ...n.data, parent_id: undefined },
          }
        })

      return {
        nodes,
        selectedNodeId: null,
        selectedNodeIds: [],
        hasUnsavedChanges: true,
        past: [...state.past.slice(-49), { nodes: state.nodes, edges: state.edges }],
        future: [],
      }
    }),

  markSaved: () => set({ hasUnsavedChanges: false }),

  markUnsaved: () => set({ hasUnsavedChanges: true }),

  notifyScanDeviceFound: () => set({ scanEventTs: Date.now() }),

  toggleHideIp: () => set((s) => ({ hideIp: !s.hideIp })),

  loadCanvas: (nodes, edges) => {
    // React Flow requires parents before children in the array
    const parents = nodes.filter((n) => !n.parentId)
    const children = nodes.filter((n) => !!n.parentId)
    set({ nodes: [...parents, ...children], edges, hasUnsavedChanges: false, selectedNodeId: null, past: [], future: [], clipboard: [], fitViewPending: true })
  },

  clearFitViewPending: () => set({ fitViewPending: false }),
}))
