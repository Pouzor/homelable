/**
 * What a document can embed, and the markdown an upload becomes.
 *
 * The list mirrors `ALLOWED_TYPES` in the backend's `api/routes/media.py`,
 * which stays the authority: checking here only spares a round trip and lets
 * the refusal name the formats instead of relaying a 415.
 */

/** Shown in the page. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

/** Linked rather than shown: markdown has no way to embed them. */
export const LINKED_TYPES = ['application/pdf']

/** Both lists, as a sentence can carry them. */
export const SUPPORTED_LABEL = 'PNG, JPEG, WebP, SVG or PDF'

/** Where uploads are served from — the prefix of every URL the upload returns. */
export const MEDIA_PATH = '/api/v1/media/'

export function isSupportedMedia(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || LINKED_TYPES.includes(file.type)
}

/**
 * The markdown that shows an uploaded file: an image, or a link for a type
 * that cannot be shown inline.
 *
 * An image is named after the file without its extension; a link keeps it,
 * since the extension is what says a click opens a PDF. Brackets are dropped
 * rather than escaped: they would close the label early, and the source is
 * meant to stay readable.
 */
export function mediaMarkdown(file: File, url: string): string {
  const name = file.name.replace(/[[\]\s]+/g, ' ').trim()
  if (LINKED_TYPES.includes(file.type)) return `[${name || 'file'}](${url})`
  return `![${name.replace(/\.[^.]+$/, '').trim() || 'image'}](${url})`
}

/** The server's own reason when it gave one — it names the limit that was hit. */
export function uploadError(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : 'Upload failed'
}
