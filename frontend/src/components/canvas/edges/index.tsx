import { useCallback } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'
import type { EdgeData, EdgeType, Waypoint } from '@/types'
import { useThemeStore } from '@/stores/themeStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { THEMES } from '@/utils/themes'
<<<<<<< HEAD
import { buildWaypointPath, getAddWaypointHandlePosition, getWaypointLabelPosition, snap45, snap45both } from './waypointUtils'
=======
import { buildWaypointPath, getWaypointLabelPosition, snap45, snap45both } from './waypointUtils'
>>>>>>> 431fb47 (bug: fixed an issue with the label and a bezier path with multiple points)

const VLAN_COLORS = ['#00d4ff', '#a855f7', '#39d353', '#ff6e00', '#e3b341', '#f85149']

function getVlanColor(vlanId?: number): string {
  if (!vlanId) return '#00d4ff'
  return VLAN_COLORS[vlanId % VLAN_COLORS.length]
}

// ── Waypoint drag handle ─────────────────────────────────────────────────────

interface WaypointHandleProps {
  edgeId: string
  index: number
  waypoint: Waypoint
  waypoints: Waypoint[]
  color: string
  pathStyle?: string
  prevPoint: Waypoint
  nextPoint: Waypoint
}

function WaypointHandle({ edgeId, index, waypoint, waypoints, color, pathStyle, prevPoint, nextPoint }: WaypointHandleProps) {
  const { screenToFlowPosition } = useReactFlow()
  const updateEdge = useCanvasStore((s) => s.updateEdge)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons !== 1) return
    let pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (pathStyle === 'smooth') {
      // Find the intersection of 45°-rays from both adjacent points so that
      // ALL segments (prev→this and this→next) snap to 45° simultaneously.
      pos = snap45both(prevPoint, nextPoint, pos)
    }
    const next = [...waypoints]
    next[index] = pos
    updateEdge(edgeId, { waypoints: next })
  }, [screenToFlowPosition, waypoints, index, edgeId, updateEdge, pathStyle, prevPoint, nextPoint])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    updateEdge(edgeId, { waypoints: waypoints.filter((_, i) => i !== index) })
  }, [edgeId, waypoints, index, updateEdge])

  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${waypoint.x}px, ${waypoint.y}px)`,
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        border: '2px solid #0d1117',
        cursor: 'grab',
        pointerEvents: 'all',
        zIndex: 10,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      title="Drag to move · Double-click to remove"
    />
  )
}

// ── Add waypoint handle (+ button at segment midpoints) ──────────────────────

interface AddWaypointHandleProps {
  edgeId: string
  insertIndex: number
  x: number
  y: number
  waypoints: Waypoint[]
  color: string
  pathStyle?: string
  prevPoint: Waypoint
}

function AddWaypointHandle({ edgeId, insertIndex, x, y, waypoints, color, pathStyle, prevPoint }: AddWaypointHandleProps) {
  const updateEdge = useCanvasStore((s) => s.updateEdge)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    let pos = { x, y }
    if (pathStyle === 'smooth') pos = snap45(prevPoint, pos)
    const next = [...waypoints.slice(0, insertIndex), pos, ...waypoints.slice(insertIndex)]
    updateEdge(edgeId, { waypoints: next })
  }, [edgeId, insertIndex, x, y, waypoints, updateEdge, pathStyle, prevPoint])

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#0d1117',
        border: `1.5px solid ${color}`,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        lineHeight: 1,
        cursor: 'crosshair',
        pointerEvents: 'all',
        zIndex: 9,
        opacity: 0.7,
      }}
      title="Click to add waypoint"
    >
      +
    </div>
  )
}

// ── Segment midpoints ────────────────────────────────────────────────────────

/**
 * Compute + handle positions for each path segment.
 * For smooth style: bias the first + handle to the source handle axis and the
 * last + handle to the target handle axis, so clicking always gives a clean
 * perpendicular exit/entry (no diagonal guesswork near the nodes).
 */
function segmentMidpoints(
  sourceX: number, sourceY: number,
  waypoints: Waypoint[],
  targetX: number, targetY: number,
  pathStyle?: string,
  sourcePosition?: string,
): { x: number; y: number; insertIndex: number }[] {
  const pts = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
  const isSmooth = pathStyle === 'smooth'

  return pts.slice(0, -1).map((a, i) => {
    const base = getAddWaypointHandlePosition(sourceX, sourceY, waypoints, targetX, targetY, i, pathStyle)
    let mx = base.x
    const my = base.y

    // For smooth style with no existing waypoints, bias the single + handle onto
    // the source handle axis so clicking it creates a perpendicular exit.
    // Only applies to bottom/top handles (vertical exits) and only when the edge
    // has no waypoints yet — once waypoints exist, all + handles stay at the
    // real segment midpoint so they remain visually on the edge.
    if (isSmooth && i === 0 && pts.length === 2) {
      const vertSrc = sourcePosition === 'bottom' || sourcePosition === 'top'
      if (vertSrc) mx = a.x  // same X as source → + sits directly below/above node
    }

    return { x: mx, y: my, insertIndex: i }
  })
}

// ── Main edge component ──────────────────────────────────────────────────────

export function HomelableEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<EdgeData>>) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]
  const sourceType = useStore((s) => s.nodeLookup.get(source)?.type)
  const targetType = useStore((s) => s.nodeLookup.get(target)?.type)
  const isBidirectional = sourceType === 'proxmox' && targetType === 'proxmox'

  const waypoints: Waypoint[] = Array.isArray(data?.waypoints) && data.waypoints.length > 0
    ? data.waypoints as Waypoint[]
    : []

  const hasWaypoints = waypoints.length > 0

  const pathStyle = data?.path_style as string | undefined

  const pathArgs = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const [autoPath, labelX] = pathStyle === 'smooth'
    ? getSmoothStepPath({ ...pathArgs, borderRadius: 8 })
    : getBezierPath(pathArgs)

  const edgePath = hasWaypoints
    ? buildWaypointPath(sourceX, sourceY, waypoints, targetX, targetY, pathStyle)
    : autoPath

  const labelPosition = hasWaypoints
    ? getWaypointLabelPosition(sourceX, sourceY, waypoints, targetX, targetY, pathStyle)
    : { x: labelX, y: (sourceY + targetY) / 2 }

  const edgeType: EdgeType = data?.type ?? 'ethernet'
  const edgeColors = theme.colors.edgeColors

  const BASE_STYLES: Record<EdgeType, React.CSSProperties> = {
    ethernet: { stroke: edgeColors.ethernet, strokeWidth: 2 },
    wifi:     { stroke: edgeColors.wifi,     strokeWidth: 1.5, strokeDasharray: '6 3' },
    iot:      { stroke: edgeColors.iot,      strokeWidth: 1.5, strokeDasharray: '2 4' },
    vlan:     { strokeWidth: 2.5 },
    virtual:  { stroke: edgeColors.virtual,  strokeWidth: 1,   strokeDasharray: '4 4' },
    cluster:  { stroke: edgeColors.cluster,  strokeWidth: 2.5, strokeDasharray: '8 3' },
  }

  const customColor = data?.custom_color as string | undefined
  const strokeColor: string = selected
    ? theme.colors.edgeSelectedColor
    : customColor
    ?? (edgeType === 'vlan' ? getVlanColor(data?.vlan_id as number | undefined) : (BASE_STYLES[edgeType].stroke as string ?? edgeColors.ethernet))

  const style: React.CSSProperties = {
    ...BASE_STYLES[edgeType],
    ...(edgeType === 'vlan' ? { stroke: getVlanColor(data?.vlan_id as number | undefined) } : {}),
    ...(customColor ? { stroke: customColor } : {}),
    ...(selected ? { stroke: theme.colors.edgeSelectedColor, filter: `drop-shadow(0 0 4px ${theme.colors.edgeSelectedColor}88)` } : {}),
  }

  const animMode: 'none' | 'snake' | 'flow' | 'basic' =
    data?.animated === true || data?.animated === 'snake' ? 'snake' :
    data?.animated === 'flow' ? 'flow' :
    data?.animated === 'basic' ? 'basic' : 'none'

  const animColor = customColor ?? (edgeType === 'vlan' ? getVlanColor(data?.vlan_id as number | undefined) : edgeColors[edgeType as keyof typeof edgeColors] as string)

  const midpoints = selected
    ? segmentMidpoints(sourceX, sourceY, waypoints, targetX, targetY, pathStyle, sourcePosition)
    : []

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={animMode === 'basic' ? { ...style, stroke: 'transparent' } : style} interactionWidth={16} />

      {animMode === 'basic' && (
        <path
          d={edgePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={style.strokeWidth as number ?? 2}
          strokeDasharray="5"
          style={{
            pointerEvents: 'none',
            animation: 'homelable-basic-dash 0.5s linear infinite',
            animationDirection: sourceY <= targetY ? 'normal' : 'reverse',
          }}
        />
      )}

      {animMode === 'snake' && (
        <path
          d={edgePath}
          fill="none"
          stroke={animColor}
          strokeWidth={((style.strokeWidth as number ?? 2) + 1.5) * 2}
          strokeDasharray="20 10000"
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        >
          {isBidirectional ? (
            <animate attributeName="stroke-dashoffset" values="-10000;0;-10000" keyTimes="0;0.5;1" dur="20s" repeatCount="indefinite" />
          ) : (
            <animate attributeName="stroke-dashoffset" from="-10000" to="0" dur="10s" repeatCount="indefinite" />
          )}
        </path>
      )}
      {animMode === 'flow' && (
        <path
          d={edgePath}
          fill="none"
          stroke={animColor}
          strokeWidth={Math.max(3, (style.strokeWidth as number ?? 2) * 1.8)}
          strokeDasharray="6 12"
          strokeLinecap="round"
          strokeOpacity={0.85}
          style={{ pointerEvents: 'none' }}
        >
          <animate attributeName="stroke-dashoffset" from="0" to="18" dur="1.2s" repeatCount="indefinite" />
        </path>
      )}

      <EdgeLabelRenderer>
        {data?.label && (
          <div
            className="absolute pointer-events-none font-mono text-[10px] px-1.5 py-0.5 rounded"
            style={{
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
              background: theme.colors.edgeLabelBackground,
              color:      theme.colors.edgeLabelColor,
              border:     `1px solid ${theme.colors.edgeLabelBorder}`,
            }}
          >
            {data.label as string}
          </div>
        )}

        {/* Existing waypoint drag handles */}
        {selected && waypoints.map((wp, idx) => {
          const prevPoint = idx === 0 ? { x: sourceX, y: sourceY } : waypoints[idx - 1]
          const nextPoint = idx === waypoints.length - 1 ? { x: targetX, y: targetY } : waypoints[idx + 1]
          return (
            <WaypointHandle
              key={`wp-${idx}`}
              edgeId={id}
              index={idx}
              waypoint={wp}
              waypoints={waypoints}
              color={strokeColor}
              pathStyle={pathStyle}
              prevPoint={prevPoint}
              nextPoint={nextPoint}
            />
          )
        })}

        {/* + handles at segment midpoints to add new waypoints */}
        {selected && midpoints.map((mp) => {
          const prevPoint = mp.insertIndex === 0
            ? { x: sourceX, y: sourceY }
            : waypoints[mp.insertIndex - 1]
          return (
            <AddWaypointHandle
              key={`add-${mp.insertIndex}`}
              edgeId={id}
              insertIndex={mp.insertIndex}
              x={mp.x}
              y={mp.y}
              waypoints={waypoints}
              color={strokeColor}
              pathStyle={pathStyle}
              prevPoint={prevPoint}
            />
          )
        })}
      </EdgeLabelRenderer>
    </>
  )
}
