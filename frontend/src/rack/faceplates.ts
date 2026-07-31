/**
 * Front-panel templates.
 *
 * Artwork and port coordinates are unit coordinates (0..1 on both axes) so a
 * plate scales with U height, rack width and zoom. Every plate reserves three
 * bands that must not overlap: the status LED (far left), the name band
 * (`labelBox`) and whatever sits to the right of it.
 *
 * Templates only seed the ports — the user edits the port list afterwards.
 */
import { RACK_COLUMNS, type FaceplateTemplate, type Port, type PortType } from '@/types'

interface BankOptions {
  type: PortType
  count: number
  /** Horizontal band, in unit coordinates. */
  x: number
  w: number
  /** Ports per row; the bank wraps into as many evenly spaced rows as needed. */
  perRow?: number
  /** Label prefix; ports are numbered from `start`. */
  prefix?: string
  start?: number
}

/**
 * Evenly spread `count` ports across a horizontal band.
 * Rows are centred vertically so a bank always looks balanced on the plate,
 * whatever the U height.
 */
export function bank({
  type,
  count,
  x,
  w,
  perRow = count,
  prefix = 'P',
  start = 1,
}: BankOptions): Omit<Port, 'id'>[] {
  const rows = Math.max(1, Math.ceil(count / perRow))
  const stepX = w / perRow
  // Rows share the vertical space evenly: 1 row -> 0.5, 2 rows -> 0.3/0.7.
  const rowY = (row: number) => (row + 1) / (rows + 1)
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    return {
      label: `${prefix}${start + i}`,
      type,
      x: x + stepX * (col + 0.5),
      y: rowY(row),
    }
  })
}

const STEEL = '#2b323c'
const STEEL_LIGHT = '#39424f'
const BLACK_BOX = '#1b1f26'
const VENT = '#141922'

/** Name band used by full-width plates that keep their ports on the right. */
const LABEL_LEFT = { x: 0.055, w: 0.24 }
/** Narrower band for dense port panels. */
const LABEL_TIGHT = { x: 0.05, w: 0.15 }
/** Half/third-width plates: the LED is proportionally wider, so shift right. */
const LABEL_SMALL = { x: 0.1, w: 0.4 }
/** Bottom strip of a desktop NAS: badge, LED and sockets all sit on it. */
const NAS_BAND = 0.86

/** Drop a bank onto the NAS bottom strip — `bank` centres rows on the plate. */
function nasPorts(ports: Omit<Port, 'id'>[]): Omit<Port, 'id'>[] {
  return ports.map((p) => ({ ...p, y: NAS_BAND }))
}

/**
 * Desktop NAS height, in U.
 *
 * A U is drawn at 24px while the rack's inner width is 456px, so the canvas
 * compresses the vertical axis about 1.8x against the real thing. A tower that
 * measures 3U tall in metal reads as a squat box here — 5U is what makes the
 * drive doors stand up the way they do on the desk.
 */
const NAS_U = 5

/** Plate width the NAS bay figures below are expressed against. */
const NAS_REF_SPAN = RACK_COLUMNS / 3
/** Left inset and per-bay width of a desktop NAS drive stack, on a NAS_REF_SPAN plate. */
const NAS_BAY_X = 0.05
const NAS_BAY_W = 0.18

/**
 * A drive door is a 3.5" disk whatever the chassis holds, so the bay stack
 * grows with the bay count instead of stretching to fill the plate — the 2-bay
 * box wears two doors the same size as the 5-bay one's, not two fat ones.
 *
 * Unit coordinates are fractions of the plate, so a narrower plate needs larger
 * fractions to draw the same door: `colSpan` scales them back to the reference.
 */
function nasBays(cols: number, colSpan: number = NAS_REF_SPAN) {
  const scale = NAS_REF_SPAN / colSpan
  return {
    kind: 'bays' as const,
    x: NAS_BAY_X * scale,
    y: 0.07,
    w: cols * NAS_BAY_W * scale,
    h: 0.68,
    cols,
    rows: 1,
    fill: BLACK_BOX,
  }
}

export const FACEPLATES: FaceplateTemplate[] = [
  // --- Servers ------------------------------------------------------------
  {
    id: 'server-1u',
    label: 'Server 1U',
    kind: 'device',
    group: 'Servers',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: STEEL, stroke: '#0d1117' },
      { kind: 'vents', x: 0.32, y: 0.22, w: 0.42, h: 0.56, cols: 16, rows: 2, fill: VENT },
    ],
    ports: bank({ type: 'rj45', count: 2, x: 0.79, w: 0.16, prefix: 'eth' }),
  },
  {
    id: 'server-1u-bays',
    label: 'Server 1U — 4 bays',
    kind: 'device',
    group: 'Servers',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: STEEL, stroke: '#0d1117' },
      { kind: 'bays', x: 0.32, y: 0.18, w: 0.42, h: 0.64, cols: 4, rows: 1, fill: BLACK_BOX },
    ],
    ports: bank({ type: 'rj45', count: 2, x: 0.79, w: 0.16, prefix: 'eth' }),
  },
  {
    id: 'server-2u-bays',
    label: 'Server 2U — 8 bays',
    kind: 'device',
    group: 'Servers',
    uHeight: 2,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: STEEL, stroke: '#0d1117' },
      { kind: 'bays', x: 0.32, y: 0.12, w: 0.42, h: 0.76, cols: 4, rows: 2, fill: BLACK_BOX },
    ],
    ports: [
      ...bank({ type: 'rj45', count: 4, x: 0.78, w: 0.13, perRow: 2, prefix: 'eth' }),
      ...bank({ type: 'sfp+', count: 2, x: 0.92, w: 0.06, perRow: 1, prefix: 'sfp' }),
    ],
  },
  {
    id: 'server-4u-storage',
    label: 'Storage 4U — 12 bays',
    kind: 'device',
    group: 'Servers',
    uHeight: 4,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: { x: 0.055, w: 0.18 },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: STEEL_LIGHT, stroke: '#0d1117' },
      { kind: 'bays', x: 0.26, y: 0.1, w: 0.5, h: 0.8, cols: 4, rows: 3, fill: BLACK_BOX },
    ],
    ports: bank({ type: 'rj45', count: 2, x: 0.8, w: 0.14, prefix: 'eth' }),
  },
  {
    id: 'sff-half',
    label: 'SFF / mini PC (half width)',
    kind: 'device',
    group: 'Servers',
    uHeight: 1,
    colSpan: RACK_COLUMNS / 2,
    statusLed: true,
    labelBox: LABEL_SMALL,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: STEEL_LIGHT, stroke: '#0d1117' },
      { kind: 'vents', x: 0.54, y: 0.25, w: 0.24, h: 0.5, cols: 8, rows: 2, fill: VENT },
    ],
    ports: bank({ type: 'rj45', count: 1, x: 0.82, w: 0.12, prefix: 'eth' }),
  },
  {
    id: 'mini-third',
    label: 'Mini node (third width)',
    kind: 'device',
    group: 'Servers',
    uHeight: 1,
    colSpan: RACK_COLUMNS / 3,
    statusLed: true,
    labelBox: { x: 0.14, w: 0.42 },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: STEEL_LIGHT, stroke: '#0d1117' },
      { kind: 'vents', x: 0.6, y: 0.3, w: 0.16, h: 0.4, cols: 5, rows: 2, fill: VENT },
    ],
    ports: bank({ type: 'rj45', count: 1, x: 0.8, w: 0.14, prefix: 'eth' }),
  },

  // --- Network ------------------------------------------------------------
  {
    id: 'switch-8',
    label: 'Switch 8 ports',
    kind: 'device',
    group: 'Network',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    alwaysShowPorts: true,
    labelBox: LABEL_LEFT,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: BLACK_BOX, stroke: '#0d1117' },
      { kind: 'strip', x: 0.32, y: 0.16, w: 0.42, h: 0.68, fill: '#11161d' },
    ],
    ports: [
      ...bank({ type: 'rj45', count: 8, x: 0.33, w: 0.4, prefix: '' }),
      ...bank({ type: 'sfp', count: 1, x: 0.79, w: 0.08, prefix: 'sfp' }),
    ],
  },
  {
    id: 'switch-24',
    label: 'Switch 24 ports + 2 SFP',
    kind: 'device',
    group: 'Network',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    alwaysShowPorts: true,
    labelBox: LABEL_TIGHT,
    portSize: 'sm',
    elements: [
      { kind: 'panel', fill: BLACK_BOX, stroke: '#0d1117' },
      { kind: 'strip', x: 0.22, y: 0.12, w: 0.55, h: 0.76, fill: '#11161d' },
    ],
    ports: [
      ...bank({ type: 'rj45', count: 24, x: 0.23, w: 0.53, perRow: 12, prefix: '' }),
      ...bank({ type: 'sfp+', count: 2, x: 0.8, w: 0.12, prefix: 'sfp' }),
    ],
  },
  {
    id: 'switch-48',
    label: 'Switch 48 ports + 4 SFP+',
    kind: 'device',
    group: 'Network',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    alwaysShowPorts: true,
    labelBox: LABEL_TIGHT,
    portSize: 'sm',
    elements: [
      { kind: 'panel', fill: BLACK_BOX, stroke: '#0d1117' },
      { kind: 'strip', x: 0.21, y: 0.12, w: 0.56, h: 0.76, fill: '#11161d' },
    ],
    ports: [
      ...bank({ type: 'rj45', count: 48, x: 0.22, w: 0.54, perRow: 24, prefix: '' }),
      ...bank({ type: 'sfp+', count: 4, x: 0.79, w: 0.14, perRow: 2, prefix: 'sfp' }),
    ],
  },
  {
    id: 'router-1u',
    label: 'Router / firewall 1U',
    kind: 'device',
    group: 'Network',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#232a34', stroke: '#0d1117' },
      { kind: 'strip', x: 0.34, y: 0.16, w: 0.4, h: 0.68, fill: '#11161d' },
    ],
    ports: [
      ...bank({ type: 'rj45', count: 6, x: 0.35, w: 0.38, prefix: 'lan' }),
      ...bank({ type: 'sfp+', count: 1, x: 0.79, w: 0.08, prefix: 'sfp' }),
    ],
  },
  {
    id: 'patch-24',
    label: 'Patch panel 24',
    kind: 'device',
    group: 'Network',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    alwaysShowPorts: true,
    labelBox: { x: 0.02, w: 0.16 },
    portSize: 'sm',
    elements: [
      { kind: 'panel', fill: '#3a3f47', stroke: '#0d1117' },
      { kind: 'strip', x: 0.2, y: 0.14, w: 0.78, h: 0.72, fill: '#22262c' },
    ],
    ports: bank({ type: 'rj45', count: 24, x: 0.21, w: 0.76, perRow: 24, prefix: '' }),
  },
  {
    id: 'patch-fiber-12',
    label: 'Fiber panel 12 (LC)',
    kind: 'device',
    group: 'Network',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    alwaysShowPorts: true,
    labelBox: { x: 0.02, w: 0.16 },
    portSize: 'sm',
    elements: [
      { kind: 'panel', fill: '#3a3f47', stroke: '#0d1117' },
      { kind: 'strip', x: 0.2, y: 0.16, w: 0.6, h: 0.68, fill: '#22262c' },
    ],
    ports: bank({ type: 'sfp', count: 12, x: 0.21, w: 0.58, prefix: 'lc' }),
  },

  // --- Storage / power ----------------------------------------------------
  {
    id: 'nas-2u',
    label: 'NAS 2U — 8 bays',
    kind: 'device',
    group: 'Storage',
    uHeight: 2,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      { kind: 'bays', x: 0.32, y: 0.12, w: 0.42, h: 0.76, cols: 4, rows: 2, fill: BLACK_BOX },
    ],
    ports: [
      ...bank({ type: 'rj45', count: 2, x: 0.79, w: 0.12, perRow: 1, prefix: 'eth' }),
      ...bank({ type: 'sfp+', count: 1, x: 0.93, w: 0.05, prefix: 'sfp' }),
    ],
  },
  // Desktop NAS boxes (UGREEN DXP, Synology DS…) sat on a rack shelf: not rack
  // gear, so they take a third of the width and stand ~3U tall. Their front is
  // drive-tray doors, tall and portrait, filling everything above a thin bottom
  // strip that carries the badge, the LED and the sockets — hence `labelBox.y`.
  {
    id: 'nas-desktop-2',
    label: 'Desktop NAS — 2 bays',
    kind: 'device',
    group: 'Storage',
    uHeight: NAS_U,
    // Two doors side by side is a slim tower — a sixth of the rack.
    colSpan: RACK_COLUMNS / 6,
    statusLed: true,
    labelBox: { x: 0.26, w: 0.4, y: NAS_BAND },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      nasBays(2, RACK_COLUMNS / 6),
    ],
    ports: nasPorts(bank({ type: 'rj45', count: 1, x: 0.7, w: 0.26, prefix: 'eth' })),
  },
  {
    id: 'nas-desktop-4',
    label: 'Desktop NAS — 4 bays',
    kind: 'device',
    group: 'Storage',
    uHeight: NAS_U,
    colSpan: RACK_COLUMNS / 3,
    statusLed: true,
    labelBox: { x: 0.13, w: 0.42, y: NAS_BAND },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      nasBays(4),
    ],
    ports: nasPorts(bank({ type: 'rj45', count: 2, x: 0.6, w: 0.34, prefix: 'eth' })),
  },
  {
    id: 'nas-desktop-5',
    label: 'Desktop NAS — 5 bays',
    kind: 'device',
    group: 'Storage',
    uHeight: NAS_U,
    colSpan: RACK_COLUMNS / 3,
    statusLed: true,
    labelBox: { x: 0.13, w: 0.42, y: NAS_BAND },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      nasBays(5),
    ],
    ports: nasPorts([
      ...bank({ type: 'rj45', count: 2, x: 0.58, w: 0.24, prefix: 'eth' }),
      ...bank({ type: 'sfp+', count: 1, x: 0.84, w: 0.12, prefix: 'sfp' }),
    ]),
  },
  {
    id: 'ups-2u',
    label: 'UPS 2U',
    kind: 'device',
    group: 'Power',
    uHeight: 2,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    elements: [
      { kind: 'panel', fill: '#1f242c', stroke: '#0d1117' },
      { kind: 'vents', x: 0.34, y: 0.22, w: 0.26, h: 0.56, cols: 10, rows: 3, fill: VENT },
      { kind: 'outlets', x: 0.64, y: 0.28, w: 0.32, h: 0.44, count: 4 },
    ],
    // Outlets are artwork only — power cabling is out of v1.
    ports: [],
  },
  {
    id: 'pdu-1u',
    label: 'PDU 1U — 8 outlets',
    kind: 'device',
    group: 'Power',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    statusLed: true,
    labelBox: LABEL_LEFT,
    elements: [
      { kind: 'panel', fill: '#1f242c', stroke: '#0d1117' },
      { kind: 'outlets', x: 0.32, y: 0.22, w: 0.64, h: 0.56, count: 8 },
    ],
    ports: [],
  },

  // --- Accessories --------------------------------------------------------
  {
    id: 'blank-1u',
    label: 'Blank panel 1U',
    kind: 'accessory',
    group: 'Accessories',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    labelBox: { x: 0.04, w: 0.4 },
    elements: [{ kind: 'panel', fill: '#30363d', stroke: '#0d1117' }],
    ports: [],
  },
  {
    id: 'shelf-1u',
    label: 'Shelf 1U',
    kind: 'accessory',
    group: 'Accessories',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    labelBox: { x: 0.04, w: 0.4 },
    elements: [
      { kind: 'panel', fill: '#3a4048', stroke: '#0d1117' },
      { kind: 'strip', x: 0.46, y: 0.58, w: 0.5, h: 0.26, fill: '#242a31' },
    ],
    ports: [],
  },
  {
    id: 'cable-manager-1u',
    label: 'Cable manager 1U',
    kind: 'accessory',
    group: 'Accessories',
    uHeight: 1,
    colSpan: RACK_COLUMNS,
    labelBox: { x: 0.04, w: 0.3 },
    elements: [
      { kind: 'panel', fill: '#2a3038', stroke: '#0d1117' },
      { kind: 'vents', x: 0.36, y: 0.24, w: 0.6, h: 0.52, cols: 8, rows: 1, fill: '#161b22' },
    ],
    ports: [],
  },
]

const BY_ID = new Map(FACEPLATES.map((f) => [f.id, f]))

export function getFaceplate(id: string): FaceplateTemplate {
  return BY_ID.get(id) ?? FACEPLATES[0]
}

/**
 * Faceplate proposed when an inventory device is dropped into a rack.
 *
 * Keyed on the device's discovery `suggested_type`, which is free-form — an
 * unknown or missing type falls back to a plain 1U server plate, which the user
 * can swap in the device modal.
 */
const FACEPLATE_BY_DEVICE_TYPE: Record<string, string> = {
  server: 'server-1u-bays',
  proxmox: 'server-2u-bays',
  nas: 'nas-2u',
  switch: 'switch-24',
  router: 'router-1u',
  firewall: 'router-1u',
  ap: 'sff-half',
  computer: 'sff-half',
  docker_host: 'server-1u',
  ups: 'ups-2u',
  pdu: 'pdu-1u',
  patch_panel: 'patch-24',
  printer: 'shelf-1u',
  camera: 'mini-third',
  iot: 'mini-third',
  cpl: 'mini-third',
}

export function suggestFaceplate(deviceType: string | null | undefined): string {
  return (deviceType && FACEPLATE_BY_DEVICE_TYPE[deviceType]) || 'server-1u'
}

/**
 * The other direction: what kind of hardware a plate represents.
 *
 * A device created from the rack canvas has no discovery behind it, so the only
 * thing that says what it is, is the plate the user picked. Without this the row
 * landed in the Device Inventory with no type at all — no icon, no role badge,
 * invisible to the type filter.
 *
 * `patch_panel` and `pdu` are rack-only kinds: the logical canvas has no node
 * type for passive gear, and rack devices are never approved onto one anyway
 * (`approve` returns 409). They must stay out of `UNRACKABLE_TYPES` — a PDU is
 * the most rackable thing there is, which is also why it is not `socket`.
 */
const DEVICE_TYPE_BY_FACEPLATE: Record<string, string> = {
  'server-1u': 'server',
  'server-1u-bays': 'server',
  'server-2u-bays': 'server',
  'server-4u-storage': 'server',
  'sff-half': 'computer',
  'mini-third': 'computer',
  'switch-8': 'switch',
  'switch-24': 'switch',
  'switch-48': 'switch',
  'router-1u': 'router',
  'patch-24': 'patch_panel',
  'patch-fiber-12': 'patch_panel',
  'nas-2u': 'nas',
  'nas-desktop-2': 'nas',
  'nas-desktop-4': 'nas',
  'nas-desktop-5': 'nas',
  'ups-2u': 'ups',
  'pdu-1u': 'pdu',
}

/** Null for accessories, which are rack furniture and never inventory rows. */
export function deviceTypeForFaceplate(faceplateId: string): string | null {
  return DEVICE_TYPE_BY_FACEPLATE[faceplateId] ?? null
}

/** Templates grouped for the picker, preserving catalog order. */
export function faceplateGroups(): { group: string; items: FaceplateTemplate[] }[] {
  const groups: { group: string; items: FaceplateTemplate[] }[] = []
  for (const plate of FACEPLATES) {
    const existing = groups.find((g) => g.group === plate.group)
    if (existing) existing.items.push(plate)
    else groups.push({ group: plate.group, items: [plate] })
  }
  return groups
}
