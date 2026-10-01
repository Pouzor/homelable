/**
 * Declarative Getting Started steps.
 *
 * `anchor` is a CSS selector for the element to ring/spotlight (undefined → the
 * overlay lights any open modal, or centers the card). `action` is a key resolved
 * against the walkthrough actions context on step enter (opens a modal, injects
 * demo data, selects nodes, …). `mode: 'full'` marks a backend-only step that is
 * filtered out of the standalone/public build. `link` renders a link in the card
 * (used for the closing "questions?" step).
 *
 * The table is built by a function, not a module constant, because `title`, `body`
 * and `link.label` are translated. A constant would freeze whatever language
 * was active at import time and never repaint when the user switches.
 */
import { t } from '@/i18n'

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

function allSteps(): TourStep[] {
  return [
  
    {
      id: 'welcome',
      title: t('Welcome to Homelable'),
      body: t('Take a quick tour of the main features : scanning your network, managing devices, and building your canvas. You can skip anytime and restart later from Settings.'),
      placement: 'center',
      mode: 'all',
    },
    {
      id: 'scan',
      title: t('Scan your network'),
      body: t('Start here: run an IP scan to auto-discover devices on your network. Pick the ranges and ports, then launch, discovered devices land in your inventory for review.'),
      anchor: '[data-tour="scan-network"]',
      placement: 'right',
      action: 'openScanConfig',
      mode: 'full',
    },
    {
      id: 'scan-history',
      title: t('Follow scan progress'),
      body: t('Scan History shows every run live. A running scan updates in place with elapsed time and device count. You can stop it here too. (This is example data.)'),
      placement: 'left',
      action: 'openScanHistoryDemo',
      mode: 'full',
    },
    {
      id: 'inventory',
      title: t('Review discovered devices'),
      body: t('Discovered devices wait in your inventory. For each one you can approve it onto the canvas, hide it, or delete it, with detected services and vendor shown. (Example devices.)'),
      placement: 'left',
      action: 'openInventoryDemo',
      mode: 'full',
    },
    {
      id: 'nodes',
      title: t('Your devices on the canvas'),
      body: t('Devices you put in the canvas become nodes. Each shows live status, IP, hostname and running services. Drag to arrange them and draw links between them.'),
      anchor: '.react-flow__node',
      placement: 'auto',
      mode: 'all',
    },
    {
      id: 'node-edit',
      title: t('Edit a device'),
      body: t('Double-click any node to edit it: name, type, IP, the status-check method, appearance, and its parent (e.g. a VM inside a Proxmox host). Changes are yours until you Save.'),
      placement: 'left',
      action: 'editFirstNode',
      mode: 'all',
    },
    {
      id: 'text-zone',
      title: t('Annotate with text & zones'),
      body: t('Add free Text labels and Zones (colored rectangles) to document your layout to group a rack, mark a VLAN, or leave a note. Both live under the canvas actions.'),
      anchor: '[data-tour="add-zone"]',
      placement: 'right',
      mode: 'all',
    },
    {
      id: 'grouping',
      title: t('Group related devices'),
      body: t('Select multiple nodes, then Create Group to box them together and drag them as one. Perfect for a rack, a site, or a subnet.'),
      anchor: '[data-tour="create-group"]',
      placement: 'left',
      action: 'selectTwoNodes',
      mode: 'all',
    },
    {
      id: 'rack',
      title: t('Map the physical side'),
      body: t('A canvas can also be a Rack: real racks, the gear mounted in them, and the patch cables between their ports. Create one from the canvas switcher (New Canvas, Kind: Rack), drop a rack, mount devices with + Device, then hit Patch and drag from one port to another.'),
      anchor: '[data-tour="canvas-switcher"]',
      placement: 'right',
      mode: 'all',
    },
    {
      id: 'docs',
      title: t('Document your homelab'),
      body: t('Documentation sits beside the canvas, not inside a design: every device gets its own page, and the Library holds the runbooks, overviews and decisions that span several of them. A device is documented once and reads the same wherever it is drawn.'),
      anchor: '[data-tour="documentation"]',
      placement: 'right',
      action: 'openDocumentation',
      mode: 'full',
    },
    {
      id: 'docs-write',
      title: t('Start from a template'),
      body: t('New document opens a template picker — Runbook, Incident, Decision (ADR), Network overview and more, each with its sections already laid out. Write in Markdown, type [[ to link another document, and every page lists what links back to it. Earlier versions stay one click away.'),
      anchor: '[data-tour="docs-new"]',
      placement: 'right',
      action: 'openDocumentation',
      mode: 'full',
    },
    {
      id: 'docs-devices',
      title: t('A page per device'),
      body: t('Under Devices, every inventory entry has a page whose header is generated from the database — regenerate it after a change (the old body is kept in the history). Pivot the tree by zone, type, subnet, rack or tag, and reach a page straight from a node or an inventory row.'),
      anchor: '[data-tour="docs-devices"]',
      placement: 'right',
      action: 'openDocumentation',
      mode: 'full',
    },
    {
      id: 'style',
      title: t('Make it yours'),
      body: t('Switch the canvas theme from Style, or fine-tune colors, borders and fonts per node type. Your homelab, your look.'),
      anchor: '[data-tour="style"]',
      placement: 'bottom',
      action: 'openStyle',
      mode: 'all',
    },
    {
      id: 'imports',
      title: t('Import from your stack'),
      body: t('Already running Zigbee2MQTT, Z-Wave JS, Proxmox or UniFi? Import devices straight from them instead of scanning — pick a source and the whole topology comes in.'),
      anchor: '[data-tour="imports"]',
      placement: 'right',
      action: 'openImportPicker',
      mode: 'full',
    },
    {
      id: 'end',
      title: t("You're all set"),
      body: t("That's the tour! Build your map, save it, and share a read-only view. In full mode you also get network scanning, a device inventory, and Zigbee / Z-Wave / Proxmox / UniFi import. Have a question or an idea?"),
      placement: 'center',
      mode: 'all',
      link: { label: t('Ask on GitHub'), href: 'https://github.com/Pouzor/homelable/issues' },
    },
  ]
}

/**
 * Every step, in tour order, frozen at import time.
 *
 * Kept as a named export for tests and inspection, which only look at the
 * structure (id, anchor, mode) and not at the copy. The UI must NOT use this:
 * it renders `getSteps()`, which rebuilds the table whenever the locale changes.
 */
export const STEPS: TourStep[] = allSteps()

/** Steps for the current build — backend-only steps are dropped in standalone. */
export function getSteps(standalone: boolean): TourStep[] {
  return allSteps().filter((s) => s.mode !== 'full' || !standalone)
}
