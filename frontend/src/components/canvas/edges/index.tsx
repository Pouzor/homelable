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
import { Pencil, Plus, RouteOff } from 'lucide-react'
import type { EdgeData, EdgeType, Waypoint } from '@/types'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'
import { useCanvasStore } from '@/stores/canvasStore'

const VLAN_COLORS = ['#00d4ff', '#a855f7', '#39d353', '#ff6e00', '#e3b341', '#f85149']

function getVlanColor(vlanId?: number): string {
  if (!vlanId) return '#00d4ff'
  return VLAN_COLORS[vlanId % VLAN_COLORS.length]
}

function buildOrthogonalPoints(points: Waypoint[]): Waypoint[] {
  if (points.length < 2) return points
  const orthogonal: Waypoint[] = [points[0]]
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index]
    const previous = orthogonal[orthogonal.length - 1]
    if (previous.x === next.x || previous.y === next.y) {
      orthogonal.push(next)
      continue
    }
    const beforePrevious = orthogonal.length > 1 ? orthogonal[orthogonal.length - 2] : null
    const previousWasHorizontal = beforePrevious
      ? beforePrevious.y === previous.y
      : Math.abs(next.x - previous.x) >= Math.abs(next.y - previous.y)
    const elbow = previousWasHorizontal
      ? { x: previous.x, y: next.y }
      : { x: next.x, y: previous.y }
    orthogonal.push(elbow, next)
  }
  return orthogonal
}

function buildWaypointPath(points: Waypoint[], smooth: boolean): string {
  if (points.length < 2) return ''
  if (!smooth) {
    return `M ${points[0].x},${points[0].y} ` + points.slice(1).map((p) => `L ${p.x},${p.y}`).join(' ')
  }
  const orthogonalPoints = buildOrthogonalPoints(points)
  return `M ${orthogonalPoints[0].x},${orthogonalPoints[0].y} ` + orthogonalPoints.slice(1).map((p) => `L ${p.x},${p.y}`).join(' ')
}

export function HomelableEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<EdgeData>>) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]
  const { screenToFlowPosition } = useReactFlow()
  const updateEdge = useCanvasStore((s) => s.updateEdge)
  const snapshotHistory = useCanvasStore((s) => s.snapshotHistory)
  const sourceType = useStore((s) => s.nodeLookup.get(source)?.type)
  const targetType = useStore((s) => s.nodeLookup.get(target)?.type)
  const isBidirectional = sourceType === 'proxmox' && targetType === 'proxmox'
  const waypoints = (data?.waypoints ?? []) as Waypoint[]
  const points: Waypoint[] = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]

  const pathArgs = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const [fallbackPath, fallbackLabelX, fallbackLabelY] = data?.path_style === 'smooth'
    ? getSmoothStepPath({ ...pathArgs, borderRadius: 8 })
    : getBezierPath(pathArgs)
  const edgePath = waypoints.length > 0
    ? buildWaypointPath(points, data?.path_style === 'smooth')
    : fallbackPath
  const waypointMidpoint = points[Math.floor(points.length / 2)]
  const labelX = waypointMidpoint?.x ?? fallbackLabelX
  const labelY = waypointMidpoint?.y ?? fallbackLabelY

  const edgeType: EdgeType = data?.type ?? 'ethernet'
  const edgeColors = theme.colors.edgeColors

  const BASE_STYLES: Record<EdgeType, React.CSSProperties> = {
    ethernet: { stroke: edgeColors.ethernet, strokeWidth: 2 },
    wifi: { stroke: edgeColors.wifi, strokeWidth: 1.5, strokeDasharray: '6 3' },
    iot: { stroke: edgeColors.iot, strokeWidth: 1.5, strokeDasharray: '2 4' },
    vlan: { strokeWidth: 2.5 },
    virtual: { stroke: edgeColors.virtual, strokeWidth: 1, strokeDasharray: '4 4' },
    cluster: { stroke: edgeColors.cluster, strokeWidth: 2.5, strokeDasharray: '8 3' },
  }

  const customColor = data?.custom_color as string | undefined
  const style: React.CSSProperties = {
    ...BASE_STYLES[edgeType],
    ...(edgeType === 'vlan' ? { stroke: getVlanColor(data?.vlan_id as number | undefined) } : {}),
    ...(customColor ? { stroke: customColor } : {}),
    ...(selected ? { stroke: theme.colors.edgeSelectedColor, filter: `drop-shadow(0 0 4px ${theme.colors.edgeSelectedColor}88)` } : {}),
  }

  const animMode: 'none' | 'snake' | 'flow' =
    data?.animated === true || data?.animated === 'snake' ? 'snake' :
    data?.animated === 'flow' ? 'flow' : 'none'

  const animColor = customColor ?? (
    edgeType === 'vlan'
      ? getVlanColor(data?.vlan_id as number | undefined)
      : edgeColors[edgeType as keyof typeof edgeColors] as string
  )

  const replaceWaypoint = (index: number, nextWaypoint: Waypoint) => {
    const next = [...waypoints]
    next[index] = nextWaypoint
    updateEdge(id, { waypoints: next })
  }

  const addWaypoint = () => {
    snapshotHistory()
    if (points.length < 2) return
    let segmentIndex = 0
    let longestDistance = -1
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index]
      const b = points[index + 1]
      const distance = Math.hypot(b.x - a.x, b.y - a.y)
      if (distance > longestDistance) {
        longestDistance = distance
        segmentIndex = index
      }
    }
    const start = points[segmentIndex]
    const end = points[segmentIndex + 1]
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
    const nextWaypoints = [...waypoints]
    nextWaypoints.splice(segmentIndex, 0, midpoint)
    updateEdge(id, { waypoints: nextWaypoints, path_style: 'smooth' })
  }

  const removeWaypoint = (index: number) => {
    snapshotHistory()
    updateEdge(id, { waypoints: waypoints.filter((_, waypointIndex) => waypointIndex !== index) })
  }

  const startDragWaypoint = (index: number, event: React.MouseEvent<SVGCircleElement>) => {
    event.stopPropagation()
    snapshotHistory()
    const move = (moveEvent: MouseEvent) => {
      const next = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY })
      replaceWaypoint(index, { x: next.x, y: next.y })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const clearWaypoints = () => {
    if (waypoints.length === 0) return
    snapshotHistory()
    updateEdge(id, { waypoints: [] })
  }

  const openEdgeEditor = () => {
    window.dispatchEvent(new CustomEvent('homelable:edit-edge', { detail: { edgeId: id } }))
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} />
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
      {selected && (
        <EdgeLabelRenderer>
          <div
            className="absolute flex items-center gap-1 rounded-md border px-1.5 py-1 pointer-events-auto"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 28}px)`,
              background: theme.colors.nodeCardBackground,
              borderColor: theme.colors.edgeLabelBorder,
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            }}
          >
            <button
              type="button"
              onClick={openEdgeEditor}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-foreground hover:bg-white/5"
            >
              <Pencil size={10} />
              Edit
            </button>
            <button
              type="button"
              onClick={addWaypoint}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-foreground hover:bg-white/5"
            >
              <Plus size={10} />
              Point
            </button>
            <button
              type="button"
              onClick={clearWaypoints}
              disabled={waypoints.length === 0}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-foreground hover:bg-white/5 disabled:opacity-40"
            >
              <RouteOff size={10} />
              Reset
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
      {selected && waypoints.map((waypoint, index) => (
        <g key={`${id}-waypoint-${index}`}>
          <circle
            cx={waypoint.x}
            cy={waypoint.y}
            r={6}
            fill={theme.colors.nodeCardBackground}
            stroke={animColor}
            strokeWidth={2}
            onMouseDown={(event) => startDragWaypoint(index, event)}
            onDoubleClick={() => removeWaypoint(index)}
            style={{ cursor: 'grab', pointerEvents: 'all' }}
          />
          <circle
            cx={waypoint.x + 9}
            cy={waypoint.y - 9}
            r={6}
            fill={theme.colors.nodeCardBackground}
            stroke={theme.colors.edgeLabelBorder}
            strokeWidth={1.5}
            onClick={(event) => {
              event.stopPropagation()
              removeWaypoint(index)
            }}
            style={{ cursor: 'pointer', pointerEvents: 'all' }}
          />
          <text
            x={waypoint.x + 9}
            y={waypoint.y - 5.5}
            textAnchor="middle"
            fontSize="10"
            fill={theme.colors.nodeLabelColor}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            x
          </text>
        </g>
      ))}

      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none font-mono text-[10px] px-1 rounded"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: theme.colors.edgeLabelBackground,
              color: theme.colors.edgeLabelColor,
              border: `1px solid ${theme.colors.edgeLabelBorder}`,
            }}
          >
            {data.label as string}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
