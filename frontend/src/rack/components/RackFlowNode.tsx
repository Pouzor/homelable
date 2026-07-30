/** One rack = one React Flow node. The U grid inside is rendered by hand. */
import { useCallback, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { getFaceplate } from '../faceplates'
import {
  HEADER_PX,
  INTERIOR_TOP_PX,
  NUMBER_GUTTER_PX,
  RAIL_PX,
  U_PX,
  columnWidth,
  deviceBox,
  findSlot,
  innerWidth,
  interiorLeft,
  rackHeight,
  rackWidth,
  uLabel,
  xToCol,
  yToU,
} from '../layout'
import { useRackStore } from '../store'
import { useRackPalette } from '../rackTheme'
import { RACK_COLUMNS } from '@/types'
import { Faceplate } from './Faceplate'
import { endDrag, getDragPayload, parseDragPayload, startDrag } from './dragPayload'

interface DropPreview {
  uStart: number
  uHeight: number
  colStart: number
  colSpan: number
  valid: boolean
}

export function RackFlowNode({ id }: NodeProps) {
  const palette = useRackPalette()
  const rack = useRackStore((s) => s.racks.find((r) => r.id === id))
  const devices = useRackStore((s) => s.devices)
  const cables = useRackStore((s) => s.cables)
  const selectedDeviceId = useRackStore((s) => s.selectedDeviceId)
  const selectedRackId = useRackStore((s) => s.selectedRackId)
  const hoveredDeviceId = useRackStore((s) => s.hoveredDeviceId)
  const cableMode = useRackStore((s) => s.cableMode)
  const cableDraft = useRackStore((s) => s.cableDraft)
  const cableVisibility = useRackStore((s) => s.cableVisibility)

  const selectDevice = useRackStore((s) => s.selectDevice)
  const selectRack = useRackStore((s) => s.selectRack)
  const hoverDevice = useRackStore((s) => s.hoverDevice)
  const pickPort = useRackStore((s) => s.pickPort)
  const mountFromInventory = useRackStore((s) => s.mountFromInventory)
  const mountAccessory = useRackStore((s) => s.mountAccessory)
  const moveDevice = useRackStore((s) => s.moveDevice)

  const { getZoom } = useReactFlow()
  const [preview, setPreview] = useState<DropPreview | null>(null)

  const mounted = devices.filter((d) => d.rackId === id)

  const localPoint = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const zoom = getZoom() || 1
      return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
    },
    [getZoom],
  )

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!rack) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const payload = getDragPayload()
      if (!payload) return

      const { x, y } = localPoint(e)
      const source =
        payload.kind === 'device'
          ? devices.find((d) => d.id === payload.id)
          : getFaceplate(payload.faceplateId)
      if (!source) return

      const { uHeight, colSpan } = source
      const desired = {
        uStart: Math.max(1, yToU(rack, y) - Math.floor(uHeight / 2)),
        uHeight,
        colStart: Math.min(xToCol(rack, x), RACK_COLUMNS - colSpan),
        colSpan,
      }
      const slot = findSlot(
        rack,
        devices,
        desired,
        payload.kind === 'device' ? payload.id : undefined,
      )
      setPreview(slot ? { ...slot, valid: true } : { ...desired, valid: false })
    },
    [rack, devices, localPoint],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!rack) return
      e.preventDefault()
      const payload = parseDragPayload(e.dataTransfer)
      setPreview(null)
      endDrag()
      if (!payload) return

      const { x, y } = localPoint(e)
      const col = xToCol(rack, x)

      if (payload.kind === 'inventory') {
        mountFromInventory(payload.id, rack.id, { uStart: yToU(rack, y), colStart: col })
      } else if (payload.kind === 'accessory') {
        mountAccessory(payload.id, rack.id, { uStart: yToU(rack, y), colStart: col })
      } else {
        const device = devices.find((d) => d.id === payload.id)
        if (!device) return
        const desired = {
          uStart: Math.max(1, yToU(rack, y) - Math.floor(device.uHeight / 2)),
          uHeight: device.uHeight,
          colStart: Math.min(col, RACK_COLUMNS - device.colSpan),
          colSpan: device.colSpan,
        }
        const slot = findSlot(rack, devices, desired, device.id)
        if (slot) moveDevice(device.id, rack.id, slot)
      }
    },
    [rack, devices, localPoint, mountFromInventory, mountAccessory, moveDevice],
  )

  if (!rack) return null

  const width = rackWidth(rack)
  const height = rackHeight(rack)
  const gutter = rack.style.showNumbers ? NUMBER_GUTTER_PX : 0
  const col = columnWidth(rack)
  const patchedPorts = new Map<string, string>()
  for (const cable of cables) {
    patchedPorts.set(cable.from.portId, cable.color)
    patchedPorts.set(cable.to.portId, cable.color)
  }
  const cablesOn = cableVisibility === 'always' || cableMode
  // Ports of non-patch gear stay hidden until the plate is focused, or until
  // cables are on globally — a cable must never end on an invisible port.
  const revealAll = cablesOn

  return (
    <div
      className="rack-node"
      style={{ width, height, position: 'relative' }}
      onDragOver={onDragOver}
      onDragLeave={() => setPreview(null)}
      onDrop={onDrop}
      onClick={() => selectRack(rack.id)}
    >
      {/* Chassis */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          left: gutter,
          background: rack.style.frame,
          border: `2px solid ${selectedRackId === rack.id ? palette.accent : palette.plateOutline}`,
          borderRadius: 6,
          boxShadow: rack.style.enclosed ? 'inset 0 0 0 4px rgba(0,0,0,0.35)' : undefined,
        }}
      />
      {/* Interior */}
      <div
        style={{
          position: 'absolute',
          left: interiorLeft(rack),
          top: INTERIOR_TOP_PX,
          width: innerWidth(rack),
          height: rack.uHeight * U_PX,
          background: rack.style.interior,
        }}
      />
      {/* Rails */}
      {[interiorLeft(rack) - RAIL_PX, interiorLeft(rack) + innerWidth(rack)].map((x) => (
        <div
          key={x}
          style={{
            position: 'absolute',
            left: x,
            top: INTERIOR_TOP_PX,
            width: RAIL_PX,
            height: rack.uHeight * U_PX,
            background: rack.style.rail,
            backgroundImage:
              'repeating-linear-gradient(to bottom, rgba(0,0,0,0.45) 0 2px, transparent 2px 8px)',
          }}
        />
      ))}

      {/* U number gutter + slot separators */}
      {Array.from({ length: rack.uHeight }, (_, i) => {
        const u = rack.uHeight - i
        return (
          <div key={u}>
            {rack.style.showNumbers && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: INTERIOR_TOP_PX + i * U_PX,
                  width: gutter - 4,
                  height: U_PX,
                  fontSize: 9,
                  lineHeight: `${U_PX}px`,
                  textAlign: 'right',
                  color: palette.muted,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {uLabel(rack, u)}
              </div>
            )}
            <div
              style={{
                position: 'absolute',
                left: interiorLeft(rack),
                top: INTERIOR_TOP_PX + i * U_PX,
                width: innerWidth(rack),
                height: 1,
                background: 'rgba(255,255,255,0.04)',
              }}
            />
          </div>
        )
      })}

      {/* Drop preview */}
      {preview && (
        <div
          style={{
            position: 'absolute',
            left: interiorLeft(rack) + preview.colStart * col,
            top: INTERIOR_TOP_PX + (rack.uHeight - preview.uStart - preview.uHeight + 1) * U_PX,
            width: preview.colSpan * col,
            height: preview.uHeight * U_PX,
            border: `1.5px dashed ${preview.valid ? palette.status.online : palette.status.offline}`,
            background: preview.valid ? 'rgba(57,211,83,0.12)' : 'rgba(248,81,73,0.12)',
            borderRadius: 3,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Mounted gear */}
      {mounted.map((device) => {
        const box = deviceBox(rack, device)
        const isDraftDevice = cableDraft?.deviceId === device.id
        const focused = hoveredDeviceId === device.id || selectedDeviceId === device.id
        return (
          <div
            key={device.id}
            className="nodrag"
            draggable={!cableMode}
            onDragStart={(e) => startDrag(e.dataTransfer, { kind: 'device', id: device.id })}
            onDragEnd={endDrag}
            onClick={(e) => {
              e.stopPropagation()
              selectDevice(device.id)
            }}
            onMouseEnter={() => hoverDevice(device.id)}
            onMouseLeave={() => hoverDevice(null)}
            style={{
              position: 'absolute',
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              cursor: cableMode ? 'default' : 'grab',
            }}
            title={`${device.label} · ${device.uHeight}U · U${device.uStart}`}
          >
            <Faceplate
              faceplateId={device.faceplateId}
              label={device.label}
              status={device.status}
              ports={device.ports}
              width={box.width}
              height={box.height}
              colorOverride={device.color}
              selected={selectedDeviceId === device.id}
              revealed={revealAll || focused}
              transparent={cablesOn && !focused}
              interactivePorts={cableMode}
              patchedPorts={patchedPorts}
              draftPortId={isDraftDevice ? cableDraft.portId : null}
              onPortClick={(portId) => pickPort(device.id, portId)}
            />
          </div>
        )
      })}

      {/* Name plate — inside the chassis so it never gets clipped by fitView */}
      <div
        style={{
          position: 'absolute',
          left: gutter + 12,
          top: 6,
          height: HEADER_PX,
          lineHeight: `${HEADER_PX}px`,
          fontSize: 12,
          color: palette.text,
          fontFamily: 'Inter, system-ui, sans-serif',
          pointerEvents: 'none',
        }}
      >
        {rack.name}
        {rack.location && <span style={{ color: palette.muted }}> · {rack.location}</span>}
        <span style={{ color: palette.muted }}> · {rack.uHeight}U</span>
      </div>
    </div>
  )
}
