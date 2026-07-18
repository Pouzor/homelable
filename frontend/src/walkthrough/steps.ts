/**
 * Declarative Getting Started steps.
 *
 * `anchor` is a CSS selector for the element to ring/spotlight (undefined → the
 * overlay lights any open modal, or centers the card). `action` is a key resolved
 * against the walkthrough actions context on step enter (opens a modal, injects
 * demo data, selects nodes, …). `mode: 'full'` marks a backend-only step that is
 * filtered out of the standalone/public build. `link` renders a link in the card
 * (used for the closing "questions?" step).
 */
export type StepPlacement = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'auto'

export interface TourStep {
  id: string
  title: string
  body: string
  anchor?: string
  placement?: StepPlacement
  action?: string
  mode?: 'full' | 'all'
  link?: { label: string; href: string }
}

export const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Homelable',
    body: 'Take a quick tour of the main features — scanning your network, managing devices, and building your canvas. You can skip anytime and restart later from Settings.',
    placement: 'center',
    mode: 'all',
  },
  {
    id: 'scan',
    title: 'Scan your network',
    body: 'Start here: run an IP scan to auto-discover devices on your network. Pick the ranges and ports, then launch — discovered devices land in your inventory for review.',
    anchor: '[data-tour="scan-network"]',
    placement: 'right',
    action: 'openScanConfig',
    mode: 'full',
  },
  {
    id: 'scan-history',
    title: 'Follow scan progress',
    body: 'Scan History shows every run live. A running scan updates in place with elapsed time and device count — you can stop it here too. (This is example data.)',
    placement: 'left',
    action: 'openScanHistoryDemo',
    mode: 'full',
  },
  {
    id: 'inventory',
    title: 'Review discovered devices',
    body: 'Discovered devices wait in your inventory. For each one you can approve it onto the canvas, hide it, or delete it — with detected services and vendor shown. (Example devices.)',
    placement: 'left',
    action: 'openInventoryDemo',
    mode: 'full',
  },
  {
    id: 'nodes',
    title: 'Your devices on the canvas',
    body: 'Approved devices become nodes on the canvas. Each shows live status, IP, hostname and running services. Drag to arrange them and draw links between them.',
    anchor: '.react-flow__node',
    placement: 'auto',
    mode: 'all',
  },
  {
    id: 'node-edit',
    title: 'Edit a device',
    body: 'Double-click any node to edit it: name, type, IP, the status-check method, appearance, and its parent (e.g. a VM inside a Proxmox host). Changes are yours until you Save.',
    placement: 'left',
    action: 'editFirstNode',
    mode: 'all',
  },
  {
    id: 'text-zone',
    title: 'Annotate with text & zones',
    body: 'Add free Text labels and Zones (colored rectangles) to document your layout — group a rack, mark a VLAN, or leave a note. Both live under the canvas actions.',
    anchor: '[data-tour="add-zone"]',
    placement: 'right',
    mode: 'all',
  },
  {
    id: 'grouping',
    title: 'Group related devices',
    body: 'Select multiple nodes, then Create Group to box them together and drag them as one — perfect for a rack, a site, or a subnet.',
    anchor: '[data-tour="create-group"]',
    placement: 'left',
    action: 'selectTwoNodes',
    mode: 'all',
  },
  {
    id: 'style',
    title: 'Make it yours',
    body: 'Switch the canvas theme from Style, or fine-tune colors, borders and fonts per node type. Your homelab, your look.',
    anchor: '[data-tour="style"]',
    placement: 'bottom',
    action: 'openStyle',
    mode: 'all',
  },
  {
    id: 'imports',
    title: 'Import from your stack',
    body: 'Already running Zigbee2MQTT, Z-Wave JS, or Proxmox? Import devices directly from them instead of scanning — one click brings the whole topology in.',
    anchor: '[data-tour="zigbee-import"]',
    placement: 'right',
    action: 'openZigbeeImport',
    mode: 'full',
  },
  {
    id: 'end',
    title: "You're all set",
    body: "That's the tour! Build your map, save it, and share a read-only view. In full mode you also get network scanning, a device inventory, and Zigbee / Z-Wave / Proxmox import. Have a question or an idea?",
    placement: 'center',
    mode: 'all',
    link: { label: 'Ask on GitHub', href: 'https://github.com/Pouzor/homelable/issues' },
  },
]

/** Steps for the current build — backend-only steps are dropped in standalone. */
export function getSteps(standalone: boolean): TourStep[] {
  return STEPS.filter((s) => s.mode !== 'full' || !standalone)
}
