/**
 * The cable view the viewer picked survives a reload and a design switch — and
 * patch mode forcing every cable on is never mistaken for a pick.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_CABLE_VIEW_SETTINGS,
  readCableViewSettings,
  writeCableViewSettings,
} from '../cableViewSettings'
import { useRackStore } from '../store'

vi.mock('@/api/client', () => ({
  racksApi: { load: vi.fn(), inventory: vi.fn(), save: vi.fn() },
  scanApi: { deletePending: vi.fn(), createPending: vi.fn() },
}))

const KEY = 'homelable.rackCableView'
const store = () => useRackStore.getState()

describe('readCableViewSettings', () => {
  it('falls back to the defaults when nothing was stored', () => {
    expect(readCableViewSettings()).toEqual(DEFAULT_CABLE_VIEW_SETTINGS)
  })

  it('reads back what was written, one key at a time', () => {
    writeCableViewSettings({ visibility: 'hidden' })
    writeCableViewSettings({ labelsVisible: false })
    expect(readCableViewSettings()).toEqual({ visibility: 'hidden', labelsVisible: false })
  })

  it('ignores a stored value it does not know, key by key', () => {
    localStorage.setItem(KEY, JSON.stringify({ visibility: 'sometimes', labelsVisible: false }))
    expect(readCableViewSettings()).toEqual({ visibility: 'hover', labelsVisible: false })
  })

  it('survives garbage in storage', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readCableViewSettings()).toEqual(DEFAULT_CABLE_VIEW_SETTINGS)
  })

  it('swallows a storage that refuses writes', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeCableViewSettings({ visibility: 'always' })).not.toThrow()
    setItem.mockRestore()
  })
})

describe('rack store cable view', () => {
  beforeEach(() => store().reset())

  it('remembers the visibility and the label toggle across a reload', () => {
    store().setCableVisibility('hidden')
    store().setCableLabelsVisible(false)

    // A reload or a design switch rebuilds the state from scratch.
    store().reset()
    expect(store().cableVisibility).toBe('hidden')
    expect(store().cableLabelsVisible).toBe(false)
  })

  it('keeps the pick when another design is loaded', () => {
    store().setCableVisibility('always')
    store().loadDemo()
    expect(store().cableVisibility).toBe('always')
  })

  it('never stores the visibility patch mode forces on', () => {
    store().setCableVisibility('hidden')
    store().toggleCableMode()
    expect(store().cableVisibility).toBe('always')

    // Reloaded mid-patch: the viewer gets their own pick back, not patch mode's.
    store().reset()
    expect(store().cableVisibility).toBe('hidden')
  })
})
