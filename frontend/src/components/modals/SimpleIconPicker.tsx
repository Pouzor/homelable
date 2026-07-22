import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { SI_ICON_PREFIX, simpleIconUrl } from '@/utils/nodeIcons'
import simpleIconsData from '@/data/simpleIcons.json'

interface SimpleIconEntry { slug: string; title: string; hex: string }
const ICONS: SimpleIconEntry[] = simpleIconsData as SimpleIconEntry[]
const PAGE = 120

interface SimpleIconPickerProps {
  value?: string
  /** If set, append :#hex color to the emitted key */
  color?: string
  onSelect: (key: string) => void
}

export function SimpleIconPicker({ value, color, onSelect }: SimpleIconPickerProps) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ICONS
    return ICONS.filter((ic) => ic.slug.includes(q) || ic.title.toLowerCase().includes(q))
  }, [query])

  const visible = filtered.slice(0, limit)

  const selectedSlug = value?.startsWith(SI_ICON_PREFIX)
    ? value.slice(SI_ICON_PREFIX.length).split(':#')[0]
    : null

  function makeKey(slug: string) {
    return color ? `${SI_ICON_PREFIX}${slug}:${color}` : `${SI_ICON_PREFIX}${slug}`
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }}
        placeholder={`Search ${ICONS.length} Simple Icons…`}
        className="bg-[#0d1117] border-[#30363d] text-xs h-7"
        aria-label="Simple Icons search"
      />
      <div className="text-[10px] text-muted-foreground/60">
        {filtered.length} match{filtered.length === 1 ? '' : 'es'} · brand SVGs from simpleicons.org
      </div>
      <div className="max-h-52 overflow-y-auto pr-1">
        <div className="grid grid-cols-7 gap-1">
          {visible.map((ic) => {
            const selected = ic.slug === selectedSlug
            return (
              <button
                key={ic.slug}
                type="button"
                onClick={() => onSelect(makeKey(ic.slug))}
                title={`${ic.title} (#${ic.hex})`}
                aria-label={ic.title}
                aria-pressed={selected}
                className={`flex items-center justify-center aspect-square rounded-md border transition-colors cursor-pointer ${
                  selected
                    ? 'border-[#00d4ff] bg-[#00d4ff]/10'
                    : 'border-[#30363d] hover:border-[#484f58] bg-[#0d1117]'
                }`}
              >
                <img
                  src={simpleIconUrl(ic.slug)}
                  alt={ic.title}
                  loading="lazy"
                  width={20}
                  height={20}
                  // Force white so all brand SVGs are visible on the dark picker bg
                  style={{ width: 20, height: 20, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
                />
              </button>
            )
          })}
        </div>
        {filtered.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + PAGE)}
            className="mt-2 w-full text-[11px] text-muted-foreground hover:text-foreground py-1"
          >
            Load more ({filtered.length - limit} remaining)
          </button>
        )}
        {filtered.length === 0 && (
          <div className="text-center text-[11px] text-muted-foreground py-4">No icons match.</div>
        )}
      </div>
    </div>
  )
}
