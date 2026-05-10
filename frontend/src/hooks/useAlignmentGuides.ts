import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, type Node, type NodeDragHandler } from '@xyflow/react'
import { computeSnap, unionBox, type Box, type Guide } from '@/utils/alignment'
import {
  type AlignmentSettings,
  readAlignmentSettings,
  writeAlignmentSettings,
  subscribeAlignmentSettings,
} from '@/utils/alignmentSettings'
import type { NodeData } from '@/types'

function nodeBox(n: Node<NodeData>): Box | null {
  // Skip nodes with a parent — alignment between absolute & parent-relative
  // coordinates is misleading. Top-level nodes only for v1.
  if (n.parentId) return null
  const width = n.measured?.width ?? n.width ?? null
  const height = n.measured?.height ?? n.height ?? null
  if (width == null || height == null) return null
  return { id: n.id, x: n.position.x, y: n.position.y, width, height }
}

export function useAlignmentGuides() {
  const [settings, setSettings] = useState<AlignmentSettings>(readAlignmentSettings)
  const [guides, setGuides] = useState<Guide[]>([])
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

  const onNodeDrag: NodeDragHandler = useCallback((_event, dragNode, dragNodes) => {
    if (!settings.enabled || altDownRef.current) {
      if (guides.length > 0) setGuides([])
      return
    }
    const all = getNodes()
    const draggedSet = new Set((dragNodes.length > 0 ? dragNodes : [dragNode]).map((n) => n.id))
    const draggedBoxes = all.filter((n) => draggedSet.has(n.id)).map(nodeBox).filter((b): b is Box => b !== null)
    if (draggedBoxes.length === 0) {
      if (guides.length > 0) setGuides([])
      return
    }
    const dragged = draggedBoxes.length === 1 ? draggedBoxes[0] : unionBox(draggedBoxes)
    if (!dragged) return
    const candidates = all
      .filter((n) => !draggedSet.has(n.id))
      .map(nodeBox)
      .filter((b): b is Box => b !== null)
    const result = computeSnap(dragged, candidates, settings.threshold)
    setGuides(result.guides)
    if (result.deltaX !== 0 || result.deltaY !== 0) {
      setNodes((ns) =>
        ns.map((n) =>
          draggedSet.has(n.id)
            ? { ...n, position: { x: n.position.x + result.deltaX, y: n.position.y + result.deltaY } }
            : n,
        ),
      )
    }
  }, [settings.enabled, settings.threshold, getNodes, setNodes, guides.length])

  const onNodeDragStop: NodeDragHandler = useCallback(() => {
    if (guides.length > 0) setGuides([])
  }, [guides.length])

  return { guides, settings, update, onNodeDrag, onNodeDragStop }
}
