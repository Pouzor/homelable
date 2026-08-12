import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, type Node, type OnNodeDrag } from '@xyflow/react'
import { computeSnap, unionBox, type Box, type Guide } from '@/utils/alignment'
import {
  type AlignmentSettings,
  readAlignmentSettings,
  writeAlignmentSettings,
  subscribeAlignmentSettings,
} from '@/utils/alignmentSettings'
import type { NodeData } from '@/types'

type NodeDrag = OnNodeDrag<Node<NodeData>>

// Absolute canvas position of a node: React Flow stores a parented node's
// position relative to its parent, so we walk the parentId chain and sum.
// `seen` guards against a corrupted cycle in the hierarchy.
function absolutePosition(
  n: Node<NodeData>,
  byId: Map<string, Node<NodeData>>,
): { x: number; y: number } {
  let x = n.position.x
  let y = n.position.y
  const seen = new Set<string>([n.id])
  let parentId = n.parentId
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentId
  }
  return { x, y }
}

// Boxes are expressed in absolute canvas coordinates so a node inside a group
// or a container_mode node aligns against siblings *and* outside nodes.
function nodeBox(n: Node<NodeData>, byId: Map<string, Node<NodeData>>): Box | null {
  const width = n.measured?.width ?? n.width ?? null
  const height = n.measured?.height ?? n.height ?? null
  if (width == null || height == null) return null
  const { x, y } = absolutePosition(n, byId)
  return { id: n.id, x, y, width, height }
}

// True when any ancestor of `n` is itself being dragged — such a node follows
// its parent, so it must not be snapped again (double-shift) nor act as an
// alignment candidate (it moves with the drag).
function hasDraggedAncestor(
  n: Node<NodeData>,
  byId: Map<string, Node<NodeData>>,
  draggedIds: Set<string>,
): boolean {
  const seen = new Set<string>([n.id])
  let parentId = n.parentId
  while (parentId && !seen.has(parentId)) {
    if (draggedIds.has(parentId)) return true
    seen.add(parentId)
    parentId = byId.get(parentId)?.parentId
  }
  return false
}

/**
 * Drag-time alignment guides + snap (draw.io / Figma style).
 *
 * Snap is applied on drag stop (not during drag) to avoid racing React Flow's
 * internal drag handler, which computes positions from the cursor offset
 * captured at drag start. Guides update live for visual feedback.
 *
 * Settings (enabled, threshold) live in localStorage and propagate same-tab
 * via a CustomEvent so the panel and the hook stay in sync.
 */
export function useAlignmentGuides() {
  const [settings, setSettings] = useState<AlignmentSettings>(readAlignmentSettings)
  const [guides, setGuides] = useState<Guide[]>([])
  // ref mirror of guides so callbacks don't need it in their deps
  const guidesRef = useRef<Guide[]>([])
  useEffect(() => { guidesRef.current = guides }, [guides])
  // latest snap deltas, applied on drag stop
  const pendingSnapRef = useRef<{ deltaX: number; deltaY: number; ids: Set<string> } | null>(null)
  const altDownRef = useRef(false)
  const { setNodes, getNodes } = useReactFlow<Node<NodeData>>()

  useEffect(() => subscribeAlignmentSettings(setSettings), [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.altKey) altDownRef.current = true }
    const up = (e: KeyboardEvent) => { if (!e.altKey) altDownRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const update = useCallback((patch: Partial<AlignmentSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      writeAlignmentSettings(next)
      return next
    })
  }, [])

  const clearState = useCallback(() => {
    if (guidesRef.current.length > 0) setGuides([])
    pendingSnapRef.current = null
  }, [])

  const onNodeDrag: NodeDrag = useCallback((_event, dragNode, dragNodes) => {
    if (!settings.enabled || altDownRef.current) {
      clearState()
      return
    }
    const all = getNodes()
    const byId = new Map(all.map((n) => [n.id, n]))
    const draggedIds = new Set((dragNodes.length > 0 ? dragNodes : [dragNode]).map((n) => n.id))
    // A dragged node whose parent is also dragged already moves with that
    // parent; snapping it too would shift its parent-relative position by the
    // same delta twice. Its box still joins the union bbox (it is part of what
    // the user sees moving), it just never lands in pendingSnap.ids.
    const draggedBoxEntries = all
      .filter((n) => draggedIds.has(n.id))
      .map((n) => ({
        id: n.id,
        box: nodeBox(n, byId),
        follows: hasDraggedAncestor(n, byId, draggedIds),
      }))
      .filter((e): e is { id: string; box: Box; follows: boolean } => e.box !== null)
    if (draggedBoxEntries.length === 0) {
      clearState()
      return
    }
    const snapIds = new Set(draggedBoxEntries.filter((e) => !e.follows).map((e) => e.id))
    if (snapIds.size === 0) {
      clearState()
      return
    }
    const boxes = draggedBoxEntries.map((e) => e.box)
    const dragged = boxes.length === 1 ? boxes[0] : unionBox(boxes)
    if (!dragged) return
    const candidates = all
      .filter((n) => !draggedIds.has(n.id) && !hasDraggedAncestor(n, byId, draggedIds))
      .map((n) => nodeBox(n, byId))
      .filter((b): b is Box => b !== null)
    const result = computeSnap(dragged, candidates, settings.threshold)
    setGuides(result.guides)
    pendingSnapRef.current =
      result.deltaX !== 0 || result.deltaY !== 0
        ? { deltaX: result.deltaX, deltaY: result.deltaY, ids: snapIds }
        : null
  }, [settings.enabled, settings.threshold, getNodes, clearState])

  const onNodeDragStop: NodeDrag = useCallback(() => {
    const pending = pendingSnapRef.current
    if (pending) {
      setNodes((ns) =>
        ns.map((n) =>
          pending.ids.has(n.id)
            ? { ...n, position: { x: n.position.x + pending.deltaX, y: n.position.y + pending.deltaY } }
            : n,
        ),
      )
    }
    clearState()
  }, [setNodes, clearState])

  return { guides, settings, update, onNodeDrag, onNodeDragStop }
}
