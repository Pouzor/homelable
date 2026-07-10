import { useMemo, useState } from 'react'
import { X, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { brandIconUrl, BRAND_ICON_PREFIX } from '@/utils/nodeIcons'
import { matchBrandIcon, shouldSkipNode, type IconMatch } from '@/utils/brandIconMatch'
import dashboardIcons from '@/data/dashboardIcons.json'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const SLUGS: string[] = dashboardIcons as string[]

interface RowData {
  nodeId: string
  label: string
  match: IconMatch
  /** Override slug picked interactively by the user */
  overrideSlug?: string
}

interface AutoIconModalProps {
  open: boolean
  nodes: Node<NodeData>[]
  onClose: () => void
  onApply: (assignments: Array<{ nodeId: string; slug: string }>) => void
}

const CONFIDENCE_BADGE: Record<string, { label: string; className: string }> = {
  exact:   { label: 'exact',   className: 'bg-[#39d353]/20 text-[#39d353] border-[#39d353]/30' },
  high:    { label: 'high',    className: 'bg-[#00d4ff]/20 text-[#00d4ff] border-[#00d4ff]/30' },
  partial: { label: 'partial', className: 'bg-[#e3b341]/20 text-[#e3b341] border-[#e3b341]/30' },
}

export function AutoIconModal({ open, nodes, onClose, onApply }: AutoIconModalProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')

  const { rows, skippedCount, noMatchCount } = useMemo(() => {
    const matched: RowData[] = []
    let skipped = 0
    let noMatch = 0

    for (const node of nodes) {
      if (shouldSkipNode(node.data.type, node.data.custom_icon)) {
        skipped++
        continue
      }
      const match = matchBrandIcon(node.data.label ?? '', SLUGS)
      if (!match) {
        noMatch++
        continue
      }
      matched.push({ nodeId: node.id, label: node.data.label ?? node.id, match })
    }

    return { rows: matched, skippedCount: skipped, noMatchCount: noMatch }
  }, [nodes])

  // Initialise checked state when rows change (open / node list change)
  const initialChecked = useMemo(() => {
    const init: Record<string, boolean> = {}
    for (const row of rows) {
      // Auto-check exact + high confidence; leave partial unchecked
      init[row.nodeId] = row.match.confidence !== 'partial'
    }
    return init
  }, [rows])

  // Merge initialChecked with user changes
  const effectiveChecked = useMemo(() => ({ ...initialChecked, ...checked }), [initialChecked, checked])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.label.toLowerCase().includes(q) || r.match.slug.includes(q),
    )
  }, [rows, search])

  if (!open) return null

  const toggleAll = (value: boolean) => {
    const next: Record<string, boolean> = {}
    for (const row of filtered) next[row.nodeId] = value
    setChecked((prev) => ({ ...prev, ...next }))
  }

  const handleApply = () => {
    const assignments = rows
      .filter((r) => effectiveChecked[r.nodeId])
      .map((r) => ({
        nodeId: r.nodeId,
        slug: overrides[r.nodeId] ?? r.match.slug,
      }))
    onApply(assignments)
    onClose()
  }

  const checkedCount = filtered.filter((r) => effectiveChecked[r.nodeId]).length
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
          <span className="ml-auto">Icons via <span className="text-[#00d4ff]">jsDelivr CDN</span></span>
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
              {rows.length === 0
                ? 'No nodes matched any brand icon.'
                : 'No results for that filter.'}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#161b22] border-b border-border">
                <tr>
                  <th className="w-8 px-4 py-2 text-left" />
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Node</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested Icon</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const activeSlug = overrides[row.nodeId] ?? row.match.slug
                  const badge = CONFIDENCE_BADGE[row.match.confidence]
                  const isChecked = effectiveChecked[row.nodeId] ?? false

                  return (
                    <tr
                      key={row.nodeId}
                      className="border-b border-border/50 hover:bg-[#21262d]/60 transition-colors"
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            setChecked((prev) => ({ ...prev, [row.nodeId]: e.target.checked }))
                          }
                          className="accent-[#00d4ff] w-3.5 h-3.5 cursor-pointer"
                        />
                      </td>

                      {/* Node name */}
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-foreground">{row.label}</span>
                      </td>

                      {/* Icon preview + slug selector */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <img
                            src={brandIconUrl(activeSlug)}
                            alt={activeSlug}
                            width={22}
                            height={22}
                            loading="lazy"
                            style={{ width: 22, height: 22, objectFit: 'contain' }}
                          />
                          <SlugSelector
                            value={activeSlug}
                            onChange={(slug) =>
                              setOverrides((prev) => ({ ...prev, [row.nodeId]: slug }))
                            }
                          />
                        </div>
                      </td>

                      {/* Confidence badge */}
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.className}`}
                        >
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

/** Inline slug input with live icon preview. */
function SlugSelector({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value); setEditing(true) }}
        className="font-mono text-[11px] text-muted-foreground hover:text-[#00d4ff] transition-colors cursor-pointer truncate max-w-[160px]"
        title="Click to override slug"
      >
        {value}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onChange(draft); setEditing(false) }
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => { onChange(draft); setEditing(false) }}
        className="h-6 text-[11px] font-mono bg-[#0d1117] border-[#30363d] w-36 px-1.5"
        placeholder="slug"
      />
      {draft && (
        <img
          src={brandIconUrl(draft)}
          alt={draft}
          width={18}
          height={18}
          loading="lazy"
          style={{ width: 18, height: 18, objectFit: 'contain' }}
        />
      )}
    </div>
  )
}

/** Compute `custom_icon` key from a slug. */
export function slugToIconKey(slug: string): string {
  return `${BRAND_ICON_PREFIX}${slug}`
}
