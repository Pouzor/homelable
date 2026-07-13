import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BRAND_ICON_PREFIX,
  ICON_REGISTRY, ICON_CATEGORIES, resolveCustomIcon,
} from '@/utils/nodeIcons'
import { matchBrandIcon, shouldSkipNode, type IconMatch } from '@/utils/brandIconMatch'
import { BrandIconPicker } from './BrandIconPicker'
import dashboardIcons from '@/data/dashboardIcons.json'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const SLUGS: string[] = dashboardIcons as string[]

interface RowData {
  nodeId: string
  label: string
  match: IconMatch
}

interface AutoIconModalProps {
  open: boolean
  nodes: Node<NodeData>[]
  onClose: () => void
  /** iconKey is the full custom_icon value: "brand:slug" or a lucide key */
  onApply: (assignments: Array<{ nodeId: string; iconKey: string }>) => void
}

const CONFIDENCE_BADGE: Record<string, { label: string; className: string }> = {
  exact:   { label: 'exact',   className: 'bg-[#39d353]/20 text-[#39d353] border-[#39d353]/30' },
  high:    { label: 'high',    className: 'bg-[#00d4ff]/20 text-[#00d4ff] border-[#00d4ff]/30' },
  partial: { label: 'partial', className: 'bg-[#e3b341]/20 text-[#e3b341] border-[#e3b341]/30' },
}

export function AutoIconModal({ open, nodes, onClose, onApply }: AutoIconModalProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  /** Maps nodeId → full icon key (brand:slug or lucide key) */
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')

  const { rows, skippedCount, noMatchCount } = useMemo(() => {
    const matched: RowData[] = []
    let skipped = 0
    let noMatch = 0
    for (const node of nodes) {
      if (shouldSkipNode(node.data.type, node.data.custom_icon)) { skipped++; continue }
      const match = matchBrandIcon(node.data.label ?? '', SLUGS)
      if (!match) { noMatch++; continue }
      matched.push({ nodeId: node.id, label: node.data.label ?? node.id, match })
    }
    return { rows: matched, skippedCount: skipped, noMatchCount: noMatch }
  }, [nodes])

  const initialChecked = useMemo(() => {
    const init: Record<string, boolean> = {}
    for (const row of rows) init[row.nodeId] = row.match.confidence !== 'partial'
    return init
  }, [rows])

  const effectiveChecked = useMemo(() => ({ ...initialChecked, ...checked }), [initialChecked, checked])

  /** Full icon key for a row — override takes priority, else the auto-matched brand slug */
  const effectiveKey = (row: RowData) =>
    overrides[row.nodeId] ?? `${BRAND_ICON_PREFIX}${row.match.slug}`

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const key = effectiveKey(r)
      return r.label.toLowerCase().includes(q) || key.includes(q)
    })
  }, [rows, search, overrides]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const toggleAll = (value: boolean) => {
    const next: Record<string, boolean> = {}
    for (const row of filtered) next[row.nodeId] = value
    setChecked((prev) => ({ ...prev, ...next }))
  }

  const handleApply = () => {
    const assignments = rows
      .filter((r) => effectiveChecked[r.nodeId])
      .map((r) => ({ nodeId: r.nodeId, iconKey: effectiveKey(r) }))
    onApply(assignments)
    onClose()
  }

  const checkedCount = rows.filter((r) => effectiveChecked[r.nodeId]).length
  const allFilteredChecked = filtered.length > 0 && filtered.every((r) => effectiveChecked[r.nodeId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-[#161b22] border border-border rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Wand2 size={14} className="text-[#00d4ff]" />
            <h2 className="text-sm font-semibold text-foreground">Auto-Assign Brand Icons</h2>
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 cursor-pointer" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-[#0d1117]/50 text-[11px] text-muted-foreground shrink-0">
          <span><span className="text-foreground font-medium">{rows.length}</span> matched</span>
          {noMatchCount > 0 && <span><span className="text-foreground font-medium">{noMatchCount}</span> no match</span>}
          {skippedCount > 0 && <span><span className="text-foreground font-medium">{skippedCount}</span> skipped (already set / structural)</span>}
          <span className="ml-auto text-[10px]">Icons via <span className="text-[#00d4ff]">jsDelivr CDN</span></span>
        </div>

        {/* Search + select-all */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or slug…"
            className="bg-[#0d1117] border-[#30363d] text-xs h-7 flex-1"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={allFilteredChecked}
              onChange={(e) => toggleAll(e.target.checked)}
              className="accent-[#00d4ff] w-3.5 h-3.5"
              title="Select / deselect all visible"
            />
            All
          </label>
        </div>

        {/* Icon rows */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
              {rows.length === 0 ? 'No nodes matched any brand icon.' : 'No results for that filter.'}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#161b22] border-b border-border">
                <tr>
                  <th className="w-8 px-4 py-2 text-left" />
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Node</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Icon</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const iconKey = effectiveKey(row)
                  const badge = CONFIDENCE_BADGE[row.match.confidence]
                  const isChecked = effectiveChecked[row.nodeId] ?? false

                  return (
                    <tr key={row.nodeId} className="border-b border-border/50 hover:bg-[#21262d]/60 transition-colors">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => setChecked((prev) => ({ ...prev, [row.nodeId]: e.target.checked }))}
                          className="accent-[#00d4ff] w-3.5 h-3.5 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{row.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        <IconPickerButton
                          iconKey={iconKey}
                          onSelect={(key) => setOverrides((prev) => ({ ...prev, [row.nodeId]: key }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border shrink-0">
          <span className="text-xs text-muted-foreground">
            {checkedCount} icon{checkedCount !== 1 ? 's' : ''} will be applied
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="cursor-pointer" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5 cursor-pointer bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90"
              disabled={checkedCount === 0}
              onClick={handleApply}
            >
              <Wand2 size={13} /> Apply {checkedCount > 0 ? checkedCount : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IconPickerButton — pill that opens a two-tab dropdown (Generic + Brand)
// ---------------------------------------------------------------------------

interface IconPickerButtonProps {
  iconKey: string
  onSelect: (key: string) => void
}

function IconPickerButton({ iconKey, onSelect }: IconPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const [pickerStyle, setPickerStyle] = useState<React.CSSProperties>({})
  const btnRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const pickerWidth = 296
      const pickerHeight = 360
      const left = rect.left + pickerWidth > window.innerWidth ? rect.right - pickerWidth : rect.left
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow < pickerHeight ? rect.top - pickerHeight - 4 : rect.bottom + 4
      setPickerStyle({ position: 'fixed', top, left, width: pickerWidth, zIndex: 60 })
    }
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Element
      if (!btnRef.current?.contains(t) && !pickerRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Display label: strip brand: prefix for brand icons
  const displayLabel = iconKey.startsWith(BRAND_ICON_PREFIX)
    ? iconKey.slice(BRAND_ICON_PREFIX.length)
    : iconKey

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        title="Click to change icon"
        className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors cursor-pointer ${
          open
            ? 'border-[#00d4ff]/60 bg-[#00d4ff]/5'
            : 'border-[#30363d] bg-[#0d1117] hover:border-[#484f58]'
        }`}
      >
        <IconPreview iconKey={iconKey} size={16} />
        <span className="font-mono text-[11px] text-muted-foreground max-w-[140px] truncate">{displayLabel}</span>
        <ChevronDown size={10} className={`text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={pickerRef}
          style={pickerStyle}
          className="bg-[#161b22] border border-border rounded-lg shadow-2xl p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <IconPickerDropdown
            value={iconKey}
            onSelect={(key) => { onSelect(key); setOpen(false) }}
          />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// IconPickerDropdown — two-tab picker (Generic lucide + Brand CDN)
// ---------------------------------------------------------------------------

function IconPickerDropdown({ value, onSelect }: { value: string; onSelect: (key: string) => void }) {
  const initialTab = value.startsWith(BRAND_ICON_PREFIX) ? 'brand' : 'generic'
  const [tab, setTab] = useState<'generic' | 'brand'>(initialTab)
  const [iconSearch, setIconSearch] = useState('')

  const tabBtn = (id: 'generic' | 'brand', label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => { setIconSearch(''); setTab(id) }}
      className={`text-[11px] px-2 py-1 rounded transition-colors cursor-pointer ${
        tab === id
          ? 'bg-[#21262d] text-foreground border border-[#30363d]'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      {/* Tabs */}
      <div className="flex gap-1" role="tablist" aria-label="Icon source">
        {tabBtn('generic', 'Generic')}
        {tabBtn('brand', 'Brand')}
      </div>

      {tab === 'brand' ? (
        <BrandIconPicker value={value} onSelect={onSelect} />
      ) : (
        <>
          <Input
            autoFocus
            value={iconSearch}
            onChange={(e) => setIconSearch(e.target.value)}
            placeholder="Search icons…"
            className="bg-[#21262d] border-[#30363d] text-xs h-7"
          />
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-0.5">
            {ICON_CATEGORIES.map((cat) => {
              const q = iconSearch.toLowerCase()
              const entries = ICON_REGISTRY.filter(
                (e) =>
                  e.category === cat &&
                  (q === '' ||
                    e.label.toLowerCase().includes(q) ||
                    e.key.includes(q)),
              )
              if (entries.length === 0) return null
              return (
                <div key={cat}>
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">
                    {cat}
                  </p>
                  <div className="grid grid-cols-7 gap-1">
                    {entries.map((entry) => {
                      const isSelected = value === entry.key
                      return (
                        <button
                          key={entry.key}
                          type="button"
                          title={entry.label}
                          onClick={() => onSelect(entry.key)}
                          className={`flex items-center justify-center w-7 h-7 rounded border transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]'
                              : 'border-[#30363d] text-muted-foreground hover:border-[#484f58] hover:text-foreground bg-[#0d1117]'
                          }`}
                        >
                          {createElement(entry.icon, { size: 14 })}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IconPreview — renders either a brand CDN image or a lucide icon component
// ---------------------------------------------------------------------------

function IconPreview({ iconKey, size = 16 }: { iconKey: string; size?: number }) {
  const resolved = resolveCustomIcon(iconKey)
  if (!resolved) return null
  if (resolved.kind === 'lucide') {
    return createElement(resolved.icon, { size, className: 'text-muted-foreground shrink-0' })
  }
  // brand, mdi, si, sh, url — all have a url property
  return (
    <img
      src={resolved.url}
      alt={'slug' in resolved ? resolved.slug : ('name' in resolved ? resolved.name : 'icon')}
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Compute `custom_icon` key from a brand slug. */
export function slugToIconKey(slug: string): string {
  return `${BRAND_ICON_PREFIX}${slug}`
}
