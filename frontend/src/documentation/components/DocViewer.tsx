import { useMemo, useState } from 'react'
import { Clock, History, Link2, Pencil, Plus, RefreshCw, Star, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isOverdue, parseFrontmatter } from '../frontmatter'
import { Markdown } from '../markdown/Markdown'
import { extractToc } from '../markdown/toc'
import type { Doc, DocBacklink, DocRevision } from '../types'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'
import { DocHistoryRail, RevisionPreview } from './DocHistory'

/** Everything the history rail and the revision preview need, in one prop. */
export interface HistoryControls {
  open: boolean
  loading: boolean
  revisions: DocRevision[]
  preview: { revision: DocRevision; body: string } | null
  onToggle: () => void
  onSelect: (revisionId: string) => void
  onClosePreview: () => void
  onRestore: (revisionId: string) => void
}

interface Props {
  doc: Doc
  docs: LinkableDoc[]
  devices: LinkableDevice[]
  drifted: boolean
  /** The documents linking here. Empty until the server answers. */
  backlinks?: DocBacklink[]
  backlinksLoading?: boolean
  /**
   * Omitted by a host that keeps no history state, and then the viewer offers
   * none — the button would have nothing to open.
   */
  history?: HistoryControls
  onEdit: () => void
  onToggleStar: () => void
  onMarkReviewed: () => void
  onRegenerate: () => void
  onDelete: () => void
  onOpenDoc: (id: string) => void
  onCreateFromLink: (label: string) => void
  onToggleTask: (body: string) => void
  /** Writes the whole tag list back into the document's frontmatter. */
  onSetTags: (tags: string[]) => void
}

const NO_HISTORY: HistoryControls = {
  open: false,
  loading: false,
  revisions: [],
  preview: null,
  onToggle: () => {},
  onSelect: () => {},
  onClosePreview: () => {},
  onRestore: () => {},
}

/** The metadata a frontmatter block is worth surfacing as a chip. */
const CHIPS: { key: string; label: string }[] = [
  { key: 'criticality', label: 'Criticality' },
  { key: 'owner', label: 'Owner' },
  { key: 'review_every', label: 'Review' },
]

export function DocViewer({
  doc,
  docs,
  devices,
  drifted,
  backlinks = [],
  backlinksLoading = false,
  history,
  onEdit,
  onToggleStar,
  onMarkReviewed,
  onRegenerate,
  onDelete,
  onOpenDoc,
  onCreateFromLink,
  onToggleTask,
  onSetTags,
}: Props) {
  const controls = history ?? NO_HISTORY
  const { data } = useMemo(() => parseFrontmatter(doc.body), [doc.body])
  const [tagDraft, setTagDraft] = useState<string | null>(null)
  const toc = useMemo(() => extractToc(doc.body), [doc.body])
  const overdue = isOverdue(data, doc.reviewed_at, doc.created_at)

  // One field takes a whole list: "web, prod" adds two tags, and a tag already
  // on the document is not added twice whatever its case.
  function commitTags() {
    const known = new Set(doc.tags.map((tag) => tag.toLowerCase()))
    const added: string[] = []
    for (const raw of (tagDraft ?? '').split(',')) {
      const tag = raw.trim()
      if (!tag || known.has(tag.toLowerCase())) continue
      known.add(tag.toLowerCase())
      added.push(tag)
    }
    if (added.length) onSetTags([...doc.tags, ...added])
    setTagDraft(null)
  }

  // Reading an old version replaces the body, not the page: the title, the
  // chips and the history rail stay put, so it reads as the same document at a
  // different moment rather than as somewhere else.
  const preview = controls.preview
  if (preview) {
    return (
      <div className="flex min-h-0 flex-1">
        <RevisionPreview
          revision={preview.revision}
          body={preview.body}
          currentBody={doc.body}
          docs={docs}
          devices={devices}
          onOpenDoc={onOpenDoc}
          onRestore={() => controls.onRestore(preview.revision.id)}
          onClose={controls.onClosePreview}
        />
        {controls.open && (
          <DocHistoryRail
            revisions={controls.revisions}
            activeId={preview.revision.id}
            loading={controls.loading}
            onSelect={controls.onSelect}
            onClose={controls.onToggle}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex items-start gap-2 px-6 pt-5">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{doc.title}</h1>
          <Button
            size="icon-xs"
            variant="ghost"
            title={doc.starred ? 'Unstar' : 'Star'}
            aria-pressed={doc.starred}
            onClick={onToggleStar}
            className="cursor-pointer"
          >
            <Star className={cn(doc.starred && 'fill-current text-[var(--accent-orange,#ff6e00)]')} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} className="cursor-pointer gap-1">
            <Pencil size={13} /> Edit
          </Button>
          {history && (
            <Button
              size="icon-xs"
              variant="ghost"
              title="Earlier versions of this document"
              aria-label="Version history"
              aria-pressed={history.open}
              onClick={history.onToggle}
              className={cn('cursor-pointer', history.open && 'bg-muted')}
            >
              <History />
            </Button>
          )}
          {/* A folder holds children, not a generated body — nothing to rebuild. */}
          {doc.kind !== 'folder' && (
            <Button
              size="icon-xs"
              variant="ghost"
              title="Regenerate this document from the database"
              aria-label="Regenerate this document"
              onClick={onRegenerate}
              className="cursor-pointer"
            >
              <RefreshCw />
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" title="Delete this document" onClick={onDelete} className="cursor-pointer">
            <Trash2 />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-6 pt-2 text-[10px]">
          {CHIPS.filter((chip) => data[chip.key]).map((chip) => (
            <span key={chip.key} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {chip.label}: <span className="text-foreground">{String(data[chip.key])}</span>
            </span>
          ))}
          {doc.tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded bg-primary/10 py-0.5 pl-1.5 pr-1 text-primary">
              #{tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onSetTags(doc.tags.filter((t) => t !== tag))}
                className="cursor-pointer opacity-60 hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {tagDraft === null ? (
            <button
              type="button"
              onClick={() => setTagDraft('')}
              className="flex cursor-pointer items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
            >
              <Plus size={10} /> Tag
            </button>
          ) : (
            <input
              autoFocus
              value={tagDraft}
              aria-label="New tag"
              placeholder="tag, tag…"
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTags()
                if (event.key === 'Escape') setTagDraft(null)
              }}
              className="w-28 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground outline-none ring-1 ring-border focus:ring-primary"
            />
          )}
          {!doc.edited_at && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              Only the generated header so far
            </span>
          )}
          {overdue && (
            <button
              type="button"
              onClick={onMarkReviewed}
              className="flex cursor-pointer items-center gap-1 rounded bg-[var(--status-pending,#e3b341)]/15 px-1.5 py-0.5 text-[var(--status-pending,#e3b341)]"
            >
              <Clock size={10} /> Due for review — mark as reviewed
            </button>
          )}
          {drifted && (
            <span className="flex items-center gap-1 rounded bg-[var(--status-pending,#e3b341)]/15 px-1.5 py-0.5 text-[var(--status-pending,#e3b341)]">
              <RefreshCw size={10} /> The device has changed
            </span>
          )}
        </div>

        <Markdown
          body={doc.body}
          docs={docs}
          devices={devices}
          onOpenDoc={onOpenDoc}
          onCreateFromLink={onCreateFromLink}
          onToggleTask={onToggleTask}
          className="max-w-[72ch] px-6 pb-6 pt-2 text-sm"
        />

        {/* A wiki-link only says where it goes; this is the other direction,
            and the reason a device document is worth linking to at all. */}
        {!backlinksLoading && backlinks.length > 0 && (
          <section aria-labelledby="backlinks-heading" className="max-w-[72ch] px-6 pb-16">
            <h2
              id="backlinks-heading"
              className="mb-2 flex items-center gap-1.5 border-t border-border pt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
            >
              <Link2 size={11} /> Linked from ({backlinks.length})
            </h2>
            <ul className="space-y-1">
              {backlinks.map((link) => (
                <li key={link.doc_id}>
                  <button
                    type="button"
                    onClick={() => onOpenDoc(link.doc_id)}
                    className="w-full cursor-pointer rounded px-2 py-1.5 text-left hover:bg-muted/60"
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-xs text-primary">{link.title}</span>
                      {link.count > 1 && (
                        <span className="text-[10px] text-muted-foreground">×{link.count}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {link.context}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {controls.open ? (
        <DocHistoryRail
          revisions={controls.revisions}
          activeId={null}
          loading={controls.loading}
          onSelect={controls.onSelect}
          onClose={controls.onToggle}
        />
      ) : (
        toc.length > 1 && (
        <nav aria-label="On this page" className="hidden w-52 shrink-0 overflow-y-auto border-l border-border px-3 py-5 xl:block">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            On this page
          </p>
          {toc.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              style={{ paddingLeft: (entry.level - 2) * 10 }}
              className="block truncate py-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {entry.text}
            </a>
          ))}
          </nav>
        )
      )}
    </div>
  )
}
