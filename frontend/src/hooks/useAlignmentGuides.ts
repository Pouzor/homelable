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

function nodeBox(n: Node<NodeData>): Box | null {
  // Skip parented nodes — alignment between absolute and parent-relative
  // coordinates is misleading. Top-level nodes only for v1.
  if (n.parentId) return null
  const width = n.measured?.width ?? n.width ?? null
  const height = n.measured?.height ?? n.height ?? null
  if (width == null || height == null) return null
  return { id: n.id, x: n.position.x, y: n.position.y, width, height }
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
    const draggedIds = new Set((dragNodes.length > 0 ? dragNodes : [dragNode]).map((n) => n.id))
    // Restrict the snap to top-level dragged nodes. nodeBox returns null for
    // parented nodes; if we kept their ids in pendingSnap, onNodeDragStop
    // would shift their parent-relative position by the same delta the parent
    // already moves by, double-snapping the child. Children follow the parent
    // automatically; no extra shift needed.
    const draggedBoxEntries = all
      .filter((n) => draggedIds.has(n.id))
      .map((n) => ({ id: n.id, box: nodeBox(n) }))
      .filter((e): e is { id: string; box: Box } => e.box !== null)
    if (draggedBoxEntries.length === 0) {
      clearState()
      return
    }
    const snapIds = new Set(draggedBoxEntries.map((e) => e.id))
    const boxes = draggedBoxEntries.map((e) => e.box)
    const dragged = boxes.length === 1 ? boxes[0] : unionBox(boxes)
    if (!dragged) return
    const candidates = all
      .filter((n) => !draggedIds.has(n.id))
      .map(nodeBox)
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
