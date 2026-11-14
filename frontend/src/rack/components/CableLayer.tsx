/**
 * Port-to-port cabling, drawn in canvas space above the racks.
 *
 * Lives in a ViewportPortal so the paths pan and zoom with the flow without
 * being React Flow edges — rack cables are a physical relation, not a logical
 * one, and they attach to ports rather than to node handles.
 */
import { useEffect, useRef, useState } from 'react'
import { ViewportPortal, useReactFlow } from '@xyflow/react'
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

/** Screen pixels a press must travel before it is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3

interface LabelDrag {
  cableId: string
  /** Where the press landed, on screen and in flow space. */
  startClient: { x: number; y: number }
  startFlow: { x: number; y: number }
  /** The offset the plate had when it was picked up. */
  base: { x: number; y: number }
  moved: boolean
}

/**
 * Drag an annotation plate off its run.
 *
 * The offset lives in component state while the pointer is down and reaches
 * the store once, on release — a store write per pointer move would bump the
 * edit counter (and re-arm autosave) dozens of times for one gesture.
 */
function useLabelDrag() {
  const { screenToFlowPosition } = useReactFlow()
  const moveCableLabel = useRackStore((s) => s.moveCableLabel)
  const [drag, setDrag] = useState<{ cableId: string; offset: { x: number; y: number } } | null>(null)
  const active = useRef<LabelDrag | null>(null)
  /** A drag ends in a click on the plate; that click must not toggle selection. */
  const swallowClick = useRef(false)

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const offsetAt = (d: LabelDrag, e: PointerEvent) => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      return { x: d.base.x + p.x - d.startFlow.x, y: d.base.y + p.y - d.startFlow.y }
    }
    const move = (e: PointerEvent) => {
      const d = active.current
      if (!d) return
      if (!d.moved) {
        const travel = Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y)
        if (travel < DRAG_THRESHOLD_PX) return
        d.moved = true
      }
      setDrag({ cableId: d.cableId, offset: offsetAt(d, e) })
    }
    const up = (e: PointerEvent) => {
      const d = active.current
      active.current = null
      setDrag(null)
      if (!d?.moved) return
      swallowClick.current = true
      moveCableLabel(d.cableId, offsetAt(d, e))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, screenToFlowPosition, moveCableLabel])

  const start = (cable: Cable, e: React.PointerEvent) => {
    // Keep the press off the pane: it would pan the canvas, or start a rack drag.
    e.stopPropagation()
    if (e.button !== 0) return
    const base = cable.labelOffset ?? { x: 0, y: 0 }
    active.current = {
      cableId: cable.id,
      startClient: { x: e.clientX, y: e.clientY },
      startFlow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      base,
      moved: false,
    }
    setDrag({ cableId: cable.id, offset: base })
  }

  /** The offset to draw for `cable`: the live one while it is being dragged. */
  const offsetOf = (cable: Cable) =>
    drag?.cableId === cable.id ? drag.offset : (cable.labelOffset ?? { x: 0, y: 0 })

  /** True once, for the click that ends a drag. */
  const consumeDragClick = () => {
    const swallow = swallowClick.current
    swallowClick.current = false
    return swallow
  }

  return { start, offsetOf, consumeDragClick, draggingId: drag?.cableId ?? null }
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
  const labelsVisible = useRackStore((s) => s.cableLabelsVisible)
  const palette = useRackPalette()
  const labelDrag = useLabelDrag()

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

  // A port is armed: the next release belongs to the plates, not to the runs
  // drawn over them.
  const patching = cableDraft !== null

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
          // The selected cable keeps its plate whatever the toggle says — its
          // panel is open. A dimmed run drops its plate: it is not the one being
          // looked at, and its plate is what hides the ports of the one that is.
          const showPlate =
            lines.length > 0 &&
            (selected || labelDrag.draggingId === cable.id || (labelsVisible && !dimmed))
          const mid = cableMidpoint(from, to)
          const offset = labelDrag.offsetOf(cable)
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
                  read and edit it, not only to unplug it.

                  It steps aside while a patch is in flight: the overlay paints
                  above the plates and this stroke is 14 wide around a run's own
                  end point, so it covered the very socket the cable is plugged
                  into. Releasing a second patch on a patch panel port landed on
                  the cable instead of the port, and the canvas read it as a
                  drop on nothing. */}
              <path
                data-testid={`cable-hit-${cable.id}`}
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                strokeLinecap="round"
                style={{ pointerEvents: patching ? 'none' : 'stroke', cursor: 'pointer' }}
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
              {showPlate && (offset.x !== 0 || offset.y !== 0) && (
                // A plate parked off its run is tied back to it, or a busy rack
                // leaves no way to tell which cable it describes.
                <line
                  data-testid="cable-annotation-leader"
                  x1={mid.x}
                  y1={mid.y}
                  x2={mid.x + offset.x}
                  y2={mid.y + offset.y}
                  stroke={selected ? palette.accent : cable.color}
                  strokeWidth={0.8}
                  strokeDasharray="2 2"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {showPlate && (
                <CableAnnotation
                  lines={lines}
                  at={{ x: mid.x + offset.x, y: mid.y + offset.y }}
                  color={selected ? palette.accent : cable.color}
                  palette={palette}
                  // Like the hit stroke, the plate steps aside while a patch is
                  // in flight, so a release over it still reaches the port.
                  interactive={!patching}
                  onPointerDown={(e) => labelDrag.start(cable, e)}
                  onClick={(e) => {
                    // The pane click behind would clear the selection again.
                    e.stopPropagation()
                    if (labelDrag.consumeDragClick()) return
                    selectCable(selected ? null : cable.id)
                  }}
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
function CableAnnotation({ lines, at, color, palette, interactive, onPointerDown, onClick }: {
  lines: string[]
  at: { x: number; y: number }
  color: string
  palette: RackPalette
  /** Grab to move it off the run; click to select its cable. */
  interactive: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
}) {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = Math.max(24, longest * ANNOTATION_FONT * 0.56 + 8)
  const height = lines.length * ANNOTATION_LINE + 4
  const x = at.x - width / 2
  const y = at.y - height / 2

  return (
    <g
      data-testid="cable-annotation"
      // `nodrag nopan`: React Flow's own opt-out, so the press moves the plate
      // instead of panning the canvas underneath.
      className="nodrag nopan"
      style={{ pointerEvents: interactive ? 'all' : 'none', cursor: interactive ? 'grab' : undefined }}
      onPointerDown={interactive ? onPointerDown : undefined}
      onClick={interactive ? onClick : undefined}
    >
      {interactive && <title>Drag to move this label, click to select its cable</title>}
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
