import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import { useCanvasStore } from '@/stores/canvasStore'
import { resolveServerPath } from '@/utils/basePath'

interface ResizeState {
  startMouseX: number
  startMouseY: number
  startX: number
  startY: number
  startW: number
  startH: number
  edges: Set<'n' | 's' | 'e' | 'w'>
}

/**
 * Floor plan background rendered INSIDE the React Flow viewport (via
 * ViewportPortal) so it pans and zooms together with the nodes. Position and
 * size are stored in flow coordinates.
 *
 * It always sits at the bottom of the canvas (behind nodes and edges). When
 * unlocked it can still be grabbed/resized in areas not covered by a node;
 * resize handles appear only while it is selected. Double-clicking an unlocked
 * plan opens its edit modal.
 */
export function FloorMapLayer() {
  const floorMap = useCanvasStore((s) => s.floorMap)
  const updateFloorMap = useCanvasStore((s) => s.updateFloorMap)
  const requestFloorMapEdit = useCanvasStore((s) => s.requestFloorMapEdit)
  const { screenToFlowPosition } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])

  const resizeRef = useRef<ResizeState | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(false)

  const locked = floorMap?.locked ?? false

  // While selected (and unlocked), deselect on any click outside the plan.
  // A locked plan can't be selected, and handles/edit are gated on !locked, so
  // a residual selection is harmless.
  useEffect(() => {
    if (locked || !selected) return
    const onDocDown = (ev: MouseEvent) => {
      if (!wrapperRef.current?.contains(ev.target as Node)) setSelected(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [selected, locked])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!floorMap) return
    e.stopPropagation()
    setSelected(true)
    const startX = e.clientX
    const startY = e.clientY
    const origPosX = floorMap.posX
    const origPosY = floorMap.posY

    const onMove = (ev: MouseEvent) => {
      const start = screenToFlowPosition({ x: startX, y: startY })
      const cur = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      updateFloorMap({ posX: origPosX + (cur.x - start.x), posY: origPosY + (cur.y - start.y) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [floorMap, updateFloorMap, screenToFlowPosition])

  const onResizeStart = useCallback((e: React.MouseEvent, edges: Set<'n' | 's' | 'e' | 'w'>) => {
    if (!floorMap) return
    e.stopPropagation()
    resizeRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: floorMap.posX,
      startY: floorMap.posY,
      startW: floorMap.width,
      startH: floorMap.height,
      edges,
    }

    const onMove = (ev: MouseEvent) => {
      const rs = resizeRef.current
      if (!rs) return
      const start = screenToFlowPosition({ x: rs.startMouseX, y: rs.startMouseY })
      const cur = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      const dx = cur.x - start.x
      const dy = cur.y - start.y
      let x = rs.startX, y = rs.startY, w = rs.startW, h = rs.startH
      if (rs.edges.has('w')) { x += dx; w -= dx }
      if (rs.edges.has('e')) w += dx
      if (rs.edges.has('n')) { y += dy; h -= dy }
      if (rs.edges.has('s')) h += dy
      const MIN = 80
      if (w < MIN) {
        if (rs.edges.has('w')) x = rs.startX + rs.startW - MIN
        w = MIN
      }
      if (h < MIN) {
        if (rs.edges.has('n')) y = rs.startY + rs.startH - MIN
        h = MIN
      }
      updateFloorMap({ posX: x, posY: y, width: w, height: h })
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [floorMap, updateFloorMap, screenToFlowPosition])

  if (!floorMap || !floorMap.enabled) return null

  const { imageData, posX, posY, width, height, opacity } = floorMap

  // Handles live in flow space, so counter-scale by zoom to keep a ~constant
  // on-screen size regardless of the current zoom level.
  const hsz = 10 / zoom
  const half = hsz / 2
  const hs: React.CSSProperties = {
    position: 'absolute',
    width: hsz,
    height: hsz,
    background: '#00d4ff',
    border: `${2 / zoom}px solid #0d1117`,
    borderRadius: 2 / zoom,
    zIndex: 10,
  }

  return (
    <ViewportPortal>
      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          left: posX,
          top: posY,
          width,
          height,
          opacity,
          // Always at the bottom of the canvas, behind nodes and edges.
          zIndex: -1,
          pointerEvents: locked ? 'none' : 'auto',
          cursor: locked ? 'default' : 'move',
        }}
        onMouseDown={locked ? undefined : onDragStart}
        onDoubleClick={locked ? undefined : (e) => { e.stopPropagation(); requestFloorMapEdit() }}
      >
        <img
          src={resolveServerPath(imageData)}
          alt="Floor plan"
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
        {!locked && selected && (
          <>
            <div style={{ ...hs, cursor: 'nw-resize', top: -half, left: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['n','w']))} />
            <div style={{ ...hs, cursor: 'n-resize', top: -half, left: '50%', marginLeft: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['n']))} />
            <div style={{ ...hs, cursor: 'ne-resize', top: -half, right: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['n','e']))} />
            <div style={{ ...hs, cursor: 'e-resize', top: '50%', marginTop: -half, right: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['e']))} />
            <div style={{ ...hs, cursor: 'se-resize', bottom: -half, right: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['s','e']))} />
            <div style={{ ...hs, cursor: 's-resize', bottom: -half, left: '50%', marginLeft: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['s']))} />
            <div style={{ ...hs, cursor: 'sw-resize', bottom: -half, left: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['s','w']))} />
            <div style={{ ...hs, cursor: 'w-resize', top: '50%', marginTop: -half, left: -half }} onMouseDown={(e) => onResizeStart(e, new Set(['w']))} />
          </>
        )}
      </div>
    </ViewportPortal>
  )
}
