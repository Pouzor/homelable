/**
 * Rack canvas: one React Flow node per rack, plus the cabling overlay.
 *
 * Rendered by `App` in place of `CanvasContainer` when the active design is of
 * type `rack`. React Flow context comes from the App-level provider.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import { Plus } from 'lucide-react'
import { rackHeight, rackWidth } from '../layout'
import { useRackStore } from '../store'
import { useRackPalette } from '../rackTheme'
import { useAutoStatusRefresh } from '../useAutoStatusRefresh'
import { CableLayer } from './CableLayer'
import { RackDeviceModal } from './RackDeviceModal'
import { RackFlowNode } from './RackFlowNode'
import { RackSettingsModal } from './RackSettingsModal'

const nodeTypes = { rack: RackFlowNode }

export function RackCanvas() {
  const racks = useRackStore((s) => s.racks)
  const moveRack = useRackStore((s) => s.moveRack)
  const selectDevice = useRackStore((s) => s.selectDevice)
  const cableMode = useRackStore((s) => s.cableMode)
  const loading = useRackStore((s) => s.loading)
  const loadError = useRackStore((s) => s.loadError)
  const designId = useRackStore((s) => s.designId)
  const storedViewport = useRackStore((s) => s.viewport)
  const setViewport = useRackStore((s) => s.setViewport)
  const addRack = useRackStore((s) => s.addRack)
  const loadDemo = useRackStore((s) => s.loadDemo)

  const palette = useRackPalette()
  const { setViewport: applyViewport } = useReactFlow()

  // Mounts set to "check device" read their LED from the inventory's
  // `node_status`, which only a refetch moves.
  useAutoStatusRefresh()

  // Restore the saved pan/zoom once per design, not on every viewport nudge.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!designId || loading || restoredFor.current === designId) return
    restoredFor.current = designId
    if (storedViewport.zoom > 0) void applyViewport(storedViewport)
  }, [designId, loading, storedViewport, applyViewport])

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
      <div className="flex h-full items-center justify-center text-sm text-[#f85149]">
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
          <p className="text-sm text-[#8b949e]">This rack canvas is empty.</p>
          <div className="pointer-events-auto flex gap-2">
            <button
              type="button"
              onClick={() => addRack({ style: palette.defaultRackStyle })}
              className="flex items-center gap-1.5 rounded border border-[#00d4ff] px-3 py-1.5 text-xs text-[#00d4ff] hover:bg-[#00d4ff]/10 cursor-pointer"
            >
              <Plus size={14} /> Add a rack
            </button>
            <button
              type="button"
              onClick={loadDemo}
              className="rounded border border-[#21262d] bg-[#161b22] px-3 py-1.5 text-xs text-[#8b949e] hover:border-[#30363d] hover:text-[#c9d1d9] cursor-pointer"
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
