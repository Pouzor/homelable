import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, FilePlus, FolderPlus, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { scanApi } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCanvasStore } from '@/stores/canvasStore'
import { useDesignStore } from '@/stores/designStore'
import type { InventoryEntry } from '@/types'
import { cn } from '@/lib/utils'
import { isOverdue } from '../frontmatter'
import { driftedIds, useDocsStore } from '../store'
import {
  buildDeviceTree,
  buildLibraryTree,
  canMoveInto,
  deviceLabel,
  filterGroups,
  filterTree,
} from '../tree'
import { GROUP_BY_LABELS, type GroupBy, type TreeLeaf } from '../types'
import { DocEditor } from './DocEditor'
import { DocTreeGroups, DocTreeItem, type TreeDnd } from './DocTree'
import { DocViewer } from './DocViewer'
import { MigrateNotesBanner } from './MigrateNotesBanner'
import { NewDocMenu } from './NewDocMenu'
import { RegenerateDocModal } from './RegenerateDocModal'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

const GROUP_OPTIONS = Object.keys(GROUP_BY_LABELS) as GroupBy[]

/**
 * The Documentation section.
 *
 * The first part of the app that is not about one canvas: a device is
 * documented once and reads the same wherever it is drawn, so this view sits
 * beside the canvas rather than inside a design.
 */
export function DocumentationView() {
  const {
    docs,
    loaded,
    loadDocs,
    openDoc,
    open,
    draft,
    dirty,
    saving,
    pendingDraft,
    startEdit,
    setDraft,
    cancelEdit,
    save,
    acceptPendingDraft,
    discardPendingDraft,
    create,
    move,
    remove,
    toggleStar,
    markReviewed,
    setTags,
    regenerate,
    coverage,
    loadCoverage,
    scaffold,
    groupBy,
    setGroupBy,
    expanded,
    toggleExpanded,
    setExpanded,
    treeWidth,
    setTreeWidth,
    filter,
    setFilter,
  } = useDocsStore()

  const designs = useDesignStore((s) => s.designs)
  const activeDesignId = useDesignStore((s) => s.activeDesignId)
  const nodes = useCanvasStore((s) => s.nodes)

  const [devices, setDevices] = useState<InventoryEntry[]>([])
  const [libraryOpen, setLibraryOpen] = useState(true)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    void loadDocs()
    void loadCoverage()
    if (STANDALONE) return
    scanApi
      .pending()
      .then((res) => setDevices(res.data as InventoryEntry[]))
      // The tree still renders the Library without the inventory.
      .catch(() => setDevices([]))
  }, [loadDocs, loadCoverage])

  // `review_every` rides along on the summary, so the badge needs no bodies.
  const overdue = useMemo(
    () =>
      new Set(
        docs
          .filter((doc) => isOverdue(doc.frontmatter ?? {}, doc.reviewed_at, doc.created_at))
          .map((doc) => doc.id),
      ),
    [docs],
  )

  const drifted = useMemo(() => driftedIds(docs), [docs])

  const deviceGroups = useMemo(
    () =>
      filterGroups(
        buildDeviceTree({
          groupBy,
          devices,
          docs,
          context: { nodes, designs, activeDesignId, ranges: [] },
          drifted,
          overdue,
        }),
        filter,
      ),
    [activeDesignId, designs, devices, docs, drifted, filter, groupBy, nodes, overdue],
  )

  const libraryItems = useMemo(() => filterTree(buildLibraryTree(docs), filter), [docs, filter])
  const starred = useMemo(() => new Set(docs.filter((d) => d.starred).map((d) => d.id)), [docs])
  const linkableDevices = useMemo(
    () => devices.map((d) => ({ id: d.id, label: deviceLabel(d) })),
    [devices],
  )

  const handleSelect = useCallback(
    async (leaf: TreeLeaf) => {
      if (dirty && !window.confirm('Discard the unsaved changes to this document?')) return
      if (leaf.docId) {
        await open(leaf.docId)
        return
      }
      if (!leaf.deviceId) return
      const device = devices.find((d) => d.id === leaf.deviceId)
      const doc = await create({
        title: device ? deviceLabel(device) : leaf.label,
        kind: 'device',
        deviceId: leaf.deviceId,
      })
      if (doc) {
        await open(doc.id)
        toast.success('Document created from the device facts')
      }
    },
    [create, devices, dirty, open],
  )

  // Filing by drag. The confirmation is the point — a document that moves
  // because a pointer slipped is worse than one nobody filed.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [rootOver, setRootOver] = useState(false)

  const dragged = useMemo(
    () => (draggingId ? (docs.find((d) => d.id === draggingId) ?? null) : null),
    [docs, draggingId],
  )

  const allowDrop = useCallback(
    (targetId: string | null) => (dragged ? canMoveInto(docs, dragged, targetId) : false),
    [docs, dragged],
  )

  const handleDrop = useCallback(
    async (targetId: string | null) => {
      const doc = dragged
      setDraggingId(null)
      setOverId(null)
      setRootOver(false)
      if (!doc || !canMoveInto(docs, doc, targetId)) return
      const target = targetId ? docs.find((d) => d.id === targetId) : null
      if (targetId && !target) return
      const question = target
        ? `Move \u201c${doc.title}\u201d into \u201c${target.title}\u201d?`
        : `Move \u201c${doc.title}\u201d out to the top of the Library?`
      if (!window.confirm(question)) return
      try {
        await move(doc.id, targetId)
        // Land somewhere the user can see: a closed folder would swallow it.
        if (targetId && !expanded.includes(targetId)) setExpanded([...expanded, targetId])
        toast.success(target ? `Moved into \u201c${target.title}\u201d` : 'Moved to the top of the Library')
      } catch {
        toast.error('Could not move that document')
      }
    },
    [docs, dragged, expanded, move, setExpanded],
  )

  const dnd: TreeDnd = useMemo(
    () => ({
      draggingId,
      overId,
      canDrop: allowDrop,
      onDragStart: (leaf) => setDraggingId(leaf.docId ?? null),
      onDragEnd: () => {
        setDraggingId(null)
        setOverId(null)
        setRootOver(false)
      },
      onDragOver: setOverId,
      onDrop: (targetId) => void handleDrop(targetId),
    }),
    [allowDrop, draggingId, handleDrop, overId],
  )

  const handleSave = useCallback(async () => {
    if (await save()) toast.success('Saved')
  }, [save])

  const handleDelete = useCallback(async () => {
    if (!openDoc) return
    if (!window.confirm(`Delete “${openDoc.title}”? Its history goes with it.`)) return
    await remove(openDoc.id)
    toast.success('Document deleted')
  }, [openDoc, remove])

  const handleRegenerate = useCallback(async () => {
    if (!openDoc) return
    setRegenerating(true)
    const ok = await regenerate(openDoc.id)
    setRegenerating(false)
    if (!ok) {
      toast.error('Could not regenerate that document')
      return
    }
    setRegenerateOpen(false)
    toast.success('Document regenerated — the old body is in its history')
  }, [openDoc, regenerate])

  const handleMigrate = useCallback(async () => {
    const created = await scaffold({ onlyWithNotes: true })
    await loadDocs()
    toast.success(created === 1 ? '1 note became a document' : `${created} notes became documents`)
  }, [loadDocs, scaffold])

  // Drag-to-resize the tree pane. Width lives in localStorage, per viewer.
  const dragging = useRef(false)
  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!dragging.current) return
      setTreeWidth(Math.min(520, Math.max(180, event.clientX - 48)))
    }
    const up = () => {
      dragging.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [setTreeWidth])

  if (STANDALONE) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <BookOpen className="mx-auto mb-3 opacity-40" size={28} />
          <h2 className="mb-1 text-sm font-semibold">Documentation needs the backend</h2>
          <p className="text-xs text-muted-foreground">
            Standalone mode keeps canvases in the browser and has nowhere to store documents or
            search them. Run Homelable with its API to use this section.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        style={{ width: treeWidth }}
        className="flex min-h-0 shrink-0 flex-col border-r border-border"
      >
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
          <label htmlFor="docs-group-by" className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Group by
          </label>
          <select
            id="docs-group-by"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
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
          <div className="flex items-center gap-0.5 px-2 pb-1 pt-1">
            <button
              type="button"
              onClick={() => setLibraryOpen((value) => !value)}
              aria-expanded={libraryOpen}
              className="flex flex-1 cursor-pointer items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50"
            >
              {libraryOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Library
            </button>
            <NewDocMenu
              placement="down"
              onCreate={async (input) => {
                const doc = await create(input)
                if (doc) await open(doc.id)
              }}
              trigger={
                <Button size="icon-xs" variant="ghost" aria-label="New document" title="New document">
                  <FilePlus />
                </Button>
              }
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="New folder"
              title="New folder"
              onClick={async () => {
                const title = window.prompt('Folder name')
                if (title?.trim()) await create({ title: title.trim(), kind: 'folder' })
              }}
            >
              <FolderPlus />
            </Button>
          </div>

          {/* Dropping on the empty space around the Library files a document at
              its top level — the only way back out of a folder. */}
          <div
            onDragOver={(event) => {
              if (!allowDrop(null)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setRootOver(true)
            }}
            onDragLeave={() => setRootOver(false)}
            onDrop={(event) => {
              if (!allowDrop(null)) return
              event.preventDefault()
              void handleDrop(null)
            }}
            className={cn(
              'min-h-6 rounded',
              rootOver && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
            )}
          >
            {libraryOpen &&
              libraryItems.map((leaf) => (
                <DocTreeItem
                  key={leaf.id}
                  leaf={leaf}
                  depth={1}
                  activeId={openDoc?.id ?? null}
                  expanded={expanded}
                  starred={starred}
                  onSelect={(item) => void handleSelect(item)}
                  onToggle={toggleExpanded}
                  dnd={dnd}
                />
              ))}
            {libraryOpen && libraryItems.length === 0 && (
              <p className="px-3 py-1 text-xs text-muted-foreground/60">
                Nothing here yet — runbooks and overviews live in the Library.
              </p>
            )}
          </div>

          <p className="mt-3 px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
            Devices
          </p>
          <DocTreeGroups
            groups={deviceGroups}
            activeId={openDoc?.id ?? null}
            expanded={expanded}
            starred={starred}
            onSelect={(leaf) => void handleSelect(leaf)}
            onToggle={toggleExpanded}
          />
        </div>

        {coverage && (
          <div className="flex items-center border-t border-border px-2 py-1.5">
            <span
              className="ml-auto text-[10px] tabular-nums text-muted-foreground/70"
              title={`${coverage.documented} of ${coverage.devices} devices documented · ${coverage.header_only} still only the generated header`}
            >
              {coverage.documented}/{coverage.devices}
            </span>
          </div>
        )}
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the document tree"
        onMouseDown={() => {
          dragging.current = true
        }}
        className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/30"
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {coverage && coverage.notes_unmigrated > 0 && (
          <MigrateNotesBanner count={coverage.notes_unmigrated} onMigrate={() => void handleMigrate()} />
        )}

        {pendingDraft !== null && (
          <div className="flex items-center gap-2 border-b border-border bg-[var(--status-pending,#e3b341)]/10 px-4 py-1.5 text-xs">
            <span className="text-[var(--status-pending,#e3b341)]">
              Unsaved changes from a previous session were found.
            </span>
            <Button size="xs" variant="secondary" className="cursor-pointer" onClick={acceptPendingDraft}>
              Restore them
            </Button>
            <Button size="xs" variant="ghost" className="cursor-pointer" onClick={discardPendingDraft}>
              Discard
            </Button>
          </div>
        )}

        {!openDoc && (
          <div className={cn('flex flex-1 items-center justify-center p-8 text-center')}>
            <div className="max-w-sm">
              <BookOpen className="mx-auto mb-3 opacity-30" size={26} />
              <p className="text-sm font-medium">
                {loaded && docs.length === 0 ? 'Nothing is documented yet' : 'Pick a document'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Selecting a device with no document creates one from its scanned facts, filled in
                for you and yours to maintain from there.
              </p>
            </div>
          </div>
        )}

        {openDoc && draft === null && (
          <DocViewer
            doc={openDoc}
            docs={docs}
            devices={linkableDevices}
            drifted={openDoc.drifted ?? false}
            onEdit={startEdit}
            onToggleStar={() => void toggleStar(openDoc.id)}
            onMarkReviewed={() => void markReviewed(openDoc.id)}
            onSetTags={(tags) => void setTags(tags)}
            onRegenerate={() => setRegenerateOpen(true)}
            onDelete={() => void handleDelete()}
            onOpenDoc={(id) => void open(id)}
            onCreateFromLink={async (label) => {
              const doc = await create({ title: label })
              if (doc) await open(doc.id)
            }}
            onToggleTask={(body) => {
              // A checkbox is an edit like any other: it goes through the draft
              // so it is saved explicitly, never behind the user's back.
              startEdit()
              setDraft(body)
            }}
          />
        )}

        {openDoc && draft !== null && (
          <DocEditor
            body={draft}
            onChange={setDraft}
            onSave={() => void handleSave()}
            onCancel={cancelEdit}
            dirty={dirty}
            saving={saving}
            deviceId={openDoc.device_id}
            docs={docs}
            devices={linkableDevices}
          />
        )}

        <RegenerateDocModal
          open={regenerateOpen && openDoc !== null}
          title={openDoc?.title ?? ''}
          fromDevice={Boolean(openDoc?.device_id)}
          busy={regenerating}
          onCancel={() => setRegenerateOpen(false)}
          onConfirm={() => void handleRegenerate()}
        />
      </div>
    </div>
  )
}
