// Sync the active design id with the browser URL (`?design=<id>`), so the
// current design survives a page refresh and can be shared/opened via URL.
// When no `design` param is present, callers fall back to the default design.
const DESIGN_PARAM = 'design'

/** Read the design id from the current URL, or null when absent. */
export function getDesignIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(DESIGN_PARAM)
}

/**
 * Reflect the active design id into the URL without adding a history entry
 * (replaceState). Pass null to drop the param (back to the default design).
 */
export function setDesignIdInUrl(id: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set(DESIGN_PARAM, id)
  else url.searchParams.delete(DESIGN_PARAM)
  window.history.replaceState(window.history.state, '', url)
}
