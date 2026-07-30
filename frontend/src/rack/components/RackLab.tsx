/**
 * Rack canvas prototype shell.
 *
 * Front-only: no API calls, no persistence. Mounted at /racklab so it can be
 * iterated on without touching the logical canvas.
 */
import { useCallback, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { rackHeight, rackWidth } from '../layout'
import { useRackStore } from '../store'
import { CABLE_TYPE_LABELS } from '../rackDefaults'
import type { CableType, CableVisibility } from '../types'
import { CableLayer } from './CableLayer'
import { InventoryTray } from './InventoryTray'
import { RackFlowNode } from './RackFlowNode'
import { RackInspector } from './RackInspector'

const nodeTypes = { rack: RackFlowNode }

const barButton =
  'rounded border border-[#21262d] bg-[#161b22] px-2.5 py-1 text-xs text-[#c9d1d9] hover:border-[#00d4ff]'
const barSelect =
  'rounded border border-[#21262d] bg-[#161b22] px-2 py-1 text-xs text-[#c9d1d9] outline-none focus:border-[#00d4ff]'

function RackCanvas() {
  const racks = useRackStore((s) => s.racks)
  const moveRack = useRackStore((s) => s.moveRack)
  const selectDevice = useRackStore((s) => s.selectDevice)
  const cableMode = useRackStore((s) => s.cableMode)

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onPaneClick={() => selectDevice(null)}
      minZoom={0.2}
      maxZoom={3}
      fitView
      proOptions={{ hideAttribution: true }}
      style={{ background: '#0d1117' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#21262d" />
      <Controls />
      <CableLayer />
    </ReactFlow>
  )
}

function RackToolbar() {
  const addRack = useRackStore((s) => s.addRack)
  const cableMode = useRackStore((s) => s.cableMode)
  const toggleCableMode = useRackStore((s) => s.toggleCableMode)
  const cableVisibility = useRackStore((s) => s.cableVisibility)
  const setCableVisibility = useRackStore((s) => s.setCableVisibility)
  const cableTypeFilter = useRackStore((s) => s.cableTypeFilter)
  const setCableTypeFilter = useRackStore((s) => s.setCableTypeFilter)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cancelCableDraft = useRackStore((s) => s.cancelCableDraft)
  const importCables = useRackStore((s) => s.importCablesFromNetwork)
  const networkImportDone = useRackStore((s) => s.networkImportDone)
  const reset = useRackStore((s) => s.reset)

  return (
    <header className="flex items-center gap-2 border-b border-[#21262d] bg-[#161b22] px-3 py-2">
      <span className="mr-2 text-sm font-semibold text-[#c9d1d9]">Rack view</span>
      <span className="rounded bg-[#21262d] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#e3b341]">
        prototype
      </span>

      <button className={barButton} onClick={() => addRack()}>
        + Rack
      </button>

      <button
        className={`${barButton} ${cableMode ? 'border-[#00d4ff] text-[#00d4ff]' : ''}`}
        onClick={toggleCableMode}
        title="Click a port, then another, to patch. Click a cable to remove it."
      >
        {cableMode ? 'Exit patching' : 'Patch mode'}
      </button>

      {cableMode && cableDraft && (
        <button className={`${barButton} border-[#e3b341] text-[#e3b341]`} onClick={cancelCableDraft}>
          Cancel cable
        </button>
      )}

      <label className="ml-2 flex items-center gap-1 text-[11px] text-[#6e7681]">
        Cables
        <select
          className={barSelect}
          value={cableVisibility}
          onChange={(e) => setCableVisibility(e.target.value as CableVisibility)}
        >
          <option value="hover">On hover / selection</option>
          <option value="always">Always</option>
          <option value="hidden">Hidden</option>
        </select>
      </label>

      <select
        className={barSelect}
        value={cableTypeFilter}
        onChange={(e) => setCableTypeFilter(e.target.value as CableType | 'all')}
      >
        <option value="all">All types</option>
        {(Object.keys(CABLE_TYPE_LABELS) as CableType[]).map((t) => (
          <option key={t} value={t}>
            {CABLE_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      <button
        className={barButton}
        disabled={networkImportDone}
        onClick={() => importCables()}
        title="One-shot: derive cables from the links already drawn on the logical canvas"
      >
        Import links from network canvas
      </button>

      <button className={`${barButton} ml-auto`} onClick={reset}>
        Reset demo
      </button>
    </header>
  )
}

export default function RackLab() {
  return (
    <ReactFlowProvider>
      <div className="flex h-screen w-screen flex-col bg-[#0d1117]">
        <RackToolbar />
        <div className="flex min-h-0 flex-1">
          <InventoryTray />
          <main className="min-w-0 flex-1">
            <RackCanvas />
          </main>
          <RackInspector />
        </div>
      </div>
    </ReactFlowProvider>
  )
}
