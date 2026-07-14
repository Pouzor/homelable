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


const AUTO_KEYS = {
  dashboard: 'homelable.icons.autoRefresh.dashboard',
  selfhst: 'homelable.icons.autoRefresh.selfhst',
} as const

const MONTH_MS = 30 * 24 * 60 * 60 * 1000

const REFRESHERS: Record<ManifestType, () => Promise<number>> = {
  dashboard: refreshDashboardIcons,
  selfhst: refreshSelfhstIcons,
}

export function getAutoRefresh(type: ManifestType): boolean {
  try {
    return localStorage.getItem(AUTO_KEYS[type]) === 'true'
  } catch {
    return false
  }
}

export function setAutoRefresh(type: ManifestType, enabled: boolean) {
  try {
    localStorage.setItem(AUTO_KEYS[type], enabled ? 'true' : 'false')
  } catch {
    // storage unavailable - ignore
  }
}

function isStale(type: ManifestType): boolean {
  const cache = readCache(CACHE_KEYS[type])
  return !cache || Date.now() - cache.updatedAt >= MONTH_MS
}

// Refresh a manifest only when the user opted in and the cache is missing or
// older than 30 days. Runs silently; failures are logged, never thrown.
export async function maybeAutoRefresh(type: ManifestType): Promise<void> {
  if (!getAutoRefresh(type) || !isStale(type)) return
  try {
    await REFRESHERS[type]()
  } catch (err) {
    console.warn(`iconManifestCache: auto-refresh of ${type} failed`, err)
  }
}

// Called once on app startup: fire-and-forget monthly refresh for opted-in sources.
export function initAutoRefreshIcons(): void {
  ;(Object.keys(CACHE_KEYS) as ManifestType[]).forEach((type) => {
    void maybeAutoRefresh(type)
  })
}
