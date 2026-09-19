/**
 * PublicDocs — the read-only documentation space at `/docs?key=<DOCS_VIEW_KEY>`.
 *
 * A page of its own, booted straight from `main.tsx` before any session exists,
 * the way the live-view canvas is. It reads the same documents the app does and
 * renders them with the same components — the tree, the filter, the viewer — in
 * read-only mode: no editing, no restoring, no deleting, and no way to reach the
 * inventory or a canvas from here.
 *
 * Standalone builds have no backend to ask, so the page says so rather than
 * pretending to be empty.
 */

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isOverdue } from '../frontmatter'
import { usePublicDocsStore, type PublicGroupBy } from '../publicStore'
import { buildLibraryTree, buildLinkedDocTree, filterGroups, filterTree } from '../tree'
import { GROUP_BY_LABELS, type TreeLeaf } from '../types'
import { DocTreeGroups, DocTreeItem } from './DocTree'
import { DocViewer } from './DocViewer'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const GROUP_OPTIONS: PublicGroupBy[] = ['flat', 'tag']

function readUrl(): { key: string | null; docId: string | null } {
  const params = new URLSearchParams(window.location.search)
  return { key: params.get('key'), docId: params.get('doc') }
}

/** Keep the open document in the address bar, so a page can be linked to. */
function writeDocInUrl(docId: string | null): void {
  const url = new URL(window.location.href)
  if (docId) url.searchParams.set('doc', docId)
  else url.searchParams.delete('doc')
  window.history.replaceState({}, '', url)
}

function Centered({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-screen items-center justify-center p-6 text-center">
      <div>
        <BookOpen className="mx-auto mb-3 opacity-30" size={26} />
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  )
}

export default function PublicDocs() {
  const {
    docs,
    loaded,
    loading,
    error,
    openDoc,
    historyOpen,
    revisions,
    revisionsLoading,
    revisionPreview,
    filter,
    groupBy,
    expanded,
    load,
    open,
    toggleHistory,
    previewRevision,
    closeRevisionPreview,
    setFilter,
    setGroupBy,
    toggleExpanded,
  } = usePublicDocsStore()

  const [boot] = useState(readUrl)

  useEffect(() => {
    // Nothing here should ever be indexed: it is somebody's homelab, published
    // to whoever holds one link.
    document.title = 'Documentation'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    if (STANDALONE || !boot.key) return
    void load(boot.key).then(() => {
      if (boot.docId) void open(boot.docId)
    })
  }, [boot, load, open])

  const overdue = useMemo(
    () =>
      new Set(
        docs
          .filter((doc) => isOverdue(doc.frontmatter ?? {}, doc.reviewed_at, doc.created_at))
          .map((doc) => doc.id),
      ),
    [docs],
  )
  const starred = useMemo(
    () => new Set(docs.filter((doc) => doc.starred).map((doc) => doc.id)),
    [docs],
  )

  const libraryItems = useMemo(
    () => filterTree(buildLibraryTree(docs), filter),
    [docs, filter],
  )
  const linkedGroups = useMemo(
    () => filterGroups(buildLinkedDocTree(docs, groupBy, { overdue }), filter),
    [docs, groupBy, overdue, filter],
  )

  const linkable = useMemo(
    () => docs.map((doc) => ({ id: doc.id, slug: doc.slug, title: doc.title })),
    [docs],
  )

  function handleSelect(leaf: TreeLeaf) {
    if (!leaf.docId) return
    void open(leaf.docId)
    writeDocInUrl(leaf.docId)
  }

  if (STANDALONE) {
    return (
      <Centered
        title="Documentation needs the backend"
        detail="This build runs without one, so there is nothing to share."
      />
    )
  }
  if (!boot.key) {
    return (
      <Centered
        title="This link is missing its key"
        detail="A documentation link looks like /docs?key=…"
      />
    )
  }
  if (error) return <Centered title={error} />
  if (loading || !loaded) return <Centered title="Loading…" />

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <aside className="flex w-[260px] min-h-0 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-1 border-b border-border px-2 py-2">
          <Search size={13} className="shrink-0 opacity-50" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter documents"
            aria-label="Filter documents"
            className="h-6 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          {filter && (
            <Button size="icon-xs" variant="ghost" aria-label="Clear filter" onClick={() => setFilter('')}>
              <X />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <label
            htmlFor="public-docs-group-by"
            className="text-[10px] uppercase tracking-wide text-muted-foreground/70"
          >
            Group by
          </label>
          <select
            id="public-docs-group-by"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as PublicGroupBy)}
            className="ml-auto cursor-pointer rounded border border-border bg-transparent px-1 py-0.5 text-xs"
          >
            {GROUP_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {GROUP_BY_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
            Library
          </p>
          {libraryItems.length === 0 ? (
            <p className="px-3 py-1 text-xs text-muted-foreground/60">Nothing filed here.</p>
          ) : (
            libraryItems.map((leaf) => (
              <DocTreeItem
                key={leaf.id}
                leaf={leaf}
                depth={0}
                activeId={openDoc?.id ?? null}
                expanded={expanded}
                starred={starred}
                onSelect={handleSelect}
                onToggle={toggleExpanded}
              />
            ))
          )}

          <p className="mt-3 px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
            Devices &amp; canvases
          </p>
          <DocTreeGroups
            groups={linkedGroups}
            activeId={openDoc?.id ?? null}
            expanded={expanded}
            starred={starred}
            onSelect={handleSelect}
            onToggle={toggleExpanded}
          />
        </div>

        <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground/60">
          Read-only
        </p>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {openDoc ? (
          <DocViewer
            readOnly
            doc={openDoc}
            docs={linkable}
            devices={[]}
            drifted={false}
            history={{
              open: historyOpen,
              loading: revisionsLoading,
              revisions,
              preview: revisionPreview,
              onToggle: () => void toggleHistory(),
              onSelect: (revisionId) => void previewRevision(revisionId),
              onClosePreview: closeRevisionPreview,
            }}
            onDownload={() => {
              const blob = new Blob([openDoc.body], { type: 'text/markdown' })
              const link = document.createElement('a')
              link.href = URL.createObjectURL(blob)
              link.download = `${openDoc.slug || 'document'}.md`
              link.click()
              URL.revokeObjectURL(link.href)
            }}
            onOpenDoc={(id) => {
              void open(id)
              writeDocInUrl(id)
            }}
          />
        ) : (
          <Centered
            title={docs.length === 0 ? 'Nothing is documented yet' : 'Pick a document'}
            detail={docs.length === 0 ? undefined : 'Everything here is read-only.'}
          />
        )}
      </div>
    </div>
  )
}
