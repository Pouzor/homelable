import { useViewport } from '@xyflow/react'
import type { Guide } from '@/utils/alignment'

interface AlignmentGuidesProps {
  guides: Guide[]
  color?: string
}

/**
 * SVG overlay that draws alignment guide lines on top of the React Flow canvas.
 * Coordinates are in canvas (flow) space; we read the viewport transform to
 * project them into screen space so lines stay locked to nodes when the user
 * pans or zooms.
 */
export function AlignmentGuides({ guides, color = '#00d4ff' }: AlignmentGuidesProps) {
  const { x: vx, y: vy, zoom } = useViewport()

  if (guides.length === 0) return null

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
    >
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          const x = g.position * zoom + vx
          const y1 = g.start * zoom + vy
          const y2 = g.end * zoom + vy
          return (
            <line
              key={`x-${i}-${g.position}`}
              x1={x}
              y1={y1}
              x2={x}
              y2={y2}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="4 3"
              shapeRendering="crispEdges"
            />
          )
        }
        const y = g.position * zoom + vy
        const x1 = g.start * zoom + vx
        const x2 = g.end * zoom + vx
        return (
          <line
            key={`y-${i}-${g.position}`}
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="4 3"
            shapeRendering="crispEdges"
          />
        )
      })}
    </svg>
  )
}
