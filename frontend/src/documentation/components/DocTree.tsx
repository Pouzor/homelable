import { ChevronDown, ChevronRight, File, FileText, Folder, FolderOpen, Star } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { DocState, TreeGroup, TreeLeaf } from '../types'

/**
 * The navigator.
 *
 * Two roots with different natures: Devices is a pivot recomputed from the
 * inventory whenever the grouping changes, Library is the real folder tree the
 * user files by hand. They share this renderer so both feel like one tree.
 */

const STATE_TITLE: Record<DocState, string> = {
  none: 'No document yet',
  'header-only': 'Only the generated header — nothing written yet',
  written: 'Documented',
  drifted: 'The device changed since this was written',
  overdue: 'Due for review',
}

const STATE_CLASS: Record<DocState, string> = {
  none: 'bg-muted-foreground/30',
  'header-only': 'bg-muted-foreground/60 ring-1 ring-inset ring-background',
  written: 'bg-[var(--status-online,#39d353)]',
  drifted: 'bg-[var(--status-pending,#e3b341)]',
  overdue: 'bg-[var(--status-pending,#e3b341)]',
}

export function DocStateDot({ state }: { state: DocState }) {
  return (
    <span
      aria-label={STATE_TITLE[state]}
      title={STATE_TITLE[state]}
      className={cn('size-1.5 shrink-0 rounded-full', STATE_CLASS[state])}
    />
  )
}

interface ItemProps {
  leaf: TreeLeaf
  depth: number
  activeId: string | null
  expanded: string[]
  starred: Set<string>
  onSelect: (leaf: TreeLeaf) => void
  onToggle: (key: string) => void
}

export function DocTreeItem({ leaf, depth, activeId, expanded, starred, onSelect, onToggle }: ItemProps) {
  const isFolder = leaf.kind === 'folder'
  const isOpen = expanded.includes(leaf.id)
  const active = activeId !== null && leaf.docId === activeId
  const Icon = isFolder ? (isOpen ? FolderOpen : Folder) : leaf.docId ? FileText : File

  return (
    <>
      <button
        type="button"
        onClick={() => (isFolder ? onToggle(leaf.id) : onSelect(leaf))}
        onDoubleClick={() => isFolder && onSelect(leaf)}
        aria-current={active ? 'page' : undefined}
        aria-expanded={isFolder ? isOpen : undefined}
        style={{ paddingLeft: 8 + depth * 12 }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-1.5 rounded py-1 pr-2 text-left text-xs',
          active ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          !leaf.docId && !isFolder && 'italic',
        )}
      >
        {isFolder ? (
          isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon size={13} className="shrink-0 opacity-70" />
        <span className="truncate">{leaf.label}</span>
        {leaf.docId && starred.has(leaf.docId) && (
          <Star size={11} className="shrink-0 fill-current text-[var(--accent-orange,#ff6e00)]" />
        )}
        <span className="ml-auto pl-1">
          <DocStateDot state={leaf.state} />
        </span>
      </button>
      {isFolder &&
        isOpen &&
        (leaf.children ?? []).map((child) => (
          <DocTreeItem
            key={child.id}
            leaf={child}
            depth={depth + 1}
            activeId={activeId}
            expanded={expanded}
            starred={starred}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

interface GroupsProps {
  groups: TreeGroup[]
  activeId: string | null
  expanded: string[]
  starred: Set<string>
  onSelect: (leaf: TreeLeaf) => void
  onToggle: (key: string) => void
}

export function DocTreeGroups({ groups, activeId, expanded, starred, onSelect, onToggle }: GroupsProps) {
  if (groups.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground/60">No devices to document yet.</p>
  }
  return (
    <>
      {groups.map((group) => {
        // Collapsed is opt-in: a fresh pivot shows everything, so the user can
        // see the shape they just asked for without expanding anything.
        const collapsed = expanded.includes(`collapsed:${group.key}`)
        return (
          <div key={group.key}>
            <button
              type="button"
              onClick={() => onToggle(`collapsed:${group.key}`)}
              aria-expanded={!collapsed}
              className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-1 bg-background/95 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 backdrop-blur"
            >
              {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              <span className="truncate">{group.label}</span>
              <span className="ml-auto tabular-nums opacity-60">{group.items.length}</span>
            </button>
            {!collapsed &&
              group.items.map((leaf) => (
                <DocTreeItem
                  key={`${group.key}:${leaf.id}`}
                  leaf={leaf}
                  depth={1}
                  activeId={activeId}
                  expanded={expanded}
                  starred={starred}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              ))}
          </div>
        )
      })}
    </>
  )
}
