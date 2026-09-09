import { documentsApi } from '@/api/client'
import type { Doc } from './types'

/**
 * Downloading documentation.
 *
 * A single page needs no server: `doc.body` *is* the file — the whole markdown
 * document, YAML frontmatter included — so the viewer writes what it is already
 * holding. Exporting everything does need the server, because the tree only
 * carries summaries and the bodies were never loaded.
 */

/** Fall back on the title when a document predates its slug being set. */
function segment(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned || 'untitled'
}

export function docFilename(doc: Pick<Doc, 'slug' | 'title'>): string {
  return `${segment(doc.slug || doc.title)}.md`
}

/** Hand a blob to the browser as a download, then release the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** One document as the `.md` file it already is. */
export function downloadDoc(doc: Pick<Doc, 'slug' | 'title' | 'body'>): void {
  downloadBlob(new Blob([doc.body ?? ''], { type: 'text/markdown;charset=utf-8' }), docFilename(doc))
}

/**
 * The `filename=` the server put on the archive, so the date in it is the
 * server's and not a second one computed here.
 */
export function filenameFromDisposition(header: unknown, fallback: string): string {
  if (typeof header !== 'string') return fallback
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  if (!match) return fallback
  try {
    return decodeURIComponent(match[1].trim()) || fallback
  } catch {
    // A name that is not valid percent-encoding is still a usable name.
    return match[1].trim() || fallback
  }
}

/** Every document, as a zip of `.md` files mirroring the tree. */
export async function downloadAllDocs(): Promise<void> {
  const res = await documentsApi.export()
  const name = filenameFromDisposition(
    res.headers?.['content-disposition'],
    'homelable-documentation.zip',
  )
  downloadBlob(new Blob([res.data], { type: 'application/zip' }), name)
}
