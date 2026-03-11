import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react'
import type { EdgeData, EdgeType } from '@/types'
import { useThemeStore } from '@/stores/themeStore'
import { THEMES } from '@/utils/themes'

const VLAN_COLORS = ['#00d4ff', '#a855f7', '#39d353', '#ff6e00', '#e3b341', '#f85149']

function getVlanColor(vlanId?: number): string {
  if (!vlanId) return '#00d4ff'
  return VLAN_COLORS[vlanId % VLAN_COLORS.length]
}

export function HomelableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<Edge<EdgeData>>) {
  const activeTheme = useThemeStore((s) => s.activeTheme)
  const theme = THEMES[activeTheme]

  const pathArgs = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const [edgePath, labelX, labelY] = data?.path_style === 'smooth'
    ? getSmoothStepPath({ ...pathArgs, borderRadius: 8 })
    : getBezierPath(pathArgs)

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
  const style: React.CSSProperties = {
    ...BASE_STYLES[edgeType],
    ...(edgeType === 'vlan' ? { stroke: getVlanColor(data?.vlan_id as number | undefined) } : {}),
    ...(customColor ? { stroke: customColor } : {}),
    ...(selected ? { stroke: theme.colors.edgeSelectedColor, filter: `drop-shadow(0 0 4px ${theme.colors.edgeSelectedColor}88)` } : {}),
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none font-mono text-[10px] px-1 rounded"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: theme.colors.edgeLabelBackground,
              color:      theme.colors.edgeLabelColor,
              border:     `1px solid ${theme.colors.edgeLabelBorder}`,
            }}
          >
            {data.label as string}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
