import { createElement, useState } from 'react'
import modalStyles from './modal-interactive.module.css'
import { Input } from '@/components/ui/input'
import { ICON_REGISTRY, ICON_CATEGORIES, isBrandIconKey } from '@/utils/nodeIcons'
import { BrandIconPicker } from './BrandIconPicker'

interface IconPickerPanelProps {
  /** Current icon key — a lucide registry key or `brand:<slug>`. */
  value?: string
  /** Called with the new key, or `undefined` when the current generic icon is toggled off. */
  onSelect: (key: string | undefined) => void
  /** Focus the generic-icon search field on mount. */
  autoFocus?: boolean
}

/**
 * Shared Generic/Brand icon picker body. Used by NodeModal and ServiceModal so
 * both surfaces offer the same lucide registry + dashboard-icons brand catalog.
 */
export function IconPickerPanel({ value, onSelect, autoFocus }: IconPickerPanelProps) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'generic' | 'brand'>(isBrandIconKey(value) ? 'brand' : 'generic')

  const tabClass = (active: boolean) =>
    `text-[11px] px-2 py-1 rounded transition-colors cursor-pointer ${
      active ? 'bg-[#21262d] text-foreground border border-[#30363d]' : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="flex flex-col gap-2 p-2.5 rounded-md bg-[#0d1117] border border-[#30363d]">
      <div className="flex gap-1 mb-1" role="tablist" aria-label="Icon source">
        <button type="button" role="tab" aria-selected={tab === 'generic'} onClick={() => setTab('generic')} className={tabClass(tab === 'generic')}>
          Generic
        </button>
        <button type="button" role="tab" aria-selected={tab === 'brand'} onClick={() => setTab('brand')} className={tabClass(tab === 'brand')}>
          Brand
        </button>
      </div>

      {tab === 'brand' ? (
        <BrandIconPicker value={value} onSelect={onSelect} />
      ) : (
        <>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icons…"
            className={`bg-[#21262d] border-[#30363d] text-xs h-7 ${modalStyles['modal-radius']}`}
            autoFocus={autoFocus}
          />
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto">
            {ICON_CATEGORIES.map((cat) => {
              const q = search.toLowerCase()
              const entries = ICON_REGISTRY.filter(
                (e) => e.category === cat && (search === '' || e.label.toLowerCase().includes(q) || e.key.includes(q))
              )
              if (entries.length === 0) return null
              return (
                <div key={cat}>
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1">{cat}</p>
                  <div className="grid grid-cols-7 gap-1">
                    {entries.map((entry) => {
                      const isSelected = value === entry.key
                      return (
                        <button
                          key={entry.key}
                          type="button"
                          title={entry.label}
                          onClick={() => onSelect(isSelected ? undefined : entry.key)}
                          className={`flex items-center justify-center w-7 h-7 rounded transition-colors cursor-pointer ${modalStyles['modal-interactive']}`}
                          aria-label={`Select icon ${entry.label}`}
                          style={{
                            background: isSelected ? '#00d4ff22' : 'transparent',
                            border: isSelected ? '1px solid #00d4ff88' : '1px solid transparent',
                            color: isSelected ? '#00d4ff' : '#8b949e',
                          }}
                          onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#21262d' }}
                          onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                        >
                          {createElement(entry.icon, { size: 13 })}
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
