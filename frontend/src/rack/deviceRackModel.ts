/**
 * The front panel a device wears in every rack.
 *
 * Mirrors `RackModel` on the wire (`device_inventory.rack_*`), with the size
 * resolved: an unmodelled row carries nulls, and a caller fills them from the
 * plate before handing the draft to an editor.
 */
import { getFaceplate } from './faceplates'
import type { Port } from '@/types'

export interface DeviceRackModel {
  faceplateId: string
  uHeight: number
  colSpan: number
  color: string | null
  ports: Port[]
}

/** The model a device that has never been racked starts from. */
export function emptyRackModel(faceplateId: string): DeviceRackModel {
  const plate = getFaceplate(faceplateId)
  return {
    faceplateId: plate.id,
    uHeight: plate.uHeight,
    colSpan: plate.colSpan,
    color: null,
    ports: [],
  }
}
