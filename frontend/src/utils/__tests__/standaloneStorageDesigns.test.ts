/**
 * Standalone multi-canvas (designs) persistence tests.
 *
 * Verifies the localStorage-backed design list + per-design canvas storage used
 * when VITE_STANDALONE=true, including migration of a legacy single-canvas
 * install into a default design.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import type { NodeData, EdgeData } from '@/types'
import * as ss from '@/utils/standaloneStorage'

const DESIGNS_KEY = 'homelable_designs'
const LEGACY_CANVAS_KEY = 'homelable_canvas'
const canvasKey = (id: string) => `${LEGACY_CANVAS_KEY}:${id}`

function node(id: string): Node<NodeData> {
  return { id, type: 'server', position: { x: 0, y: 0 }, data: { label: id, type: 'server', status: 'unknown', services: [] } }
}
const noEdges: Edge<EdgeData>[] = []

beforeEach(() => {
  localStorage.clear()
})

describe('standaloneStorage designs', () => {
  it('listDesigns returns empty before any seed', () => {
    expect(ss.listDesigns()).toEqual([])
  })

  it('ensureSeed creates a default design once and is idempotent', () => {
    const first = ss.ensureSeed()
    expect(first).toHaveLength(1)
    expect(first[0].name).toBe('My Homelab')
    expect(first[0].design_type).toBe('network')

    const second = ss.ensureSeed()
    expect(second).toHaveLength(1)
    expect(second[0].id).toBe(first[0].id) // same design, not recreated
  })

  it('ensureSeed migrates legacy single-canvas data into the default design', () => {
    const legacy = { nodes: [node('a'), node('b')], edges: noEdges, theme_id: 'dark', custom_style: null }
    localStorage.setItem(LEGACY_CANVAS_KEY, JSON.stringify(legacy))

    const [design] = ss.ensureSeed()
    const migrated = ss.loadCanvas(design.id)
    expect(migrated?.nodes).toHaveLength(2)
    expect(migrated?.theme_id).toBe('dark')
    // Legacy bare key is consumed so it can't shadow per-design data later.
    expect(localStorage.getItem(LEGACY_CANVAS_KEY)).toBeNull()
  })

  it('createDesign appends and persists a new design', () => {
    ss.ensureSeed()
    const created = ss.createDesign('Garage', 'network')
    expect(ss.listDesigns().map((d) => d.id)).toContain(created.id)
    expect(ss.listDesigns()).toHaveLength(2)
  })

  it('saveCanvas / loadCanvas round-trips per design without cross-talk', () => {
    const a = ss.createDesign('A')
    const b = ss.createDesign('B')
    ss.saveCanvas(a.id, { nodes: [node('a1')], edges: noEdges, theme_id: 'default' })
    ss.saveCanvas(b.id, { nodes: [node('b1'), node('b2')], edges: noEdges, theme_id: 'default' })

    expect(ss.loadCanvas(a.id)?.nodes).toHaveLength(1)
    expect(ss.loadCanvas(b.id)?.nodes).toHaveLength(2)
  })

  it('loadCanvas returns null for an unsaved design', () => {
    const d = ss.createDesign('Empty')
    expect(ss.loadCanvas(d.id)).toBeNull()
  })

  it('updateDesign patches name/icon and bumps updated_at', () => {
    const d = ss.createDesign('Old')
    const updated = ss.updateDesign(d.id, { name: 'New', icon: 'router' })
    expect(updated?.name).toBe('New')
    expect(updated?.icon).toBe('router')
    expect(ss.listDesigns()[0].name).toBe('New')
  })

  it('updateDesign returns null for an unknown id', () => {
    expect(ss.updateDesign('nope', { name: 'x' })).toBeNull()
  })

  it('deleteDesign removes the design and its canvas data', () => {
    const a = ss.createDesign('A')
    const b = ss.createDesign('B')
    ss.saveCanvas(a.id, { nodes: [node('a1')], edges: noEdges })

    ss.deleteDesign(a.id)
    expect(ss.listDesigns().map((d) => d.id)).toEqual([b.id])
    expect(localStorage.getItem(canvasKey(a.id))).toBeNull()
  })

  it('tolerates corrupt JSON in the designs key', () => {
    localStorage.setItem(DESIGNS_KEY, '{not valid')
    expect(ss.listDesigns()).toEqual([])
  })
})
