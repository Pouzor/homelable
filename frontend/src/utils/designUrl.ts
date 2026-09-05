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

// The Documentation section is not a design, so it needs its own params:
// `?view=docs` for the section and `?doc=<id>` for the open document. Same
// replaceState discipline — switching sections is not a navigation.
const VIEW_PARAM = 'view'
const DOC_PARAM = 'doc'

/** True when the URL asks for the Documentation section. */
export function isDocsViewInUrl(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get(VIEW_PARAM) === 'docs'
}

/** The document id the URL points at, or null. */
export function getDocIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(DOC_PARAM)
}

/** Reflect the section and the open document into the URL. */
export function setDocsViewInUrl(active: boolean, docId: string | null = null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (active) url.searchParams.set(VIEW_PARAM, 'docs')
  else url.searchParams.delete(VIEW_PARAM)
  if (active && docId) url.searchParams.set(DOC_PARAM, docId)
  else url.searchParams.delete(DOC_PARAM)
  window.history.replaceState(window.history.state, '', url)
}
