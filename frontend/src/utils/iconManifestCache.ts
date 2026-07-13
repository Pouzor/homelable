// Browser-side cache for icon manifests stored in localStorage.
// Pickers read from cache on mount (falls back to bundled JSON).
// The Settings modal calls refresh*() to pull fresh data from upstream.

const CACHE_KEYS = {
  dashboard: 'homelable.icons.dashboard',
  selfhst: 'homelable.icons.selfhst',
} as const

type ManifestType = keyof typeof CACHE_KEYS

interface ManifestCache {
  slugs: string[]
  updatedAt: number
}

function readCache(key: string): ManifestCache | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as ManifestCache) : null
  } catch {
    return null
  }
}

function writeCache(key: string, slugs: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ slugs, updatedAt: Date.now() }))
  } catch {
    // storage quota exceeded or unavailable — ignore
  }
}

export function getCachedSlugs(type: ManifestType, bundled: string[]): string[] {
  return readCache(CACHE_KEYS[type])?.slugs ?? bundled
}

export function getLastUpdated(type: ManifestType): Date | null {
  const cache = readCache(CACHE_KEYS[type])
  return cache ? new Date(cache.updatedAt) : null
}

export async function refreshDashboardIcons(): Promise<number> {
  const res = await fetch(
    'https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main?recursive=1',
    { headers: { 'User-Agent': 'homelable-icon-refresh' } },
  )
  if (!res.ok) throw new Error(`GitHub API responded with ${res.status} ${res.statusText}`)
  const data = await res.json()
  if (data.truncated) console.warn('iconManifestCache: GitHub tree was truncated')
  const slugs: string[] = (data.tree as { type: string; path: string }[])
    .filter((f) => f.type === 'blob' && f.path.startsWith('svg/') && f.path.endsWith('.svg'))
    .map((f) => f.path.slice(4, -4))
    .sort()
  writeCache(CACHE_KEYS.dashboard, slugs)
  return slugs.length
}

export async function refreshSelfhstIcons(): Promise<number> {
  const res = await fetch(
    'https://raw.githubusercontent.com/selfhst/icons/refs/heads/main/index.json',
  )
  if (!res.ok) throw new Error(`selfhst index responded with ${res.status} ${res.statusText}`)
  const index = await res.json()
  const slugs: string[] = Object.keys(index as Record<string, unknown>).sort()
  writeCache(CACHE_KEYS.selfhst, slugs)
  return slugs.length
}
