/**
 * The rule two components share: which cables are on screen, and therefore
 * which sockets the plates must draw.
 */
import { describe, it, expect } from 'vitest'
import { patchedPortIds, visibleCables, type CableFocus } from '../cableVisibility'
import type { Cable } from '@/types'

const cable = (id: string, from: string, to: string): Cable => ({
  id,
  type: 'ethernet',
  color: '#39d353',
  from: { deviceId: from, portId: `${from}-out` },
  to: { deviceId: to, portId: `${to}-in` },
})

const CABLES = [cable('c1', 'sw', 'nas'), cable('c2', 'sw', 'pc'), cable('c3', 'nas', 'pc')]

const focus = (over: Partial<CableFocus> = {}): CableFocus => ({
  visibility: 'hover',
  cableMode: false,
  focusDeviceId: null,
  selectedCableId: null,
  ...over,
})

const ids = (f: CableFocus) => visibleCables(CABLES, f).map((c) => c.id)

describe('visibleCables', () => {
  it('draws everything when the overlay is on, or in patch mode', () => {
    expect(ids(focus({ visibility: 'always' }))).toEqual(['c1', 'c2', 'c3'])
    expect(ids(focus({ visibility: 'hidden', cableMode: true }))).toEqual(['c1', 'c2', 'c3'])
  })

  it('draws nothing in hover mode until a device is focused', () => {
    expect(ids(focus())).toEqual([])
  })

  it('draws both ends of the focused device runs', () => {
    expect(ids(focus({ focusDeviceId: 'sw' }))).toEqual(['c1', 'c2'])
    expect(ids(focus({ focusDeviceId: 'pc' }))).toEqual(['c2', 'c3'])
  })

  it('keeps a selected cable on screen even when everything is hidden', () => {
    // Its panel is open on the right; hiding the run it describes reads as a bug.
    expect(ids(focus({ visibility: 'hidden', selectedCableId: 'c2' }))).toEqual(['c2'])
  })

  it('reveals nothing extra on hover while hidden', () => {
    expect(ids(focus({ visibility: 'hidden', focusDeviceId: 'sw' }))).toEqual([])
  })
})

describe('patchedPortIds', () => {
  it('collects both endpoints of every drawn cable', () => {
    // Hovering the switch must light the sockets on the *far* plates too.
    expect(patchedPortIds(CABLES, focus({ focusDeviceId: 'sw' }))).toEqual(
      new Set(['sw-out', 'nas-in', 'pc-in']),
    )
  })

  it('is empty when no cable is drawn', () => {
    expect(patchedPortIds(CABLES, focus())).toEqual(new Set())
  })
})
