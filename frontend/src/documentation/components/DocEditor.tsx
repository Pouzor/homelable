import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Italic, Link2, List, ListChecks, Save, Table, X } from 'lucide-react'

import { documentsApi } from '@/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Markdown } from '../markdown/Markdown'
import type { LinkableDevice, LinkableDoc } from '../wikilinks'

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
  docs?: LinkableDoc[]
  devices?: LinkableDevice[]
}

const GENERATED_BLOCKS: { id: string; label: string; hint: string; block: string }[] = [
  { id: 'device', label: '/device', hint: 'Device Information table, from the current facts', block: 'device-info' },
  { id: 'services', label: '/services', hint: 'One section per fingerprinted service', block: 'services' },
  { id: 'hardware', label: '/hardware', hint: 'CPU, RAM and disk', block: 'hardware' },
  { id: 'network', label: '/network', hint: 'Subnet, neighbours, exposure', block: 'network' },
  { id: 'rack', label: '/rack', hint: 'Rack and zone placement', block: 'rack' },
  { id: 'properties', label: '/properties', hint: 'The device custom properties', block: 'properties' },
]

const PLAIN_SNIPPETS: SlashCommand[] = [
  { id: 'table', label: '/table', hint: 'An empty three-column table', insert: () => '| | | |\n|---|---|---|\n| | | |\n' },
  { id: 'task', label: '/task', hint: 'A checklist', insert: () => '- [ ] \n- [ ] \n' },
  { id: 'callout', label: '/callout', hint: 'A highlighted note', insert: () => '> [!note]\n> \n' },
  { id: 'link', label: '/link', hint: 'A link to another document', insert: () => '[[doc:]]' },
  { id: 'device-link', label: '/device-link', hint: 'A link to a device document', insert: () => '[[device:]]' },
  { id: 'date', label: '/date', hint: "Today's date", insert: () => new Date().toISOString().slice(0, 10) },
]

export function DocEditor({
  body,
  onChange,
  onSave,
  onCancel,
  dirty,
  saving,
  deviceId,
  docs = [],
  devices = [],
}: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [inserting, setInserting] = useState(false)

  const commands = useMemo<SlashCommand[]>(() => {
    const generated: SlashCommand[] = deviceId
      ? GENERATED_BLOCKS.map((entry) => ({
          id: entry.id,
          label: entry.label,
          hint: entry.hint,
          insert: async () => {
            const { data } = await documentsApi.block(entry.block, deviceId)
            return `${data.markdown}\n`
          },
        }))
      : []
    return [...generated, ...PLAIN_SNIPPETS]
  }, [deviceId])

  const visible = useMemo(() => {
    const needle = slashQuery.toLowerCase()
    return needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands
  }, [commands, slashQuery])

  const insertAtCursor = useCallback(
    (text: string, replaceSlash: boolean) => {
      const el = textarea.current
      if (!el) return
      const end = el.selectionEnd
      // The `/query` the user typed to open the menu is consumed by the insert.
      const start = replaceSlash ? Math.max(0, end - slashQuery.length - 1) : el.selectionStart
      const next = `${body.slice(0, start)}${text}${body.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        const caret = start + text.length
        el.setSelectionRange(caret, caret)
      })
    },
    [body, onChange, slashQuery.length],
  )

  const runCommand = useCallback(
    async (command: SlashCommand) => {
      setSlashOpen(false)
      setInserting(true)
      try {
        insertAtCursor(await command.insert(), true)
      } finally {
        setInserting(false)
        setSlashQuery('')
      }
    },
    [insertAtCursor],
  )

  const wrapSelection = useCallback(
    (before: string, after = before) => {
      const el = textarea.current
      if (!el) return
      const { selectionStart: start, selectionEnd: end } = el
      const selected = body.slice(start, end)
      const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`
      onChange(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + before.length, end + before.length)
      })
    },
    [body, onChange],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      onSave()
      return
    }
    if (event.key === 'Escape') {
      if (slashOpen) {
        event.preventDefault()
        setSlashOpen(false)
        return
      }
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === '/') {
      const el = event.currentTarget
      const before = body.slice(0, el.selectionStart)
      // Only at the start of a line — mid-sentence a slash is just a slash.
      if (before === '' || before.endsWith('\n')) {
        setSlashOpen(true)
        setSlashQuery('')
      }
    }
  }

  useEffect(() => {
    if (!slashOpen) setSlashQuery('')
  }, [slashOpen])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <Button size="icon-xs" variant="ghost" title="Bold" onClick={() => wrapSelection('**')}>
          <Bold />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Italic" onClick={() => wrapSelection('_')}>
          <Italic />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Bullet list" onClick={() => insertAtCursor('\n- ', false)}>
          <List />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Checklist" onClick={() => insertAtCursor('\n- [ ] ', false)}>
          <ListChecks />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Table" onClick={() => insertAtCursor('\n| | |\n|---|---|\n| | |\n', false)}>
          <Table />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Link to a document" onClick={() => insertAtCursor('[[doc:]]', false)}>
          <Link2 />
        </Button>
        <span className="ml-2 text-[10px] text-muted-foreground/70">
          Type <kbd className="rounded border border-border px-1">/</kbd> on a new line to insert
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[10px] text-muted-foreground">Unsaved</span>}
          <Button size="sm" variant="ghost" onClick={onCancel} className="cursor-pointer gap-1">
            <X size={13} /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={!dirty || saving} className="cursor-pointer gap-1">
            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <div className="relative min-h-0 border-r border-border">
          <textarea
            ref={textarea}
            value={body}
            aria-label="Document source"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
          />
          {slashOpen && (
            <div className="absolute bottom-4 left-4 z-20 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              <input
                autoFocus
                value={slashQuery}
                onChange={(event) => setSlashQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSlashOpen(false)
                  if (event.key === 'Enter' && visible[0]) {
                    event.preventDefault()
                    void runCommand(visible[0])
                  }
                }}
                placeholder="Insert…"
                aria-label="Insert a block"
                className="w-full border-b border-border bg-transparent px-3 py-2 text-xs outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {visible.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Nothing matches.</p>
                )}
                {visible.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    onClick={() => void runCommand(command)}
                    className="flex w-full cursor-pointer flex-col items-start px-3 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="font-mono text-xs">{command.label}</span>
                    <span className="text-[10px] text-muted-foreground">{command.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {inserting && (
            <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground">Inserting…</span>
          )}
        </div>
        <div className={cn('min-h-0 overflow-y-auto p-4 text-sm', 'hidden lg:block')}>
          <Markdown body={body} docs={docs} devices={devices} className="max-w-[72ch]" />
        </div>
      </div>
    </div>
  )
}
