/**
 * Port-to-port cabling, drawn in canvas space above the racks.
 *
 * Lives in a ViewportPortal so the paths pan and zoom with the flow without
 * being React Flow edges — rack cables are a physical relation, not a logical
 * one, and they attach to ports rather than to node handles.
 */
import { ViewportPortal } from '@xyflow/react'
import { visibleCables } from '../cableVisibility'
import { portPosition } from '../layout'
import { useRackPalette, type RackPalette } from '../rackTheme'
import { useRackStore } from '../store'
import type { Cable, Port, Rack, RackDevice } from '@/types'

interface Resolved {
  cable: Cable
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/** Slack loop: cables bulge out sideways, more so over long vertical runs. */
function bulgeFor(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.min(90, 18 + Math.abs(b.y - a.y) * 0.45)
}

function cablePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const bulge = bulgeFor(a, b)
  return `M ${a.x} ${a.y} C ${a.x + bulge} ${a.y + bulge * 0.4}, ${b.x + bulge} ${b.y + bulge * 0.4}, ${b.x} ${b.y}`
}

/**
 * Midpoint of the same cubic, evaluated at t = 0.5 — where the annotations
 * hang. Solved analytically rather than with `getPointAtLength`, which needs a
 * mounted path element and would not work under jsdom.
 */
function cableMidpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  const bulge = bulgeFor(a, b)
  const c1 = { x: a.x + bulge, y: a.y + bulge * 0.4 }
  const c2 = { x: b.x + bulge, y: b.y + bulge * 0.4 }
  return {
    x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
    y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
  }
}

/** Lines a cable prints on the canvas: its label, then its visible properties. */
function annotationLines(cable: Cable): string[] {
  const lines: string[] = []
  if (cable.labelVisible && cable.label?.trim()) lines.push(cable.label.trim())
  for (const prop of cable.properties ?? []) {
    // The value is optional — a property may print as a bare label.
    if (prop.visible) lines.push(prop.value?.trim() ? `${prop.key}: ${prop.value}` : prop.key)
  }
  return lines
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

  // `hidden` still draws the selected cable: its panel is open on the right and
  // editing a run nothing shows reads as a bug. The per-cable filter below is
  // what decides; this only skips the work when there is nothing to draw.
  if (visibility === 'hidden' && !cableMode && !selectedCableId) return null

  const rackById = new Map<string, Rack>(racks.map((r) => [r.id, r]))
  const deviceById = new Map<string, RackDevice>(devices.map((d) => [d.id, d]))

  // Also what dims the runs that are on screen but not the focused device's.
  const focus = hoveredDeviceId ?? selectedDeviceId

  const resolve = (deviceId: string, portId: string) => {
    const device = deviceById.get(deviceId)
    const rack = device && rackById.get(device.rackId)
    const port: Port | undefined = device?.ports.find((p) => p.id === portId)
    if (!device || !rack || !port) return null
    return portPosition(rack, device, port)
  }

  const visible: Resolved[] = []
  // The same rule decides which sockets the plates draw — see `cableVisibility`.
  for (const cable of visibleCables(cables, {
    visibility,
    cableMode,
    focusDeviceId: focus,
    selectedCableId,
  })) {
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
          const selected = cable.id === selectedCableId
          const dimmed =
            !selected && focus != null && cable.from.deviceId !== focus && cable.to.deviceId !== focus
          const d = cablePath(from, to)
          const lines = annotationLines(cable)
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
              {/* Fat invisible hit area — a 1.8px path is hard to hit at low
                  zoom. Clickable outside patch mode too: a cable is selected to
                  read and edit it, not only to unplug it. */}
              <path
                data-testid={`cable-hit-${cable.id}`}
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
              <circle cx={from.x} cy={from.y} r={selected ? 3.2 : 2.2} fill={selected ? palette.accent : cable.color} />
              <circle cx={to.x} cy={to.y} r={selected ? 3.2 : 2.2} fill={selected ? palette.accent : cable.color} />
              {lines.length > 0 && (
                <CableAnnotation
                  lines={lines}
                  at={cableMidpoint(from, to)}
                  color={selected ? palette.accent : cable.color}
                  palette={palette}
                />
              )}
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

const ANNOTATION_FONT = 7
const ANNOTATION_LINE = 9

/**
 * The label and visible properties of one cable, printed on a plate at the
 * midpoint of its run.
 *
 * Drawn in flow coordinates like the rest of the overlay, so it pans and zooms
 * with the racks. The plate is sized from the character count — SVG has no text
 * metrics before layout, and measuring in the DOM would cost a reflow per cable.
 */
function CableAnnotation({ lines, at, color, palette }: {
  lines: string[]
  at: { x: number; y: number }
  color: string
  palette: RackPalette
}) {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.max(24, longest * ANNOTATION_FONT * 0.56 + 8)
  const height = lines.length * ANNOTATION_LINE + 4
  const x = at.x - width / 2
  const y = at.y - height / 2

  return (
    <g style={{ pointerEvents: 'none' }} data-testid="cable-annotation">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill={palette.plate}
        stroke={color}
        strokeWidth={0.6}
        opacity={0.95}
      />
      {lines.map((line, i) => (
        <text
          key={`${line}-${i}`}
          x={at.x}
          y={y + 2 + ANNOTATION_LINE * (i + 1) - 2.5}
          textAnchor="middle"
          fontSize={ANNOTATION_FONT}
          fill={palette.text}
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {line}
        </text>
      ))}
    </g>
  )
}
