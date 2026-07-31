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
    uHeight: 3,
    colSpan: RACK_COLUMNS / 3,
    statusLed: true,
    labelBox: { x: 0.13, w: 0.42, y: NAS_BAND },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      { kind: 'bays', x: 0.09, y: 0.07, w: 0.82, h: 0.68, cols: 2, rows: 1, fill: BLACK_BOX },
    ],
    ports: nasPorts(bank({ type: 'rj45', count: 1, x: 0.62, w: 0.3, prefix: 'eth' })),
  },
  {
    id: 'nas-desktop-4',
    label: 'Desktop NAS — 4 bays',
    kind: 'device',
    group: 'Storage',
    uHeight: 3,
    colSpan: RACK_COLUMNS / 3,
    statusLed: true,
    labelBox: { x: 0.13, w: 0.42, y: NAS_BAND },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      { kind: 'bays', x: 0.06, y: 0.07, w: 0.88, h: 0.68, cols: 4, rows: 1, fill: BLACK_BOX },
    ],
    ports: nasPorts(bank({ type: 'rj45', count: 2, x: 0.6, w: 0.34, prefix: 'eth' })),
  },
  {
    id: 'nas-desktop-5',
    label: 'Desktop NAS — 5 bays',
    kind: 'device',
    group: 'Storage',
    uHeight: 3,
    colSpan: RACK_COLUMNS / 3,
    statusLed: true,
    labelBox: { x: 0.13, w: 0.42, y: NAS_BAND },
    portSize: 'md',
    elements: [
      { kind: 'panel', fill: '#262c35', stroke: '#0d1117' },
      { kind: 'bays', x: 0.05, y: 0.07, w: 0.9, h: 0.68, cols: 5, rows: 1, fill: BLACK_BOX },
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
  printer: 'shelf-1u',
  camera: 'mini-third',
  iot: 'mini-third',
  cpl: 'mini-third',
}

export function suggestFaceplate(deviceType: string | null | undefined): string {
  return (deviceType && FACEPLATE_BY_DEVICE_TYPE[deviceType]) || 'server-1u'
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
