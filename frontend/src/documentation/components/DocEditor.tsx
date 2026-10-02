import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Italic, Link2, List, ListChecks, Save, Table, X } from 'lucide-react'
import { toast } from 'sonner'

import { documentsApi, mediaApi } from '@/api/client'
import { caretPoint, placeMenu, type CaretPoint, type Placement } from '@/documentation/caret'
import { useDocHistory } from '@/documentation/history'
import { IMAGE_TYPES, LINKED_TYPES, isSupportedMedia, mediaMarkdown, supportedLabel, uploadError } from '@/documentation/media'
import { Button } from '@/components/ui/button'
import { t, useLocale } from '@/i18n'
import { cn } from '@/lib/utils'
import { Markdown } from '../markdown/Markdown'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'
import { EditorMenu, type EditorMenuItem } from './EditorMenu'

/**
 * Source on the left, rendered on the right.
 *
 * Markdown source rather than a rich editor on purpose: the body is exported
 * to disk verbatim, so what the user types is what the file holds — no
 * round-trip through another representation that could reformat it.
 */

export interface SlashCommand {
  id: string
  label: string
  hint: string
  /** Resolved when chosen; async because a generated block is fetched. */
  insert: () => string | Promise<string>
}

interface Props {
  body: string
  onChange: (body: string) => void
  onSave: () => void
  onCancel: () => void
  dirty: boolean
  saving: boolean
  /** Set when the document describes a device — enables the generated blocks. */
  deviceId?: string | null
  /** The document being edited, so `[[` does not offer a link to itself. */
  currentDocId?: string | null
  docs?: LinkableDoc[]
  devices?: LinkableDevice[]
}

export function DocEditor({
  body,
  onChange,
  onSave,
  onCancel,
  dirty,
  saving,
  deviceId,
  currentDocId,
  docs = [],
  devices = [],
}: Props) {
  useLocale()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const caretRef = useRef<CaretPoint | null>(null)
  // Where the `/` that opened the menu sits in the body. Recorded on the way in
  // because the menu takes focus, which leaves the textarea's own selection
  // pointing wherever it happened to be when it lost focus.
  const slashIndex = useRef<number | null>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [inserting, setInserting] = useState(false)
  // The `[[` picker. Same machinery as the slash menu, anchored on the first
  // of the two brackets, because both of them are replaced by the finished link.
  const linkIndex = useRef<number | null>(null)
  const linkMenu = useRef<HTMLDivElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkAt, setLinkAt] = useState<Placement | null>(null)
  // Null until measured: the menu is rendered to be measured, and placing it
  // needs its height, so the first paint would otherwise flash at 0,0.
  const [slashAt, setSlashAt] = useState<Placement | null>(null)

  const history = useDocHistory({ body, onChange, textarea })

  // Both menus are built inside the component so their hints go through `t`; a
  // module-level table would be created once at import, before the locale is
  // known. The labels are the literal commands the user types, so they stay
  // untranslated.
  const commands = useMemo<SlashCommand[]>(() => {
    const generatedBlocks: { id: string; label: string; hint: string; block: string }[] = [
      { id: 'device', label: '/device', hint: t('Device Information table, from the current facts'), block: 'device-info' },
      { id: 'services', label: '/services', hint: t('One section per fingerprinted service'), block: 'services' },
      { id: 'hardware', label: '/hardware', hint: t('CPU, RAM and disk'), block: 'hardware' },
      { id: 'network', label: '/network', hint: t('Subnet, neighbours, exposure'), block: 'network' },
      { id: 'rack', label: '/rack', hint: t('Rack and zone placement'), block: 'rack' },
      { id: 'properties', label: '/properties', hint: t('The device custom properties'), block: 'properties' },
    ]
    const plainSnippets: SlashCommand[] = [
      { id: 'table', label: '/table', hint: t('An empty three-column table'), insert: () => '| | | |\n|---|---|---|\n| | | |\n' },
      { id: 'task', label: '/task', hint: t('A checklist'), insert: () => '- [ ] \n- [ ] \n' },
      { id: 'callout', label: '/callout', hint: t('A highlighted note'), insert: () => '> [!note]\n> \n' },
      { id: 'link', label: '/link', hint: t('A link to another document'), insert: () => '[[doc:]]' },
      { id: 'device-link', label: '/device-link', hint: t('A link to a device document'), insert: () => '[[device:]]' },
      { id: 'date', label: '/date', hint: t("Today's date"), insert: () => new Date().toISOString().slice(0, 10) },
    ]
    const generated: SlashCommand[] = deviceId
      ? generatedBlocks.map((entry) => ({
          id: entry.id,
          label: entry.label,
          hint: entry.hint,
          insert: async () => {
            const { data } = await documentsApi.block(entry.block, deviceId)
            return `${data.markdown}\n`
          },
        }))
      : []
    // These insert nothing themselves: they take the `/` away and open the
    // file dialog, and the picked file lands at the caret once it is uploaded.
    // One input serves both, narrowed to what the command is for.
    const pick = (types: string[]) => () => {
      const input = fileInput.current
      if (input) {
        input.accept = types.join(',')
        input.click()
      }
      return ''
    }
    const uploads: SlashCommand[] = [
      { id: 'image', label: '/image', hint: t('Upload an image — or drop or paste one'), insert: pick(IMAGE_TYPES) },
      { id: 'pdf', label: '/pdf', hint: t('Upload a PDF, inserted as a link'), insert: pick(LINKED_TYPES) },
    ]
    return [...generated, ...plainSnippets, ...uploads]
  }, [deviceId])

  const visible = useMemo(() => {
    const needle = slashQuery.toLowerCase()
    return needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands
  }, [commands, slashQuery])

  /**
   * What `[[` can point at: the documents that exist.
   *
   * Only documents, deliberately. A device with no document is not a link
   * target yet — writing `[[device:nas-01]]` at one would render red — and
   * creating a document from inside an unsaved editor is a different feature.
   * A device that *is* documented is in this list through its document.
   *
   * The text inserted is the title when no other document shares it, and
   * `[[doc:<id>]]` when one does: a bare link resolves by title, so an
   * ambiguous one would silently point at whichever came first.
   */
  const linkTargets = useMemo<(EditorMenuItem & { text: string })[]>(() => {
    const byTitle = new Map<string, number>()
    for (const doc of docs) {
      const key = doc.title.toLowerCase()
      byTitle.set(key, (byTitle.get(key) ?? 0) + 1)
    }
    const deviceLabels = new Map(devices.map((device) => [device.id, device.label]))
    return docs.filter((doc) => doc.id !== currentDocId).map((doc) => {
      const unique = (byTitle.get(doc.title.toLowerCase()) ?? 0) < 2
      const device = doc.device_id ? deviceLabels.get(doc.device_id) : undefined
      return {
        id: doc.id,
        label: doc.title,
        hint: device ? t('Device · {device}', { device }) : doc.slug,
        text: unique ? `[[${doc.title}]]` : `[[doc:${doc.id}]]`,
      }
    })
  }, [docs, devices, currentDocId])

  const linkVisible = useMemo(() => {
    const needle = linkQuery.trim().toLowerCase()
    if (!needle) return linkTargets.slice(0, 50)
    return linkTargets
      .filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(needle))
      .slice(0, 50)
  }, [linkTargets, linkQuery])

  /**
   * Insert `text`, either at the live caret or over the `/` at `replacing`.
   *
   * The `/` is the only thing the slash menu ever put in the document — the
   * query was typed into the menu's own field — so replacing it consumes
   * exactly that one character; the `[[` picker passes 2 for its two brackets.
   * The index is passed in rather than read from the textarea:
   * opening the menu moves focus, which freezes the textarea's selection
   * wherever it happened to be, and every later keystroke widens the gap.
   */
  const insertAtCursor = useCallback(
    (text: string, replacing: number | null, replacedLength = 1) => {
      const el = textarea.current
      if (!el) return
      const start = replacing ?? el.selectionStart
      const end = replacing === null ? el.selectionEnd : Math.min(replacing + replacedLength, body.length)
      const next = `${body.slice(0, start)}${text}${body.slice(end)}`
      history.record('edit')
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        const caret = start + text.length
        el.setSelectionRange(caret, caret)
      })
    },
    [body, history, onChange],
  )

  // An upload outlives the render that started it. Inserting through the
  // callback captured back then would write over a stale body and lose
  // whatever was typed while the file was on its way.
  const insertLatest = useRef(insertAtCursor)
  useEffect(() => {
    insertLatest.current = insertAtCursor
  }, [insertAtCursor])

  /** Upload `files` and write their markdown at the caret. */
  const uploadFiles = useCallback(async (files: File[]) => {
    const accepted = files.filter(isSupportedMedia)
    if (accepted.length < files.length) toast.error(t('Only {formats} can go in a document', { formats: supportedLabel() }))
    if (accepted.length === 0) return
    setInserting(true)
    const uploaded: string[] = []
    try {
      for (const file of accepted) {
        const { url } = await mediaApi.upload(file)
        uploaded.push(mediaMarkdown(file, url))
      }
    } catch (error) {
      toast.error(uploadError(error))
    } finally {
      // What made it up is inserted even when a later file failed: it is on
      // the server either way, and unreferenced it would only be an orphan.
      if (uploaded.length > 0) insertLatest.current(uploaded.join('\n'), null)
      setInserting(false)
    }
  }, [])

  const runCommand = useCallback(
    async (command: SlashCommand) => {
      // Read before the await: closing the menu lets the reset effect run.
      const slash = slashIndex.current
      setSlashOpen(false)
      setInserting(true)
      try {
        insertAtCursor(await command.insert(), slash)
      } finally {
        setInserting(false)
        setSlashQuery('')
      }
    },
    [insertAtCursor],
  )

  const runLink = useCallback(
    (item: EditorMenuItem) => {
      const target = linkTargets.find((entry) => entry.id === item.id)
      // Read before closing: the reset effect clears the index.
      const at = linkIndex.current
      setLinkOpen(false)
      setLinkQuery('')
      if (target) insertAtCursor(target.text, at)
    },
    [insertAtCursor, linkTargets],
  )

  /** Close without picking, giving back the bracket the menu held. */
  const cancelLink = useCallback(() => {
    const at = linkIndex.current
    setLinkOpen(false)
    setLinkQuery('')
    if (at !== null) insertAtCursor('[[', at)
  }, [insertAtCursor])

  const wrapSelection = useCallback(
    (before: string, after = before) => {
      const el = textarea.current
      if (!el) return
      const { selectionStart: start, selectionEnd: end } = el
      const selected = body.slice(start, end)
      const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`
      history.record('edit')
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + before.length, end + before.length)
      })
    },
    [body, history, onChange],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      onSave()
      return
    }
    // The editor's own history, not the browser's: a controlled textarea loses
    // the native stack to every programmatic insertion. Always swallowed, so
    // the canvas' undo cannot fire on a document instead.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) history.redo()
      else history.undo()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      history.redo()
      return
    }
    if (event.key === 'Escape') {
      if (slashOpen || linkOpen) {
        event.preventDefault()
        setSlashOpen(false)
        if (linkOpen) cancelLink()
        return
      }
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === '[') {
      const el = event.currentTarget
      // Typing over a selection replaces it; that is not an opening bracket.
      if (el.selectionStart !== el.selectionEnd) return
      if (!body.slice(0, el.selectionStart).endsWith('[')) return
      // The second bracket is swallowed on purpose. Opening the menu moves
      // focus to its filter field, and a character typed as focus moves is not
      // reliably delivered to either box — so the body is left holding exactly
      // one `[`, which is what the insertion replaces. Cancelling puts the
      // second one back, so what the user typed survives either way.
      event.preventDefault()
      caretRef.current = caretPoint(el, el.selectionStart)
      linkIndex.current = el.selectionStart - 1
      setSlashOpen(false)
      setLinkOpen(true)
      setLinkQuery('')
      return
    }
    if (event.key === '/') {
      const el = event.currentTarget
      const before = body.slice(0, el.selectionStart)
      // Only at the start of a line — mid-sentence a slash is just a slash.
      if (before === '' || before.endsWith('\n')) {
        // Measure before React re-renders: the caret is where the `/` is about
        // to land, which is where it is now.
        caretRef.current = caretPoint(el, el.selectionStart)
        slashIndex.current = el.selectionStart
        setSlashOpen(true)
        setSlashQuery('')
      }
    }
  }

  useEffect(() => {
    if (!slashOpen) {
      setSlashQuery('')
      setSlashAt(null)
      slashIndex.current = null
    }
  }, [slashOpen])

  useEffect(() => {
    if (!linkOpen) {
      setLinkQuery('')
      setLinkAt(null)
      linkIndex.current = null
    }
  }, [linkOpen])

  useEffect(() => {
    if (!linkOpen) return
    const caret = caretRef.current
    const paneEl = pane.current
    const menuEl = linkMenu.current
    if (!caret || !paneEl || !menuEl) return
    setLinkAt(
      placeMenu({
        caret,
        pane: { width: paneEl.clientWidth, height: paneEl.clientHeight },
        menu: { width: menuEl.offsetWidth, height: menuEl.offsetHeight },
      }),
    )
  }, [linkOpen, linkVisible.length])

  // Place the menu once it (and the filtered list) have a height. Re-runs as the
  // query narrows the list, so a menu that shrank stops hanging off the bottom.
  useEffect(() => {
    if (!slashOpen) return
    const caret = caretRef.current
    const paneEl = pane.current
    const menuEl = menu.current
    if (!caret || !paneEl || !menuEl) return
    setSlashAt(
      placeMenu({
        caret,
        pane: { width: paneEl.clientWidth, height: paneEl.clientHeight },
        menu: { width: menuEl.offsetWidth, height: menuEl.offsetHeight },
      }),
    )
  }, [slashOpen, visible.length])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <Button size="icon-xs" variant="ghost" title={t('Bold')} onClick={() => wrapSelection('**')}>
          <Bold />
        </Button>
        <Button size="icon-xs" variant="ghost" title={t('Italic')} onClick={() => wrapSelection('_')}>
          <Italic />
        </Button>
        <Button size="icon-xs" variant="ghost" title={t('Bullet list')} onClick={() => insertAtCursor('\n- ', null)}>
          <List />
        </Button>
        <Button size="icon-xs" variant="ghost" title={t('Checklist')} onClick={() => insertAtCursor('\n- [ ] ', null)}>
          <ListChecks />
        </Button>
        <Button size="icon-xs" variant="ghost" title={t('Table')} onClick={() => insertAtCursor('\n| | |\n|---|---|\n| | |\n', null)}>
          <Table />
        </Button>
        <Button size="icon-xs" variant="ghost" title={t('Link to a document')} onClick={() => insertAtCursor('[[doc:]]', null)}>
          <Link2 />
        </Button>
        <span className="ml-2 text-[10px] text-muted-foreground/70">
          <kbd className="rounded border border-border px-1">/</kbd> {t('on a new line to insert')},{' '}
          <kbd className="rounded border border-border px-1">[[</kbd> {t('to link')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[10px] text-muted-foreground">{t('Unsaved')}</span>}
          <Button size="sm" variant="ghost" onClick={onCancel} className="cursor-pointer gap-1">
            <X size={13} /> {t('Cancel')}
          </Button>
          <Button size="sm" onClick={onSave} disabled={!dirty || saving} className="cursor-pointer gap-1">
            <Save size={13} /> {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <div ref={pane} className="relative min-h-0 overflow-hidden border-r border-border">
          <textarea
            ref={textarea}
            value={body}
            aria-label={t('Document source')}
            spellCheck={false}
            onChange={(event) => {
              history.record('type')
              onChange(event.target.value)
            }}
            onKeyDown={handleKeyDown}
            onDragOver={(event) => {
              // Without this the browser navigates to the dropped file.
              if (event.dataTransfer.types.includes('Files')) event.preventDefault()
            }}
            onDrop={(event) => {
              const files = Array.from(event.dataTransfer.files)
              if (files.length === 0) return
              event.preventDefault()
              void uploadFiles(files)
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              // A spreadsheet or a word processor copies a picture of the
              // selection beside its text; the text is what was meant.
              if (files.length === 0 || event.clipboardData.getData('text/plain')) return
              event.preventDefault()
              void uploadFiles(files)
            }}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            aria-label={t('Upload a file')}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              // Cleared so picking the same file twice in a row still fires.
              event.target.value = ''
              void uploadFiles(files)
            }}
          />
          {slashOpen && (
            <EditorMenu
              items={visible}
              query={slashQuery}
              onQuery={setSlashQuery}
              placeholder={t('Insert…')}
              ariaLabel={t('Insert a block')}
              emptyText={t('Nothing matches.')}
              at={slashAt}
              menuRef={menu}
              monoLabels
              onPick={(item) => {
                const command = commands.find((entry) => entry.id === item.id)
                if (command) void runCommand(command)
              }}
              onClose={() => setSlashOpen(false)}
            />
          )}
          {linkOpen && (
            <EditorMenu
              items={linkVisible}
              query={linkQuery}
              onQuery={setLinkQuery}
              placeholder={t('Link to…')}
              ariaLabel={t('Link to a document')}
              emptyText={t('No document to link to yet.')}
              at={linkAt}
              menuRef={linkMenu}
              onPick={runLink}
              onClose={cancelLink}
            />
          )}
          {inserting && (
            <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground">{t('Inserting…')}</span>
          )}
        </div>
        <div className={cn('min-h-0 overflow-y-auto p-4 text-sm', 'hidden lg:block')}>
          <Markdown body={body} docs={docs} devices={devices} className="max-w-[72ch]" />
        </div>
      </div>
    </div>
  )
}
