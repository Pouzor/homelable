/**
 * Standalone-mode persistence (VITE_STANDALONE=true).
 *
 * No backend is available, so designs (multi-canvas) and their canvas data are
 * persisted directly to localStorage:
 *   - `homelable_designs`         → Design[] (the canvas list)
 *   - `homelable_canvas:<id>`     → { nodes, edges, theme_id, custom_style } per design
 *
 * Legacy single-canvas installs stored everything under `homelable_canvas`
 * (no per-design key, no design list). `ensureSeed()` migrates that data into a
 * default design on first run so existing users keep their canvas.
 */
import type { Node, Edge } from '@xyflow/react'
import type { Design, DesignType, NodeData, EdgeData, CustomStyleDef } from '@/types'
import type { ThemeId } from '@/utils/themes'
import { generateUUID } from '@/utils/uuid'

const DESIGNS_KEY = 'homelable_designs'
const LEGACY_CANVAS_KEY = 'homelable_canvas'
const canvasKey = (designId: string) => `${LEGACY_CANVAS_KEY}:${designId}`

export interface StandaloneCanvas {
  nodes: Node<NodeData>[]
  edges: Edge<EdgeData>[]
  theme_id?: ThemeId
  custom_style?: CustomStyleDef | null
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
}

/** Load a design's canvas. Returns null when the design has never been saved. */
export function loadCanvas(designId: string): StandaloneCanvas | null {
  return readJSON<StandaloneCanvas>(canvasKey(designId))
}

export function saveCanvas(designId: string, data: StandaloneCanvas): void {
  localStorage.setItem(canvasKey(designId), JSON.stringify(data))
}
