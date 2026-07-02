import { useCallback, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'

interface FloorMapLayerProps {
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }
}

interface ResizeState {
  startMouseX: number
  startMouseY: number
  startX: number
  startY: number
  startW: number
  startH: number
  edges: Set<'n' | 's' | 'e' | 'w'>
}

export function FloorMapLayer({ screenToFlowPosition }: FloorMapLayerProps) {
  const floorMap = useCanvasStore((s) => s.floorMap)
  const updateFloorMap = useCanvasStore((s) => s.updateFloorMap)

  const resizeRef = useRef<ResizeState | null>(null)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!floorMap) return
    e.stopPropagation()
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

  const { imageData, posX, posY, width, height, opacity, locked } = floorMap

  const hs: React.CSSProperties = {
    position: 'absolute',
    width: 10,
    height: 10,
    background: '#00d4ff',
    border: '2px solid #0d1117',
    borderRadius: 2,
    zIndex: 10,
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: posX,
        top: posY,
        width,
        height,
        opacity,
        zIndex: -1,
        pointerEvents: locked ? 'none' : 'auto',
        cursor: locked ? 'default' : 'move',
      }}
      onMouseDown={locked ? undefined : onDragStart}
    >
      <img
        src={imageData}
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
      {!locked && (
        <>
          <div style={{ ...hs, cursor: 'nw-resize', top: -5, left: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['n','w']))} />
          <div style={{ ...hs, cursor: 'n-resize', top: -5, left: '50%', marginLeft: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['n']))} />
          <div style={{ ...hs, cursor: 'ne-resize', top: -5, right: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['n','e']))} />
          <div style={{ ...hs, cursor: 'e-resize', top: '50%', marginTop: -5, right: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['e']))} />
          <div style={{ ...hs, cursor: 'se-resize', bottom: -5, right: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['s','e']))} />
          <div style={{ ...hs, cursor: 's-resize', bottom: -5, left: '50%', marginLeft: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['s']))} />
          <div style={{ ...hs, cursor: 'sw-resize', bottom: -5, left: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['s','w']))} />
          <div style={{ ...hs, cursor: 'w-resize', top: '50%', marginTop: -5, left: -5 }} onMouseDown={(e) => onResizeStart(e, new Set(['w']))} />
        </>
      )}
    </div>
  )
}
