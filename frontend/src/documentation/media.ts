/**
 * What a document can embed, and the markdown an upload becomes.
 *
 * The list mirrors `ALLOWED_TYPES` in the backend's `api/routes/media.py`,
 * which stays the authority: checking here only spares a round trip and lets
 * the refusal name the formats instead of relaying a 415.
 */

import { t } from '@/i18n'

/** Shown in the page. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

/** Linked rather than shown: markdown has no way to embed them. */
export const LINKED_TYPES = ['application/pdf']

/**
 * Both lists, as a sentence can carry them.
 *
 * A function rather than a translated constant: the list is read at the point
 * of use, and a const evaluated `t()` at module load would freeze whatever
 * locale happened to be active when the module was first imported — the whole
 * reason the rest of the app imports `t` at module level and calls it inline.
 *
 * The key is a literal here rather than a named const so the key-scan sees it.
 * Hiding it behind a variable makes the key unreferenced from any literal
 * call, and the stale-entry check then reports a translated string as unused —
 * the class of exemption that quietly rots. (Note that this scanner does not
 * strip comments, so a doc comment must never quote a real call with its
 * string argument: the scanner reads the example as a key.) The format names
 * stay Latin; only the separators are copy.
 */
export function supportedLabel(): string {
  return t('PNG, JPEG, WebP, SVG or PDF')
}

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
  // The detail is the server's own wording and goes through `t()` by way of
  // the same route errorMessage() uses: a known message comes back Chinese, an
  // unknown one stays as the server sent it. The fallback is this module's own
  // copy, so it needs `t()` directly — and returns itself under English, which
  // is what media.test.ts asserts.
  return typeof detail === 'string' ? t(detail) : t('Upload failed')
}
