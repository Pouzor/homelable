/**
 * Rack canvas: one React Flow node per rack, plus the cabling overlay.
 *
 * Rendered by `App` in place of `CanvasContainer` when the active design is of
 * type `rack`. It carries its OWN `ReactFlowProvider`: sharing the App-level one
 * with the logical canvas leaks that canvas' pan/zoom and pane size into the
 * rack flow when the user switches back and forth.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import { Plus } from 'lucide-react'
import { isTypingTarget } from '@/utils/keyboard'
import { rackHeight, rackWidth } from '../layout'
import { useRackStore } from '../store'
import { useRackPalette } from '../rackTheme'
import { useAutoStatusRefresh } from '../useAutoStatusRefresh'
import { CableLayer } from './CableLayer'
import { RackDeviceModal } from './RackDeviceModal'
import { RackFlowNode } from './RackFlowNode'
import { RackSettingsModal } from './RackSettingsModal'

const nodeTypes = { rack: RackFlowNode }

function RackCanvasInner() {
  const racks = useRackStore((s) => s.racks)
  const moveRack = useRackStore((s) => s.moveRack)
  const selectDevice = useRackStore((s) => s.selectDevice)
  const cableMode = useRackStore((s) => s.cableMode)
  const loading = useRackStore((s) => s.loading)
  const loadError = useRackStore((s) => s.loadError)
  const designId = useRackStore((s) => s.designId)
  const setViewport = useRackStore((s) => s.setViewport)
  const addRack = useRackStore((s) => s.addRack)
  const loadDemo = useRackStore((s) => s.loadDemo)
  const selectCable = useRackStore((s) => s.selectCable)
  const removeSelectedCable = useRackStore((s) => s.removeSelectedCable)
  const selectedCableId = useRackStore((s) => s.selectedCableId)
  const dragging = useRackStore((s) => s.cableDrag != null)
  const moveCableDrag = useRackStore((s) => s.moveCableDrag)
  const endCableDrag = useRackStore((s) => s.endCableDrag)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cancelCableDraft = useRackStore((s) => s.cancelCableDraft)

  const palette = useRackPalette()
  const { fitView, getViewport, screenToFlowPosition } = useReactFlow()

  // Mounts set to "check device" read their LED from the inventory's
  // `node_status`, which only a refetch moves.
  useAutoStatusRefresh()

  // Fit the racks into view once per load, like the logical canvas does
  // (#619) — not on every edit, and never over a pan/zoom the user made since.
  //
  // Coming back from another canvas remounts this component BEFORE `App`'s
  // design effect calls `loadDesign`, so the first pass here sees the previous
  // state (#408). Clearing the marker whenever a load starts means the fit runs
  // against the racks the fetch brings back, not the pre-load leftover.
  //
  // A design that loads empty is marked too: adding its first rack must not
  // yank the view around.
  const fittedFor = useRef<string | null>(null)
  const hasRacks = racks.length > 0
  useEffect(() => {
    if (loading) {
      fittedFor.current = null
      return
    }
    if (!designId || fittedFor.current === designId) return
    fittedFor.current = designId
    if (!hasRacks) return
    // A frame later: on a fresh mount React Flow has not measured its pane yet.
    // fitView itself waits for the nodes to be measured.
    let fired = false
    const frame = requestAnimationFrame(() => {
      fired = true
      void fitView({ padding: 0.12 }).then(() => {
        // Where the fit landed is the viewport a save keeps.
        setViewport(getViewport())
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      // A fit cancelled before it ran (StrictMode's double effect, a dep
      // change) has not happened: let the next pass do it.
      if (!fired) fittedFor.current = null
    }
  }, [designId, loading, hasRacks, fitView, getViewport, setViewport])

  // A patch dragged out of a port follows the pointer until it is released.
  // Both listeners are on the window: the drop target is often a port on
  // another rack, and a release outside the canvas must still end the drag.
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) =>
      moveCableDrag(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
    // The port's own pointerup runs first and clears the drag, so reaching here
    // means the cable was released on nothing.
    const up = () => endCableDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, moveCableDrag, endCableDrag, screenToFlowPosition])

  // Delete/Backspace unplugs the selected cable; Escape deselects it, or drops
  // a half-drawn patch.
  useEffect(() => {
    if (!selectedCableId && !cableDraft) return
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return
      if (selectedCableId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removeSelectedCable()
      } else if (e.key === 'Escape') {
        selectCable(null)
        cancelCableDraft()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedCableId, cableDraft, removeSelectedCable, selectCable, cancelCableDraft])

  const nodes: Node[] = useMemo(
    () =>
      racks.map((rack) => ({
        id: rack.id,
        type: 'rack',
        position: rack.position,
        data: {},
        draggable: !cableMode,
        style: { width: rackWidth(rack), height: rackHeight(rack) },
      })),
    [racks, cableMode],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moveRack(change.id, change.position)
        }
      }
    },
    [moveRack],
  )

  const onMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => setViewport(viewport),
    [setViewport],
  )

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        Rack canvas could not be loaded.
      </div>
    )
  }

  return (
    <>
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onMoveEnd={onMoveEnd}
      onPaneClick={() => selectDevice(null)}
      minZoom={0.2}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
      style={{ background: palette.canvas }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={palette.dot} />
      <Controls />
      <CableLayer />
      {!loading && racks.length === 0 && (
        // z-10 clears .react-flow__renderer (z-index 4); without it the pane sits
        // on top and swallows the clicks as a canvas drag.
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">This rack canvas is empty.</p>
          <div className="pointer-events-auto flex gap-2">
            <button
              type="button"
              onClick={() => addRack({ style: palette.defaultRackStyle })}
              className="flex items-center gap-1.5 rounded border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 cursor-pointer"
            >
              <Plus size={14} /> Add a rack
            </button>
            <button
              type="button"
              onClick={loadDemo}
              className="rounded border border-secondary bg-popover px-3 py-1.5 text-xs text-muted-foreground hover:border-border hover:text-[#c9d1d9] cursor-pointer"
            >
              Load a sample rack
            </button>
          </div>
        </div>
      )}
    </ReactFlow>
    {/* Editors live outside the flow so a dialog is never clipped by it. */}
    <RackDeviceModal />
    <RackSettingsModal />
    </>
  )
}

export function RackCanvas() {
  return (
    <ReactFlowProvider>
      <RackCanvasInner />
    </ReactFlowProvider>
  )
}
