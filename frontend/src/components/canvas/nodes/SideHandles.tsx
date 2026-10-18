import type { CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeData } from '@/types'
import {
  SIDES,
  handleId,
  handlePositions,
  isVerticalSide,
  sideHandleCount,
  type Side,
} from '@/utils/handleUtils'

const POSITION: Record<Side, Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
}

interface SideHandlesProps {
  data: NodeData
  handleBackground: string
  handleBorder: string
  /** Colour for the optional port-number labels. */
  labelColor: string
  /** Which sides to render. Defaults to all four. */
  sides?: readonly Side[]
  /**
   * When true, render port-number labels if data.show_port_numbers is set: the
   * point's data.port_labels entry, else its 1-based slot on the side.
   */
  showLabels?: boolean
}

/**
 * Renders the per-side React Flow handles (visible source + invisible target)
 * for a node, spaced along each side's axis. Shared by BaseNode and the
 * container-mode ProxmoxGroupNode so handle IDs stay identical across both.
 */
export function SideHandles({
  data,
  handleBackground,
  handleBorder,
  labelColor,
  sides = SIDES,
  showLabels = false,
}: SideHandlesProps) {
  return (
    <>
      {sides.map((side) => {
        const vertical = isVerticalSide(side)
        return handlePositions(side, sideHandleCount(data, side)).map((pct, idx) => {
          const sourceId = handleId(side, idx)
          const targetId = `${sourceId}-t`
          const offset: CSSProperties = vertical ? { top: `${pct}%` } : { left: `${pct}%` }
          const labelStyle: CSSProperties = vertical
            ? { top: `${pct}%`, [side]: 3, transform: 'translateY(-50%)' }
            : { left: `${pct}%`, [side]: 3, transform: 'translateX(-50%)' }
          return (
            <span key={sourceId}>
              {showLabels && data.show_port_numbers && (
                <span
                  className="absolute font-mono leading-none pointer-events-none select-none"
                  style={{ ...labelStyle, fontSize: 7, color: labelColor }}
                >
                  {data.port_labels?.[sourceId] ?? idx + 1}
                </span>
              )}
              <Handle
                type="source"
                position={POSITION[side]}
                id={sourceId}
                style={{ ...offset, background: handleBackground, borderColor: handleBorder }}
              />
              <Handle
                type="target"
                position={POSITION[side]}
                id={targetId}
                style={{ ...offset, opacity: 0, width: 20, height: 20 }}
              />
            </span>
          )
        })
      })}
    </>
  )
}
