/**
 * Port-to-port cabling, drawn in canvas space above the racks.
 *
 * Lives in a ViewportPortal so the paths pan and zoom with the flow without
 * being React Flow edges — rack cables are a physical relation, not a logical
 * one, and they attach to ports rather than to node handles.
 */
import { ViewportPortal } from '@xyflow/react'
import { portPosition } from '../layout'
import { useRackPalette } from '../rackTheme'
import { useRackStore } from '../store'
import type { Cable, Port, Rack, RackDevice } from '@/types'

interface Resolved {
  cable: Cable
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/** Slack loop: cables bulge out sideways, more so over long vertical runs. */
function cablePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dy = Math.abs(b.y - a.y)
  const bulge = Math.min(90, 18 + dy * 0.45)
  return `M ${a.x} ${a.y} C ${a.x + bulge} ${a.y + bulge * 0.4}, ${b.x + bulge} ${b.y + bulge * 0.4}, ${b.x} ${b.y}`
}

export function CableLayer() {
  const racks = useRackStore((s) => s.racks)
  const devices = useRackStore((s) => s.devices)
  const cables = useRackStore((s) => s.cables)
  const visibility = useRackStore((s) => s.cableVisibility)
  const hoveredDeviceId = useRackStore((s) => s.hoveredDeviceId)
  const selectedDeviceId = useRackStore((s) => s.selectedDeviceId)
  const cableMode = useRackStore((s) => s.cableMode)
  const selectedCableId = useRackStore((s) => s.selectedCableId)
  const selectCable = useRackStore((s) => s.selectCable)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cableDrag = useRackStore((s) => s.cableDrag)
  const palette = useRackPalette()

  if (visibility === 'hidden' && !cableMode) return null

  const rackById = new Map<string, Rack>(racks.map((r) => [r.id, r]))
  const deviceById = new Map<string, RackDevice>(devices.map((d) => [d.id, d]))

  const focus = hoveredDeviceId ?? selectedDeviceId
  const showAll = cableMode || visibility === 'always'

  const resolve = (deviceId: string, portId: string) => {
    const device = deviceById.get(deviceId)
    const rack = device && rackById.get(device.rackId)
    const port: Port | undefined = device?.ports.find((p) => p.id === portId)
    if (!device || !rack || !port) return null
    return portPosition(rack, device, port)
  }

  const visible: Resolved[] = []
  for (const cable of cables) {
    if (!showAll) {
      if (!focus) continue
      if (cable.from.deviceId !== focus && cable.to.deviceId !== focus) continue
    }
    const from = resolve(cable.from.deviceId, cable.from.portId)
    const to = resolve(cable.to.deviceId, cable.to.portId)
    if (!from || !to) continue
    visible.push({ cable, from, to })
  }

  // Rubber band: the patch being dragged out of its source port.
  const dragFrom = cableDraft && resolve(cableDraft.deviceId, cableDraft.portId)
  const dragTo = cableDrag?.pointer ?? null
  const draftLine = dragFrom && dragTo ? { from: dragFrom, to: dragTo } : null

  if (visible.length === 0 && !draftLine) return null

  return (
    <ViewportPortal>
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        {visible.map(({ cable, from, to }) => {
          const selected = cableMode && cable.id === selectedCableId
          const dimmed =
            !selected && focus != null && cable.from.deviceId !== focus && cable.to.deviceId !== focus
          const d = cablePath(from, to)
          return (
            <g key={cable.id} opacity={dimmed ? 0.28 : 1}>
              {selected && (
                <path
                  d={d}
                  fill="none"
                  stroke={palette.accent}
                  strokeWidth={7}
                  strokeLinecap="round"
                  opacity={0.45}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <path
                d={d}
                fill="none"
                stroke="#0d1117"
                strokeWidth={3.5}
                strokeLinecap="round"
              />
              <path
                d={d}
                fill="none"
                stroke={selected ? palette.accent : cable.color}
                strokeWidth={selected ? 2.6 : 1.8}
                strokeLinecap="round"
                style={{ pointerEvents: 'none' }}
              />
              {/* Fat invisible hit area — a 1.8px path is hard to hit at low zoom. */}
              {cableMode && (
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={(e) => {
                    // The pane click behind would clear the selection again.
                    e.stopPropagation()
                    selectCable(selected ? null : cable.id)
                  }}
                >
                  <title>
                    {cable.label ? `${cable.label} — ${cable.type}` : cable.type}
                    {' (click to select, Delete to remove)'}
                  </title>
                </path>
              )}
              <circle cx={from.x} cy={from.y} r={selected ? 3.2 : 2.2} fill={selected ? palette.accent : cable.color} />
              <circle cx={to.x} cy={to.y} r={selected ? 3.2 : 2.2} fill={selected ? palette.accent : cable.color} />
            </g>
          )
        })}

        {draftLine && (
          <g data-testid="cable-draft" style={{ pointerEvents: 'none' }}>
            <path
              d={cablePath(draftLine.from, draftLine.to)}
              fill="none"
              stroke={palette.accent}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
            <circle cx={draftLine.from.x} cy={draftLine.from.y} r={3} fill={palette.accent} />
            <circle
              cx={draftLine.to.x}
              cy={draftLine.to.y}
              r={3.5}
              fill="none"
              stroke={palette.accent}
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>
    </ViewportPortal>
  )
}
