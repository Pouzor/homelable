import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { brandIconUrl, BRAND_ICON_PREFIX, LOCAL_BRAND_ICONS } from '@/utils/nodeIcons'
import dashboardIcons from '@/data/dashboardIcons.json'
import { t, useLocale } from '@/i18n'

// Locally-served logos first, then the generated dashboard-icons manifest.
const SLUGS: string[] = [
  ...LOCAL_BRAND_ICONS,
  ...(dashboardIcons as string[]).filter((s) => !(LOCAL_BRAND_ICONS as readonly string[]).includes(s)),
]
const PAGE = 120

interface BrandIconPickerProps {
  value?: string
  onSelect: (key: string) => void
}

export function BrandIconPicker({ value, onSelect }: BrandIconPickerProps) {
  useLocale()
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
        placeholder={t('Search {count} brand icons...', { count: SLUGS.length })}
        className="bg-[#0d1117] border-[#30363d] text-xs h-7"
        aria-label={t('Brand icon search')}
      />
      <div className="text-[10px] text-muted-foreground/60">
        {t('{count} match{plural} · icons served via jsDelivr CDN', {
          count: filtered.length,
          plural: filtered.length === 1 ? '' : 'es',
        })}
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
            {t('Load more ({count} remaining)', { count: filtered.length - limit })}
          </button>
        )}
        {filtered.length === 0 && (
          <div className="text-center text-[11px] text-muted-foreground py-4">{t('No icons match.')}</div>
        )}
      </div>
    </div>
  )
}
