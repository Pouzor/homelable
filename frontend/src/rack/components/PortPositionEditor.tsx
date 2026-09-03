/**
 * The device's faceplate, blown up — a preview, and the surface its ports are
 * placed on.
 *
 * The plate keeps true rack proportions (the canvas' width-to-U ratio, scaled
 * up), so a port dropped here lands where the user expects it on the rack. Both
 * axes scale together for the same reason: stretching one would move the ports
 * relative to the artwork they sit on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Faceplate } from './Faceplate'
import { INNER_WIDTH_PX, U_PX } from '../layout'
import { clampPort, snapThreshold, snapToPeers } from '../portLayout'
import { useRackPalette } from '../rackTheme'
import { RACK_COLUMNS, type DeviceStatus, type Port } from '@/types'

/** Default width of a full-width (12-column) plate in the editor. */
const EDITOR_FULL_WIDTH = 660

/**
 * A 1U plate is ~35px tall at that scale — a thin strip to aim a port at. A narrow
 * plate (a third-width mini node, the worst case for port placement) is scaled
 * up further until it reaches this height, never past the width a full-width
 * plate already gets.
 */
const MIN_PLATE_PX = 90

/** Nudge per arrow-key press, in unit coordinates. */
const NUDGE_STEP = 0.01

const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

interface Props {
  faceplateId: string
  label: string
  status: DeviceStatus
  ports: Port[]
  uHeight: number
  colSpan: number
  color?: string
  /**
   * Width a full-width (12-column) plate is drawn at; a narrower plate takes
   * its fraction of it. Left out, the editor measures the space it was given
   * and fills it — a plate that renders at a third of the panel is one nobody
   * can aim a port at.
   */
  fullWidth?: number
  /**
   * Drag mode. Off, the plate is a plain preview — no handles, no guides,
   * nothing to grab.
   */
  interactive: boolean
  /** Highlighted port, kept in step with the port list beside it. */
  selectedPortId: string | null
  onSelect: (portId: string | null) => void
  onChange: (ports: Port[]) => void
}

export function PortPositionEditor({
  faceplateId,
  label,
  status,
  ports,
  uHeight,
  colSpan,
  color,
  fullWidth,
  interactive,
  selectedPortId,
  onSelect,
  onChange,
}: Props) {
  const palette = useRackPalette()
  const plateRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })

  // The width a full-width plate gets: whatever the caller pinned, else the
  // room this editor was actually given, else the pre-measurement default.
  const stageWidth = fullWidth ?? measured ?? EDITOR_FULL_WIDTH
  // Editor pixels per canvas pixel, before the small-plate blow-up below.
  const scale = stageWidth / INNER_WIDTH_PX['19']
  const width = (stageWidth * colSpan) / RACK_COLUMNS
  const height = uHeight * U_PX * scale
  const zoom = Math.min(stageWidth / width, Math.max(1, MIN_PLATE_PX / height))
  const plateW = width * zoom
  const plateH = height * zoom

  const moveTo = useCallback(
    (portId: string, clientX: number, clientY: number) => {
      const box = plateRef.current?.getBoundingClientRect()
      if (!box || box.width === 0 || box.height === 0) return
      const snapped = snapToPeers(
        { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height },
        ports.filter((p) => p.id !== portId),
        snapThreshold(box.width, box.height),
      )
      setGuides({ x: snapped.guideX, y: snapped.guideY })
      onChange(ports.map((p) => (p.id === portId ? { ...p, x: snapped.x, y: snapped.y } : p)))
    },
    [onChange, ports],
  )

  const endDrag = useCallback(() => {
    setDragging(null)
    setGuides({ x: null, y: null })
  }, [])

  /** A pointer cannot land a port on an exact fraction; the arrow keys can. */
  const nudge = useCallback(
    (portId: string, dx: number, dy: number) =>
      onChange(
        ports.map((p) =>
          p.id === portId
            ? { ...p, ...clampPort({ x: p.x + dx * NUDGE_STEP, y: p.y + dy * NUDGE_STEP }) }
            : p,
        ),
      ),
    [onChange, ports],
  )

  /**
   * Arrow keys move the selected port for as long as placement mode is on —
   * the handle does not have to hold focus.
   *
   * Selecting a port by clicking its row in the list, then reaching for the
   * arrows, was the obvious gesture and did nothing: focus was still in the
   * name field. Typing in a text field keeps its own arrow behaviour, so the
   * listener steps aside for one.
   */
  /**
   * Fill the space the parent gave us. jsdom reports 0 and has no
   * `ResizeObserver`, so both paths fall back to the default width rather than
   * collapsing the plate to nothing.
   */
  useEffect(() => {
    if (fullWidth !== undefined) return
    const measure = () => {
      const w = stageRef.current?.clientWidth ?? 0
      if (w > 0) setMeasured(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    if (stageRef.current) observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [fullWidth])

  useEffect(() => {
    if (!interactive || !selectedPortId) return
    const onKeyDown = (e: KeyboardEvent) => {
      const step = ARROW_STEPS[e.key]
      if (!step) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      e.preventDefault()
      nudge(selectedPortId, step[0], step[1])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [interactive, selectedPortId, nudge])

  return (
    <div ref={stageRef} className="flex w-full flex-col items-center gap-2">
      <div
        ref={plateRef}
        data-testid="faceplate-stage"
        className="relative touch-none select-none"
        style={{ width: plateW, height: plateH }}
        onPointerMove={(e) => {
          if (interactive && dragging) moveTo(dragging, e.clientX, e.clientY)
        }}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <Faceplate
          faceplateId={faceplateId}
          label={label}
          status={status}
          ports={ports}
          width={plateW}
          height={plateH}
          colorOverride={color}
          portScale={zoom * scale}
          revealed
        />

        {/* Alignment guides — drawn only while a drag is actually snapped. */}
        {guides.x !== null && (
          <div
            className="pointer-events-none absolute top-0 h-full w-px"
            style={{ left: `${guides.x * 100}%`, background: palette.accent, opacity: 0.7 }}
          />
        )}
        {guides.y !== null && (
          <div
            className="pointer-events-none absolute left-0 h-px w-full"
            style={{ top: `${guides.y * 100}%`, background: palette.accent, opacity: 0.7 }}
          />
        )}

        {/* Grab handles ride above the drawn sockets: the artwork is too small to
            aim at, and a handle can take focus and wear a name, which an SVG
            socket cannot. */}
        {interactive &&
          ports.map((port) => {
            const selected = selectedPortId === port.id
            return (
              <button
                key={port.id}
                type="button"
                aria-label={`Move port ${port.label}`}
                data-port-handle={port.id}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border text-[8px] active:cursor-grabbing"
                style={{
                  left: `${port.x * 100}%`,
                  top: `${port.y * 100}%`,
                  borderColor: selected ? palette.accent : 'rgba(255,255,255,0.35)',
                  background: selected ? 'rgba(0,212,255,0.18)' : 'rgba(13,17,23,0.35)',
                }}
                onPointerDown={(e) => {
                  // Keep the press off the plate: it would start an HTML5 drag.
                  e.preventDefault()
                  onSelect(port.id)
                  setDragging(port.id)
                }}
              >
                <span className="pointer-events-none max-w-[22px] truncate text-white/80">
                  {port.label}
                </span>
              </button>
            )
          })}
      </div>

      {interactive && (
        <p className="text-[11px] text-muted-foreground">
          Drag a port to place it, or nudge the selected one with the arrow keys. Ports snap to the
          row or column of their neighbours.
        </p>
      )}
    </div>
  )
}
