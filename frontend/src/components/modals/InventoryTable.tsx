import type { KeyboardEvent, Ref } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff, Layers } from 'lucide-react'
import type { InventoryEntry } from '@/types'
import { useThemeStore } from '@/stores/themeStore'
import { resolveNodeColors } from '@/utils/nodeColors'
import { NODE_TYPE_DEFAULT_ICONS } from '@/utils/nodeIcons'
import { orderedSources, SOURCE_META } from '@/utils/deviceSources'
import { formatRelative, formatTimestamp } from '@/utils/timeFormat'
import {
  deviceLabel, deviceLastSeen, deviceType,
  type InventorySort, type InventorySortKey,
} from '@/utils/inventorySort'
import { badgeInk, badgeStyle } from '@/utils/badgeColor'

const COLUMNS: { key: InventorySortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'source', label: 'Source' },
  { key: 'ip', label: 'IP' },
  { key: 'mac', label: 'MAC', className: 'hidden lg:table-cell' },
  { key: 'vendor', label: 'Vendor', className: 'hidden xl:table-cell' },
  { key: 'services', label: 'Services', className: 'hidden md:table-cell' },
  { key: 'canvas', label: 'Canvases' },
  { key: 'seen', label: 'Last seen' },
]

interface InventoryTableProps {
  devices: InventoryEntry[]
  sort: InventorySort
  onSort: (key: InventorySortKey) => void
  selectMode: boolean
  selectedIds: Set<string>
  highlightId?: string
  highlightRef?: Ref<HTMLTableRowElement>
  onRowClick: (device: InventoryEntry) => void
}

/** The Device Inventory as a sortable table — the dense alternative to the card grid. */
export function InventoryTable({
  devices, sort, onSort, selectMode, selectedIds, highlightId, highlightRef, onRowClick,
}: InventoryTableProps) {
  return (
    <table className="w-full text-xs border-collapse" data-testid="inventory-table">
      <thead className="sticky top-0 z-10 bg-background">
        <tr className="border-b border-border text-left text-muted-foreground">
          {selectMode && <th className="w-8 px-2 py-2" aria-label="Selected" />}
          {COLUMNS.map((c) => {
            const active = sort.key === c.key
            const Arrow = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
            return (
              <th
                key={c.key}
                scope="col"
                aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={`px-2 py-2 font-medium whitespace-nowrap ${c.className ?? ''}`}
              >
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={`inline-flex items-center gap-1 cursor-pointer transition-colors hover:text-foreground ${active ? 'text-foreground' : ''}`}
                >
                  {c.label}
                  <Arrow size={12} className={active ? 'text-primary' : 'opacity-40'} />
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => (
          <InventoryRow
            key={d.id}
            device={d}
            selectMode={selectMode}
            selected={selectedIds.has(d.id)}
            highlighted={d.id === highlightId}
            rowRef={d.id === highlightId ? highlightRef : undefined}
            onClick={() => onRowClick(d)}
          />
        ))}
      </tbody>
    </table>
  )
}

interface InventoryRowProps {
  device: InventoryEntry
  selectMode: boolean
  selected: boolean
  highlighted: boolean
  rowRef?: Ref<HTMLTableRowElement>
  onClick: () => void
}

function InventoryRow({ device, selectMode, selected, highlighted, rowRef, onClick }: InventoryRowProps) {
  const roleType = deviceType(device) ?? 'generic'
  const Icon = NODE_TYPE_DEFAULT_ICONS[roleType] ?? NODE_TYPE_DEFAULT_ICONS.generic
  const activeTheme = useThemeStore((s) => s.activeTheme)
  // Same accent the node wears on the canvas, as the card's role badge does.
  const roleColor = resolveNodeColors({ type: roleType, custom_colors: undefined }, activeTheme).border
  const services = device.services ?? []
  const serviceNames = services.map((s) => s.service_name).filter(Boolean).join(', ')
  const canvasCount = device.canvas_count ?? 0
  const seen = deviceLastSeen(device)
  const label = deviceLabel(device)

  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  const stateClass = highlighted
    ? 'bg-warning/10'
    : selected
    ? 'bg-primary/10'
    : 'hover:bg-secondary'

  return (
    <tr
      ref={rowRef}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-selected={selectMode ? selected : undefined}
      data-testid={`inventory-row-${device.id}`}
      className={`border-b border-border/60 cursor-pointer transition-colors focus:outline-none focus-visible:bg-secondary ${stateClass}`}
    >
      {selectMode && (
        <td className="px-2 py-1.5">
          <input
            type="checkbox"
            checked={selected}
            readOnly
            tabIndex={-1}
            aria-label={`Select ${label}`}
            className="accent-primary pointer-events-none"
          />
        </td>
      )}
      <td className="px-2 py-1.5 max-w-[260px]">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground" title={label}>{label}</span>
          {device.status === 'hidden' && <EyeOff size={12} className="shrink-0 text-muted-foreground" />}
        </div>
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {roleType !== 'generic' ? (
          <span className="font-mono uppercase text-[10px]" style={{ color: badgeInk(roleColor) }}>{roleType}</span>
        ) : (
          <Empty />
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1 flex-wrap">
          {orderedSources(device).map((b) => (
            <span
              key={b}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={badgeStyle(SOURCE_META[b].color)}
            >
              {SOURCE_META[b].label}
            </span>
          ))}
        </div>
      </td>
      <td className="px-2 py-1.5 font-mono whitespace-nowrap">{device.ip ?? <Empty />}</td>
      <td className="px-2 py-1.5 font-mono whitespace-nowrap hidden lg:table-cell">{device.mac ?? <Empty />}</td>
      <td className="px-2 py-1.5 hidden xl:table-cell max-w-[180px] truncate" title={device.vendor ?? undefined}>{device.vendor ?? <Empty />}</td>
      <td className="px-2 py-1.5 hidden md:table-cell max-w-[260px] truncate text-muted-foreground" title={serviceNames || undefined}>
        {services.length > 0 ? (serviceNames || services.length) : <Empty />}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {canvasCount > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-primary font-medium"
            title={`On ${canvasCount} canvas${canvasCount !== 1 ? 'es' : ''}`}
          >
            <Layers size={11} />{canvasCount}
          </span>
        ) : (
          <Empty />
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground" title={formatTimestamp(seen)}>
        {formatRelative(seen)}
      </td>
    </tr>
  )
}

function Empty() {
  return <span className="text-muted-foreground/60">—</span>
}
