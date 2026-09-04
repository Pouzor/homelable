/**
 * Base path — Homelable can be served under a subpath (`https://home.example/homelab/`)
 * instead of the root of an origin.
 *
 * The single knob is the build-time `VITE_BASE_PATH` env var, which becomes Vite's
 * `base` (see `vite.config.ts`). Vite derives `import.meta.env.BASE_URL` from it and
 * rewrites the asset URLs it emits itself; everything the app builds by hand — API
 * calls, the WebSocket URL, the live-view route, `public/` assets — goes through the
 * helpers below.
 *
 * The default is `/`, where every helper returns exactly the string it returned before
 * the base path existed. Only path bases are supported (not a full CDN URL).
 */

/** Normalize a raw base into a `/`-delimited path that always ends in `/`. */
export function normalizeBasePath(raw?: string | null): string {
  const value = (raw ?? '').trim()
  if (!value || value === '/') return '/'
  return `/${value}/`.replace(/\/{2,}/g, '/')
}

/** The active base path. Always starts and ends with `/`; `/` when unset. */
export const BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL)

/** Join a path onto the base: `withBase('view')` → `/homelab/view`. */
export function withBase(path: string, base: string = BASE_PATH): string {
  return `${base}${path.replace(/^\/+/, '')}`
}

/** Base URL of the REST API — what the axios instances are created with. */
export const API_BASE_URL = withBase('api/v1')

/**
 * Resolve a root-absolute path the *backend* handed us (an uploaded media URL, the
 * OIDC login URL) against the base path. The backend has no idea where the SPA is
 * mounted, so it always answers `/api/v1/...`.
 *
 * Anything else — a `data:` URL, an absolute `http(s)://` URL, a protocol-relative
 * `//host/...` one, a relative path, or a path already carrying the prefix — is
 * returned untouched.
 */
export function resolveServerPath(url: string, base: string = BASE_PATH): string {
  if (!url || base === '/') return url
  if (!url.startsWith('/') || url.startsWith('//')) return url
  if (url === base.slice(0, -1) || url.startsWith(base)) return url
  return `${base}${url.slice(1)}`
}

/** Is this pathname the read-only live view (`/view`, `/homelab/view`)? */
export function isLiveViewPath(pathname: string, base: string = BASE_PATH): boolean {
  return pathname === withBase('view', base)
}
