import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { brandIconUrl, BRAND_ICON_PREFIX } from '@/utils/nodeIcons'
import dashboardIcons from '@/data/dashboardIcons.json'

const SLUGS: string[] = dashboardIcons as string[]
const PAGE = 120

interface BrandIconPickerProps {
  value?: string
  onSelect: (key: string) => void
}

export function BrandIconPicker({ value, onSelect }: BrandIconPickerProps) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SLUGS
    return SLUGS.filter((s) => s.includes(q))
  }, [query])

  const visible = filtered.slice(0, limit)
  const selectedSlug = value?.startsWith(BRAND_ICON_PREFIX) ? value.slice(BRAND_ICON_PREFIX.length) : null

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(PAGE) }}
        placeholder={`Search ${SLUGS.length} brand icons...`}
        className="bg-[#0d1117] border-[#30363d] text-xs h-7"
        aria-label="Brand icon search"
      />
      <div className="text-[10px] text-muted-foreground/60">
        {filtered.length} match{filtered.length === 1 ? '' : 'es'} · icons served via jsDelivr CDN
      </div>
      <div className="max-h-52 overflow-y-auto pr-1">
        <div className="grid grid-cols-7 gap-1">
          {visible.map((slug) => {
            const selected = slug === selectedSlug
            return (
              <button
                key={slug}
                type="button"
                onClick={() => onSelect(`${BRAND_ICON_PREFIX}${slug}`)}
                title={slug}
                aria-label={slug}
                aria-pressed={selected}
                className={`flex items-center justify-center aspect-square rounded-md border transition-colors cursor-pointer ${
                  selected
                    ? 'border-[#00d4ff] bg-[#00d4ff]/10'
                    : 'border-[#30363d] hover:border-[#484f58] bg-[#0d1117]'
                }`}
              >
                <img
                  src={brandIconUrl(slug)}
                  alt={slug}
                  loading="lazy"
                  width={20}
                  height={20}
                  style={{ width: 20, height: 20, objectFit: 'contain' }}
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
