/**
 * What is known about the device a mount stands for.
 *
 * A mount points at a Device Inventory entry, which the backend correlates with
 * a canvas node (IEEE, then IP) when it can. Everything here is read-only: the
 * inventory and the logical canvas own these facts, the rack only prints them
 * so the user does not have to open the other canvas to read an IP off it.
 *
 * Node values win over the inventory row's — the node is the record the user
 * curates, the inventory row is what discovery last saw — and each row is
 * dropped when neither side has anything to show. A device on no canvas still
 * prints everything discovery found; only the canvas-side rows go missing.
 */
import { useRackPalette } from '../rackTheme'
import type { DeviceStatus, InventoryDevice } from '@/types'

interface Row {
  label: string
  value: string
  /** Technical values (IP, MAC) are set in JetBrains Mono, per the design system. */
  mono?: boolean
}

function firstOf(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return null
}

/** Absolute local time — a rack is read at a glance, "3 days ago" hides the date. */
function formatSeen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

function serviceLabel(service: { port: number | null; name: string | null }): string {
  if (service.name && service.port !== null) return `${service.name}:${service.port}`
  return service.name ?? String(service.port)
}

export function LinkedDevicePanel({
  entry,
  status,
  onLink,
}: {
  /** The inventory row behind the mount. Absent for accessories. */
  entry: InventoryDevice | null | undefined
  /** Status already resolved for the plate, so both agree on `auto`. */
  status: DeviceStatus
  /**
   * Opens the inventory picker. Omitted when relinking is not on offer — a
   * mount that does not exist yet has nothing to hang a link on, and an
   * accessory stands for no device.
   */
  onLink?: () => void
}) {
  const palette = useRackPalette()
  if (!entry) return null

  const node = entry.node ?? null
  const rows: Row[] = []
  const push = (label: string, value: string | null, mono = false) => {
    if (value) rows.push({ label, value, mono })
  }

  push('Name', firstOf(node?.label, entry.label))
  push('Type', firstOf(node?.type, entry.type))
  push('Hostname', firstOf(node?.hostname, entry.hostname))
  push('IP', firstOf(node?.ip, entry.ip), true)
  push('MAC', firstOf(node?.mac, entry.mac), true)
  push('OS', firstOf(node?.os, entry.os))
  push('Check', firstOf(node?.checkMethod))
  push('Canvas', firstOf(node?.designName))
  push('Last seen', formatSeen(node?.lastSeen))

  const services = entry.services ?? []

  const header = (
    <header className="mb-2 flex items-center justify-between gap-2">
      <span className="text-xs font-medium">Linked device</span>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: palette.status[status] }}
        />
        {status}
      </span>
    </header>
  )

  return (
    <section
      aria-label="Linked device"
      className="rounded border border-[#30363d] bg-[#0d1117] p-2.5"
    >
      {header}

      {rows.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Nothing known about this device yet.
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
            <dd className={`truncate text-[11px] ${row.mono ? 'font-mono' : ''}`} title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {services.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Services</span>
          <ul className="flex flex-wrap gap-1">
            {services.map((service) => (
              <li
                key={serviceLabel(service)}
                className="rounded border border-[#30363d] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {serviceLabel(service)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Discovery only guesses the canvas node behind an entry, so saying so is
          part of the reading: no canvas node means `auto` status resolves to
          `unknown` and no link can be imported. */}
      {!node && (
        <p className="mt-2 text-[11px] text-muted-foreground">Not on a logical canvas.</p>
      )}

      {/* The device behind a plate is a choice — a placeholder created from the
          rack, or the wrong twin of two look-alikes — so it must be changeable
          from where it is read. */}
      {onLink && (
        <button
          type="button"
          onClick={onLink}
          className="mt-2 cursor-pointer text-[11px] text-[#00d4ff] hover:underline"
        >
          Link to another device…
        </button>
      )}
    </section>
  )
}
