/**
 * Draws a device front panel from its template.
 *
 * Layout is pixel-based on purpose: the status LED, the name band and the port
 * artwork all keep a fixed size whatever the U height, so plates of different
 * heights line up with each other instead of scaling apart.
 */
import { memo, useId } from 'react'
import { getFaceplate } from '../faceplates'
import type { DeviceStatus, FaceplateElement, Port, PortType } from '../types'

const STATUS_COLOR: Record<DeviceStatus, string> = {
  online: '#39d353',
  offline: '#f85149',
  unknown: '#8b949e',
}

/** Unpatched port artwork — a dark recess with a metal bezel. */
const PORT_BEZEL = '#5b6673'
const PORT_RECESS = '#0b0e13'

const LED_X = 9
const LED_R = 3

interface PortShapeSize {
  w: number
  h: number
}

/** Fixed-ish port artwork, nudged by plate height so 1U panels stay legible. */
function portShapeSize(size: 'sm' | 'md', height: number, type: PortType): PortShapeSize {
  const w =
    size === 'sm'
      ? Math.max(5, Math.min(8, height * 0.3))
      : Math.max(7, Math.min(12, height * 0.42))
  return type === 'rj45' ? { w, h: w * 0.92 } : { w: w * 1.15, h: w * 0.62 }
}

/** RJ45 silhouette: body with the latch slot cut into the top, centred on (0,0). */
function rj45Path(w: number, h: number): string {
  const left = -w / 2
  const top = -h / 2
  const notchW = w * 0.4
  const notchH = h * 0.4
  const shoulder = (w - notchW) / 2
  return [
    `M ${left} ${top + notchH}`,
    `h ${shoulder}`,
    `v ${-notchH}`,
    `h ${notchW}`,
    `v ${notchH}`,
    `h ${shoulder}`,
    `v ${h - notchH}`,
    `h ${-w}`,
    `Z`,
  ].join(' ')
}

function drawElement(el: FaceplateElement, i: number, w: number, h: number) {
  switch (el.kind) {
    case 'panel':
      return null // drawn by the caller as the plate background
    case 'vents': {
      const cellW = (el.w * w) / el.cols
      const cellH = (el.h * h) / el.rows
      const cells = []
      for (let r = 0; r < el.rows; r++) {
        for (let c = 0; c < el.cols; c++) {
          cells.push(
            <rect
              key={`${i}-${r}-${c}`}
              x={el.x * w + c * cellW + cellW * 0.15}
              y={el.y * h + r * cellH + cellH * 0.15}
              width={Math.max(1, cellW * 0.7)}
              height={Math.max(1, cellH * 0.7)}
              rx={1}
              fill={el.fill ?? '#141922'}
            />,
          )
        }
      }
      return <g key={i}>{cells}</g>
    }
    case 'bays': {
      const cellW = (el.w * w) / el.cols
      const cellH = (el.h * h) / el.rows
      const cells = []
      for (let r = 0; r < el.rows; r++) {
        for (let c = 0; c < el.cols; c++) {
          cells.push(
            <rect
              key={`${i}-${r}-${c}`}
              x={el.x * w + c * cellW + 1}
              y={el.y * h + r * cellH + 1}
              width={Math.max(2, cellW - 2)}
              height={Math.max(2, cellH - 2)}
              rx={1.5}
              fill={el.fill ?? '#1b1f26'}
              stroke="#0d1117"
              strokeWidth={0.5}
            />,
          )
        }
      }
      return <g key={i}>{cells}</g>
    }
    case 'strip':
      return (
        <rect
          key={i}
          x={el.x * w}
          y={el.y * h}
          width={el.w * w}
          height={el.h * h}
          rx={2}
          fill={el.fill}
        />
      )
    case 'outlets': {
      // C13-style outlets: artwork only, never a cable endpoint.
      const slotW = (el.w * w) / el.count
      const outletW = Math.min(slotW * 0.72, el.h * h * 0.9)
      const outletH = Math.min(el.h * h, outletW * 0.85)
      const cy = el.y * h + (el.h * h) / 2
      return (
        <g key={i}>
          {Array.from({ length: el.count }, (_, n) => {
            const cx = el.x * w + slotW * (n + 0.5)
            const pinW = Math.max(0.8, outletW * 0.12)
            const pinH = Math.max(1, outletH * 0.3)
            return (
              <g key={n}>
                <rect
                  x={cx - outletW / 2}
                  y={cy - outletH / 2}
                  width={outletW}
                  height={outletH}
                  rx={1.5}
                  fill="#0b0e13"
                  stroke="#4b535e"
                  strokeWidth={0.8}
                />
                <rect x={cx - outletW * 0.26 - pinW / 2} y={cy - pinH / 2} width={pinW} height={pinH} fill="#4b535e" />
                <rect x={cx - pinW / 2} y={cy - pinH / 2} width={pinW} height={pinH} fill="#4b535e" />
                <rect x={cx + outletW * 0.26 - pinW / 2} y={cy - pinH / 2} width={pinW} height={pinH} fill="#4b535e" />
              </g>
            )
          })}
        </g>
      )
    }
  }
}

interface Props {
  faceplateId: string
  label: string
  status: DeviceStatus
  ports: Port[]
  /** Rendered size in canvas pixels. */
  width: number
  height: number
  colorOverride?: string
  selected?: boolean
  /** Hover or selection: reveals the ports of non-patch gear. */
  revealed?: boolean
  /** Fade the plate so cables behind it stay readable. */
  transparent?: boolean
  /** Ports are clickable (patch mode). */
  interactivePorts?: boolean
  /** Port id -> colour of the cable plugged into it. */
  patchedPorts?: Map<string, string>
  draftPortId?: string | null
  onPortClick?: (portId: string) => void
}

export const Faceplate = memo(function Faceplate({
  faceplateId,
  label,
  status,
  ports,
  width,
  height,
  colorOverride,
  selected,
  revealed,
  transparent,
  interactivePorts,
  patchedPorts,
  draftPortId,
  onPortClick,
}: Props) {
  const template = getFaceplate(faceplateId)
  const clipId = useId()
  const panel = template.elements.find((e) => e.kind === 'panel')
  const fill = colorOverride ?? (panel?.kind === 'panel' ? panel.fill : '#2b323c')

  const showPorts = template.alwaysShowPorts || revealed || interactivePorts

  const labelX = template.labelBox.x * width
  const labelW = template.labelBox.w * width
  const fontSize = Math.max(8, Math.min(11, height * 0.42))
  const showLabel = labelW > 24 && height >= 14

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ opacity: transparent ? 0.4 : 1, display: 'block' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={labelX} y={0} width={labelW} height={height} />
        </clipPath>
      </defs>

      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={2}
        fill={fill}
        stroke={selected ? '#00d4ff' : '#0d1117'}
        strokeWidth={selected ? 1.5 : 1}
      />

      {/* Mounting ears */}
      <rect x={1.5} y={height * 0.3} width={2.5} height={height * 0.4} rx={1} fill="#0d1117" opacity={0.55} />
      <rect x={width - 4} y={height * 0.3} width={2.5} height={height * 0.4} rx={1} fill="#0d1117" opacity={0.55} />

      {template.elements.map((el, i) => drawElement(el, i, width, height))}

      {template.statusLed && (
        <circle cx={LED_X} cy={height / 2} r={LED_R} fill={STATUS_COLOR[status]} />
      )}

      {showLabel && (
        <text
          x={labelX}
          y={height / 2}
          clipPath={`url(#${clipId})`}
          fontSize={fontSize}
          fill="#c9d1d9"
          dominantBaseline="central"
          textAnchor="start"
          fontFamily="Inter, system-ui, sans-serif"
        >
          {label}
        </text>
      )}

      {showPorts &&
        ports.map((port) => {
          const cx = port.x * width
          const cy = port.y * height
          const patchColor = patchedPorts?.get(port.id)
          const isDraft = draftPortId === port.id
          const { w, h } = portShapeSize(template.portSize ?? 'md', height, port.type)
          const stroke = isDraft ? '#00d4ff' : patchColor ?? PORT_BEZEL

          return (
            <g
              key={port.id}
              transform={`translate(${cx} ${cy})`}
              style={{
                cursor: interactivePorts ? 'crosshair' : undefined,
                pointerEvents: interactivePorts ? 'auto' : 'none',
              }}
              onClick={
                interactivePorts
                  ? (e) => {
                      e.stopPropagation()
                      onPortClick?.(port.id)
                    }
                  : undefined
              }
            >
              {port.type === 'rj45' ? (
                <path
                  d={rj45Path(w, h)}
                  fill={PORT_RECESS}
                  stroke={stroke}
                  strokeWidth={isDraft ? 1.4 : 0.9}
                  strokeLinejoin="round"
                />
              ) : (
                <>
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={1}
                    fill={PORT_RECESS}
                    stroke={stroke}
                    strokeWidth={isDraft ? 1.4 : 0.9}
                  />
                  <rect
                    x={-w / 2 + w * 0.18}
                    y={-h / 2 + h * 0.3}
                    width={w * 0.64}
                    height={Math.max(0.8, h * 0.22)}
                    fill={stroke}
                    opacity={0.65}
                  />
                </>
              )}
              <title>{`${port.label} · ${port.type}`}</title>
            </g>
          )
        })}
    </svg>
  )
})
