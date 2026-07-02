import { describe, it, expect, beforeEach } from 'vitest'
import { useDesignStore } from '@/stores/designStore'
import type { Design } from '@/types'

function design(id: string, type: Design['design_type'] = 'network', name = id): Design {
  return { id, name, design_type: type, created_at: '', updated_at: '' }
}

describe('designStore', () => {
  beforeEach(() => {
    useDesignStore.setState({ designs: [], activeDesignId: null, activeDesignType: null, loaded: false })
  })

  it('starts empty and not loaded', () => {
    const s = useDesignStore.getState()
    expect(s.designs).toEqual([])
    expect(s.activeDesignId).toBeNull()
    expect(s.activeDesignType).toBeNull()
    expect(s.loaded).toBe(false)
  })

  it('setDesigns selects the first design as active and marks loaded', () => {
    const a = design('a', 'network')
    const b = design('b', 'electrical')
    useDesignStore.getState().setDesigns([a, b])
    const s = useDesignStore.getState()
    expect(s.designs).toHaveLength(2)
    expect(s.activeDesignId).toBe('a')
    expect(s.activeDesignType).toBe('network')
    expect(s.loaded).toBe(true)
  })

  it('setDesigns preserves the active design when it is still present', () => {
    useDesignStore.getState().setDesigns([design('a'), design('b', 'electrical')])
    useDesignStore.getState().setActiveDesign('b')
    // Re-list (e.g. after creating another design) — active id must not jump back to first.
    useDesignStore.getState().setDesigns([design('a'), design('b', 'electrical'), design('c')])
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBe('b')
    expect(s.activeDesignType).toBe('electrical')
  })

  it('setDesigns falls back to first when the active design was removed', () => {
    useDesignStore.getState().setDesigns([design('a'), design('b', 'electrical')])
    useDesignStore.getState().setActiveDesign('b')
    useDesignStore.getState().setDesigns([design('a')]) // 'b' deleted
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBe('a')
    expect(s.activeDesignType).toBe('network')
  })

  it('setDesigns with an empty list clears the active selection', () => {
    useDesignStore.getState().setDesigns([design('a')])
    useDesignStore.getState().setDesigns([])
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBeNull()
    expect(s.activeDesignType).toBeNull()
    expect(s.loaded).toBe(true)
  })

  it('setActiveDesign updates id and resolves type', () => {
    useDesignStore.getState().setDesigns([design('a'), design('b', 'electrical')])
    useDesignStore.getState().setActiveDesign('b')
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBe('b')
    expect(s.activeDesignType).toBe('electrical')
  })

  it('setActiveDesign with an unknown id sets a null type', () => {
    useDesignStore.getState().setDesigns([design('a')])
    useDesignStore.getState().setActiveDesign('missing')
    const s = useDesignStore.getState()
    expect(s.activeDesignId).toBe('missing')
    expect(s.activeDesignType).toBeNull()
  })

  it('getActiveDesign returns the active design or null', () => {
    expect(useDesignStore.getState().getActiveDesign()).toBeNull()
    const b = design('b', 'electrical')
    useDesignStore.getState().setDesigns([design('a'), b])
    useDesignStore.getState().setActiveDesign('b')
    expect(useDesignStore.getState().getActiveDesign()).toEqual(b)
  })

  it('addDesign appends and makes the new design active', () => {
    useDesignStore.getState().setDesigns([design('a')])
    const b = design('b', 'electrical', 'Power')
    useDesignStore.getState().addDesign(b)
    const s = useDesignStore.getState()
    expect(s.designs.map((d) => d.id)).toEqual(['a', 'b'])
    expect(s.activeDesignId).toBe('b')
    expect(s.activeDesignType).toBe('electrical')
  })

  it('updateDesign patches name and icon in place without touching others', () => {
    useDesignStore.getState().setDesigns([design('a'), design('b')])
    useDesignStore.getState().updateDesign('a', { name: 'Renamed', icon: 'server' })
    const designs = useDesignStore.getState().designs
    expect(designs.find((d) => d.id === 'a')).toMatchObject({ name: 'Renamed', icon: 'server' })
    expect(designs.find((d) => d.id === 'b')!.name).toBe('b')
  })

  it('removeDesign drops a non-active design and keeps the active one', () => {
    useDesignStore.getState().setDesigns([design('a'), design('b')])
    useDesignStore.getState().setActiveDesign('a')
    useDesignStore.getState().removeDesign('b')
    const s = useDesignStore.getState()
    expect(s.designs.map((d) => d.id)).toEqual(['a'])
    expect(s.activeDesignId).toBe('a')
  })

  it('removeDesign reassigns active to the first remaining when the active is removed', () => {
    useDesignStore.getState().setDesigns([design('a'), design('b', 'electrical')])
    useDesignStore.getState().setActiveDesign('a')
    useDesignStore.getState().removeDesign('a')
    const s = useDesignStore.getState()
    expect(s.designs.map((d) => d.id)).toEqual(['b'])
    expect(s.activeDesignId).toBe('b')
    expect(s.activeDesignType).toBe('electrical')
  })

  it('removeDesign clears active when the last design is removed', () => {
    useDesignStore.getState().setDesigns([design('a')])
    useDesignStore.getState().setActiveDesign('a')
    useDesignStore.getState().removeDesign('a')
    const s = useDesignStore.getState()
    expect(s.designs).toEqual([])
    expect(s.activeDesignId).toBeNull()
    expect(s.activeDesignType).toBeNull()
  })
})
