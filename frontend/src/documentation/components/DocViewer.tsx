import { useMemo } from 'react'
import { Clock, Pencil, RefreshCw, Star, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isOverdue, parseFrontmatter } from '../frontmatter'
import { Markdown } from '../markdown/Markdown'
import { extractToc } from '../markdown/toc'
import type { Doc } from '../types'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'

interface Props {
  doc: Doc
  docs: LinkableDoc[]
  devices: LinkableDevice[]
  drifted: boolean
  onEdit: () => void
  onToggleStar: () => void
  onMarkReviewed: () => void
  onDelete: () => void
  onOpenDoc: (id: string) => void
  onCreateFromLink: (label: string) => void
  onToggleTask: (body: string) => void
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
  onEdit,
  onToggleStar,
  onMarkReviewed,
  onDelete,
  onOpenDoc,
  onCreateFromLink,
  onToggleTask,
}: Props) {
  const { data } = useMemo(() => parseFrontmatter(doc.body), [doc.body])
  const toc = useMemo(() => extractToc(doc.body), [doc.body])
  const overdue = isOverdue(data, doc.reviewed_at, doc.created_at)

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
            <span key={tag} className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
              #{tag}
            </span>
          ))}
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
          className="max-w-[72ch] px-6 pb-16 pt-2 text-sm"
        />
      </div>

      {toc.length > 1 && (
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
      )}
    </div>
  )
}
