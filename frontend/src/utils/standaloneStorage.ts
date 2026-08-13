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
  InventoryEntry,
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
  /**
   * The Device Inventory for this canvas. Standalone has no backend, so the
   * rows live with the canvas the way `StandaloneRackCanvas.inventory` does —
   * but the split is the same one the API makes: a node points at a row through
   * `device_id`, and the row owns the device facts. Absent on canvases saved
   * before the split, whose nodes still carry those facts inline.
   */
  devices?: InventoryEntry[]
  // NOTE: no floor plan here — floor plans need a backend to upload/serve the
  // image, so they are disabled in standalone mode (see homelable/CLAUDE.md ADR).
}

/** Node types that draw nothing physical, so they never get an inventory row. */
const FURNITURE_TYPES = new Set(['group', 'groupRect', 'text'])

/** Device fields the inventory row owns — everything a node no longer keeps. */
const DEVICE_FIELDS = [
  'hostname', 'ip', 'mac', 'os', 'status', 'check_method', 'check_target',
  'services', 'notes', 'cpu_count', 'cpu_model', 'ram_gb', 'disk_gb',
  'show_hardware', 'properties', 'last_seen', 'last_scan', 'response_time_ms',
] as const

/**
 * Split a canvas into nodes-plus-rows on the way to storage.
 *
 * Mirrors what the API does server-side, so a standalone canvas and a
 * backed one carry the same shape: one row per device, the node keeping only
 * the id of the row it draws.
 */
function splitDevices(data: StandaloneCanvas): StandaloneCanvas {
  const devices: InventoryEntry[] = [...(data.devices ?? [])]
  const byId = new Map(devices.map((d) => [d.id, d]))

  const nodes = data.nodes.map((n) => {
    if (FURNITURE_TYPES.has(n.data.type)) return n
    const deviceId = n.data.device_id ?? generateUUID()
    const previous = byId.get(deviceId)
    const facts = Object.fromEntries(
      DEVICE_FIELDS.filter((f) => n.data[f] !== undefined).map((f) => [f, n.data[f]]),
    )
    const row = {
      ...(previous ?? { id: deviceId, discovered_at: new Date().toISOString(), status: 'approved' }),
      ...facts,
      id: deviceId,
      label: n.data.label,
      type: n.data.type,
    } as InventoryEntry
    if (previous) devices[devices.indexOf(previous)] = row
    else devices.push(row)
    byId.set(deviceId, row)
    return { ...n, data: { ...n.data, device_id: deviceId } }
  })

  return { ...data, nodes, devices }
}

/** Put the device facts back on the nodes, so the canvas renders unchanged. */
function hydrateDevices(data: StandaloneCanvas): StandaloneCanvas {
  if (!data.devices?.length) return data
  const byId = new Map(data.devices.map((d) => [d.id, d]))
  return {
    ...data,
    nodes: data.nodes.map((n) => {
      const row = n.data.device_id ? byId.get(n.data.device_id) : undefined
      if (!row) return n
      const facts = Object.fromEntries(
        DEVICE_FIELDS.filter((f) => row[f] != null).map((f) => [f, row[f]]),
      )
      return {
        ...n,
        data: { ...n.data, ...facts, label: row.label ?? n.data.label, type: row.type ?? n.data.type },
      } as Node<NodeData>
    }),
  }
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
  const stored = readJSON<StandaloneCanvas>(canvasKey(designId))
  return stored ? hydrateDevices(stored) : null
}

export function saveCanvas(designId: string, data: StandaloneCanvas): void {
  localStorage.setItem(canvasKey(designId), JSON.stringify(splitDevices(data)))
}
