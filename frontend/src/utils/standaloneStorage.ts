/**
 * Standalone-mode persistence (VITE_STANDALONE=true).
 *
 * No backend is available, so designs (multi-canvas) and their canvas data are
 * persisted directly to localStorage:
 *   - `homelable_designs`         → Design[] (the canvas list)
 *   - `homelable_canvas:<id>`     → { nodes, edges, theme_id, custom_style } per design
 *   - `homelable_rack:<id>`       → { racks, devices, cables, viewport } per rack design
 *
 * Legacy single-canvas installs stored everything under `homelable_canvas`
 * (no per-design key, no design list). `ensureSeed()` migrates that data into a
 * default design on first run so existing users keep their canvas.
 */
import type { Node, Edge } from '@xyflow/react'
import type {
  Cable,
  CustomStyleDef,
  Design,
  DesignType,
  EdgeData,
  InventoryDevice,
  NodeData,
  Rack,
  RackDevice,
} from '@/types'
import type { ThemeId } from '@/utils/themes'
import { generateUUID } from '@/utils/uuid'

const DESIGNS_KEY = 'homelable_designs'
const LEGACY_CANVAS_KEY = 'homelable_canvas'
const RACK_KEY = 'homelable_rack'
const canvasKey = (designId: string) => `${LEGACY_CANVAS_KEY}:${designId}`
const rackKey = (designId: string) => `${RACK_KEY}:${designId}`

export interface StandaloneRackCanvas {
  racks: Rack[]
  devices: RackDevice[]
  cables: Cable[]
  viewport?: { x: number; y: number; zoom: number }
  /**
   * Inventory entries created from the rack canvas. Standalone has no
   * `pending_devices` table, so hardware documented here lives with the canvas.
   */
  inventory: InventoryDevice[]
}

export interface StandaloneCanvas {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  theme_id?: ThemeId
  custom_style?: CustomStyleDef | null
  // NOTE: no floor plan here — floor plans need a backend to upload/serve the
  // image, so they are disabled in standalone mode (see homelable/CLAUDE.md ADR).
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Read the design list. Returns [] when none have been created yet. */
export function listDesigns(): Design[] {
  return readJSON<Design[]>(DESIGNS_KEY) ?? []
}

function writeDesigns(designs: Design[]): void {
  localStorage.setItem(DESIGNS_KEY, JSON.stringify(designs))
}

/**
 * Guarantee at least one design exists and return the full list.
 * Migrates a legacy single-canvas install into a default design on first run.
 */
export function ensureSeed(): Design[] {
  const existing = listDesigns()
  if (existing.length > 0) return existing

  const design: Design = {
    id: generateUUID(),
    name: 'My Homelab',
    design_type: 'network',
    icon: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  writeDesigns([design])

  // Migrate legacy canvas data (stored under the bare key) into this design.
  const legacy = readJSON<StandaloneCanvas>(LEGACY_CANVAS_KEY)
  if (legacy && localStorage.getItem(canvasKey(design.id)) === null) {
    localStorage.setItem(canvasKey(design.id), JSON.stringify(legacy))
    localStorage.removeItem(LEGACY_CANVAS_KEY)
  }
  return [design]
}

export function createDesign(name: string, icon?: string | null, design_type: DesignType = 'network'): Design {
  const design: Design = {
    id: generateUUID(),
    name,
    design_type,
    icon: icon ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  writeDesigns([...listDesigns(), design])
  return design
}

const GROUP_TYPE = 'groupRect'
const TEXT_TYPE = 'text'

/** Node/group/text counts for a design's saved canvas (0s when never saved). */
export function designCounts(designId: string): Pick<Design, 'node_count' | 'group_count' | 'text_count'> {
  const canvas = loadCanvas(designId)
  const nodes = canvas?.nodes ?? []
  let group = 0
  let text = 0
  let node = 0
  for (const n of nodes) {
    if (n.data?.type === GROUP_TYPE) group++
    else if (n.data?.type === TEXT_TYPE) text++
    else node++
  }
  return { node_count: node, group_count: group, text_count: text }
}

/** Return the design list with per-canvas counts filled in (for the copy picker). */
export function listDesignsWithCounts(): Design[] {
  return listDesigns().map((d) => ({ ...d, ...designCounts(d.id) }))
}

/** Deep-copy a design's canvas into a new design. Returns the new design. */
export function copyDesign(sourceId: string, name: string, icon?: string | null): Design {
  const sourceType = listDesigns().find((d) => d.id === sourceId)?.design_type ?? 'network'
  const design = createDesign(name, icon, sourceType)
  const source = loadCanvas(sourceId)
  if (source) {
    // localStorage canvas already stores React Flow nodes/edges by value; a fresh
    // JSON round-trip is enough to detach the copy from the source.
    saveCanvas(design.id, JSON.parse(JSON.stringify(source)) as StandaloneCanvas)
  }
  const sourceRack = loadRackCanvas(sourceId)
  if (sourceRack) {
    saveRackCanvas(design.id, JSON.parse(JSON.stringify(sourceRack)) as StandaloneRackCanvas)
  }
  return design
}

export function updateDesign(id: string, patch: Partial<Pick<Design, 'name' | 'icon'>>): Design | null {
  const designs = listDesigns()
  const idx = designs.findIndex((d) => d.id === id)
  if (idx === -1) return null
  const updated: Design = { ...designs[idx], ...patch, updated_at: nowIso() }
  designs[idx] = updated
  writeDesigns(designs)
  return updated
}

export function deleteDesign(id: string): void {
  writeDesigns(listDesigns().filter((d) => d.id !== id))
  localStorage.removeItem(canvasKey(id))
  localStorage.removeItem(rackKey(id))
}

/** Load a design's rack canvas. Returns null when it has never been saved. */
export function loadRackCanvas(designId: string): StandaloneRackCanvas | null {
  return readJSON<StandaloneRackCanvas>(rackKey(designId))
}

export function saveRackCanvas(designId: string, data: StandaloneRackCanvas): void {
  localStorage.setItem(rackKey(designId), JSON.stringify(data))
}

/** Load a design's canvas. Returns null when the design has never been saved. */
export function loadCanvas(designId: string): StandaloneCanvas | null {
  return readJSON<StandaloneCanvas>(canvasKey(designId))
}

export function saveCanvas(designId: string, data: StandaloneCanvas): void {
  localStorage.setItem(canvasKey(designId), JSON.stringify(data))
}
