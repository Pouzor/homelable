/**
 * Editable list of `NodeProperty` records — key, value, optional icon, and a
 * per-property "show it on the canvas" toggle.
 *
 * Extracted from `DetailPanel` so the rack cable panel gets the same editor
 * rather than a second implementation of it. The component owns only its form
 * and drag state; the array itself belongs to the caller, which receives every
 * mutation as a whole new array through `onChange`.
 */
import { createElement, useState } from 'react'
import { Eye, EyeOff, GripVertical, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t, useLocale } from '@/i18n'
import { PROPERTY_ICONS, PROPERTY_ICON_NAMES, resolvePropertyIcon } from '@/utils/propertyIcons'
import type { NodeProperty } from '@/types'

export type PropForm = { key: string; value: string; icon: string | null; visible: boolean }
const EMPTY_PROP: PropForm = { key: '', value: '', icon: null, visible: true }

interface PropertyListProps {
  properties: NodeProperty[]
  /** Receives the full next array — the caller decides how to persist it. */
  onChange: (next: NodeProperty[]) => void
  /** Wording of the per-property visibility toggle ("Show on node" by default). */
  visibleLabel?: string
  /** Placeholder examples, so a cable does not suggest "CPU Model". */
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** One-click keys pre-filling the add form (e.g. Length, VLAN). */
  suggestions?: string[]
  /** Section heading. */
  title?: string
  emptyHint?: string
}

export function PropertyList({
  properties,
  onChange,
  visibleLabel,
  keyPlaceholder,
  valuePlaceholder,
  suggestions,
  title,
  emptyHint,
}: PropertyListProps) {
  useLocale()
  // Callers pass their wording in English; the defaults are spelled out as
  // literal keys so the completeness scan can see them.
  const visibleText = visibleLabel ? t(visibleLabel) : t('Show on node')
  const keyText = keyPlaceholder ? t(keyPlaceholder) : t('Label (e.g. CPU Model)')
  const valueText = valuePlaceholder ? t(valuePlaceholder) : t('Value — optional (e.g. i7-12700K)')
  const titleText = title ? t(title) : t('Properties')
  const emptyText = emptyHint ? t(emptyHint) : t('No properties — click Add to define one.')
  // "Show on node" is sliced down to the bare surface word for the eye
  // tooltips, so each known surface needs its own translation. An unknown
  // surface passes through untranslated rather than being mangled.
  const surfaces: Record<string, string> = {
    node: t('node'),
    canvas: t('canvas'),
    'new nodes': t('new nodes'),
  }
  const surface = surfaces[(visibleLabel ?? 'Show on node').replace(/^Show on /i, '')] ?? visibleLabel ?? t('node')
  const [adding, setAdding] = useState(false)
  const [newProp, setNewProp] = useState<PropForm>(EMPTY_PROP)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editProp, setEditProp] = useState<PropForm>(EMPTY_PROP)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleAdd = () => {
    // Only the key is required — a property may carry a label alone.
    if (!newProp.key.trim()) return
    onChange([
      ...properties,
      { key: newProp.key.trim(), value: newProp.value.trim(), icon: newProp.icon, visible: newProp.visible },
    ])
    setNewProp(EMPTY_PROP)
    setAdding(false)
  }

  const handleRemove = (index: number) => {
    onChange(properties.filter((_, i) => i !== index))
    // `editingIndex` is a position into an array the caller owns, so any
    // mutation from outside the form invalidates it: removing an earlier row
    // shifted the open form onto its neighbour, and Save then overwrote the
    // wrong property. Close the form rather than try to track the move.
    setEditingIndex(null)
  }

  const handleToggleVisible = (index: number) => {
    onChange(properties.map((p, i) => (i === index ? { ...p, visible: !p.visible } : p)))
  }

  const handleStartEdit = (index: number) => {
    const p = properties[index]
    if (!p) return
    setEditProp({ key: p.key, value: p.value, icon: p.icon, visible: p.visible })
    setEditingIndex(index)
    setAdding(false)
  }

  const handleSaveEdit = () => {
    if (editingIndex === null || !editProp.key.trim()) return
    onChange(
      properties.map((p, i) =>
        i === editingIndex
          ? { key: editProp.key.trim(), value: editProp.value.trim(), icon: editProp.icon, visible: editProp.visible }
          : p
      )
    )
    setEditingIndex(null)
  }

  const handleReorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= properties.length || to >= properties.length) return
    const reordered = [...properties]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    onChange(reordered)
    // Same positional hazard as a remove — see handleRemove.
    setEditingIndex(null)
  }

  const startAddWith = (key: string) => {
    setEditingIndex(null)
    setNewProp({ ...EMPTY_PROP, key })
    setAdding(true)
  }

  return (
    <div className="px-4 py-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{titleText}{properties.length > 0 ? ` (${properties.length})` : ''}</span>
        <button
          onClick={() => { setAdding((v) => !v); setEditingIndex(null) }}
          className="flex items-center gap-1 text-[10px] text-[#00d4ff] hover:text-[#00d4ff]/80 transition-colors cursor-pointer"
        >
          <Plus size={10} /> {t('Add')}
        </button>
      </div>
      {suggestions && suggestions.length > 0 && !adding && (
        <div className="flex flex-wrap gap-1 mb-2">
          {suggestions.map((key) => (
            <button
              key={key}
              onClick={() => startAddWith(key)}
              title={t('Add a {key} property', { key })}
              className="rounded border border-[#30363d] px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-[#00d4ff] hover:text-[#00d4ff] transition-colors cursor-pointer"
            >
              + {key}
            </button>
          ))}
        </div>
      )}
      {adding && (
        <PropertyForm
          form={newProp}
          onChange={setNewProp}
          onConfirm={handleAdd}
          onCancel={() => { setAdding(false); setNewProp(EMPTY_PROP) }}
          confirmLabel={t('Add')}
          visibleLabel={visibleText}
          keyPlaceholder={keyText}
          valuePlaceholder={valueText}
        />
      )}
      {properties.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {properties.map((prop, i) =>
            editingIndex === i ? (
              <PropertyForm
                key={`edit-${i}`}
                form={editProp}
                onChange={setEditProp}
                onConfirm={handleSaveEdit}
                onCancel={() => setEditingIndex(null)}
                confirmLabel={t('Save')}
                visibleLabel={visibleText}
                keyPlaceholder={keyText}
                valuePlaceholder={valueText}
              />
            ) : (
              <PropertyBadge
                key={`${prop.key}-${i}`}
                prop={prop}
                visibleLabel={surface}
                draggable={properties.length > 1}
                isDragging={dragIndex === i}
                isDragOver={dragOverIndex === i && dragIndex !== i}
                onDragStart={() => setDragIndex(i)}
                onDragEnter={() => { if (dragIndex !== null) setDragOverIndex(i) }}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                onDrop={() => {
                  if (dragIndex !== null) handleReorder(dragIndex, i)
                  setDragIndex(null)
                  setDragOverIndex(null)
                }}
                onToggleVisible={() => handleToggleVisible(i)}
                onEdit={() => handleStartEdit(i)}
                onRemove={() => handleRemove(i)}
              />
            )
          )}
        </div>
      )}
      {properties.length === 0 && !adding && (
        <p className="text-[10px] text-muted-foreground/50">{emptyText}</p>
      )}
    </div>
  )
}

export function PropertyForm({ form, onChange, onConfirm, onCancel, confirmLabel, visibleLabel = 'Show on node', keyPlaceholder = 'Label (e.g. CPU Model)', valuePlaceholder = 'Value — optional (e.g. i7-12700K)' }: {
  form: PropForm
  onChange: (f: PropForm) => void
  onConfirm: () => void
  onCancel: () => void
  confirmLabel: string
  visibleLabel?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  useLocale()
  return (
    <div className="flex flex-col gap-1.5 mb-1 p-2 rounded-md bg-[#0d1117] border border-[#30363d]">
      <Input
        value={form.key}
        onChange={(e) => onChange({ ...form, key: e.target.value })}
        placeholder={t(keyPlaceholder)}
        className="bg-[#21262d] border-[#30363d] text-xs h-7"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
      />
      <Input
        value={form.value}
        onChange={(e) => onChange({ ...form, value: e.target.value })}
        placeholder={t(valuePlaceholder)}
        className="bg-[#21262d] border-[#30363d] text-xs h-7"
        onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
      />
      {/* Icon picker */}
      <div className="flex flex-wrap gap-1 pt-0.5">
        <button
          onClick={() => onChange({ ...form, icon: null })}
          title={t('No icon')}
          className={`w-6 h-6 rounded flex items-center justify-center text-[10px] border transition-colors ${
            form.icon === null ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]' : 'border-[#30363d] text-muted-foreground hover:border-[#8b949e]'
          }`}
        >
          –
        </button>
        {PROPERTY_ICON_NAMES.map((name) => {
          const Icon = PROPERTY_ICONS[name]
          const active = form.icon === name
          return (
            <button
              key={name}
              onClick={() => onChange({ ...form, icon: name })}
              title={name}
              className={`w-6 h-6 rounded flex items-center justify-center border transition-colors ${
                active ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff]' : 'border-[#30363d] text-muted-foreground hover:border-[#8b949e]'
              }`}
            >
              {createElement(Icon, { size: 11 })}
            </button>
          )
        })}
      </div>
      {/* Visible toggle */}
      <label className="flex items-center gap-2 cursor-pointer pt-0.5">
        <input
          type="checkbox"
          checked={form.visible}
          onChange={(e) => onChange({ ...form, visible: e.target.checked })}
          className="accent-[#00d4ff] w-3 h-3"
        />
        <span className="text-[10px] text-muted-foreground">{t(visibleLabel)}</span>
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" className="flex-1 h-6 text-[10px] bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90" onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onCancel}>{t('Cancel')}</Button>
      </div>
    </div>
  )
}

export function PropertyBadge({ prop, visibleLabel = 'node', draggable, isDragging, isDragOver, onDragStart, onDragEnter, onDragEnd, onDrop, onToggleVisible, onEdit, onRemove }: {
  prop: NodeProperty
  /** Used to word the eye tooltip — "Show on node" / "Show on canvas". */
  visibleLabel?: string
  draggable: boolean
  isDragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDragEnd: () => void
  onDrop: () => void
  onToggleVisible: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const Icon = resolvePropertyIcon(prop.icon)
  useLocale()
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors"
      style={{
        background: '#21262d',
        borderColor: isDragOver ? '#00d4ff' : '#30363d',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {draggable && (
          <span className="shrink-0 cursor-grab active:cursor-grabbing text-[#8b949e] hover:text-[#00d4ff]" title={t('Drag to reorder')}>
            {createElement(GripVertical, { size: 11 })}
          </span>
        )}
        {Icon && createElement(Icon, { size: 11, className: 'shrink-0 text-muted-foreground' })}
        <span className="font-medium truncate text-foreground" title={prop.key}>{prop.key}</span>
        {prop.value.trim() && (
          <span className="text-muted-foreground truncate" title={prop.value}>· {prop.value}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleVisible}
          title={prop.visible ? t('Hide on {where}', { where: t(visibleLabel) }) : t('Show on {where}', { where: t(visibleLabel) })}
          className="text-[#8b949e] hover:text-[#00d4ff] transition-colors"
        >
          {prop.visible ? <Eye size={10} /> : <EyeOff size={10} />}
        </button>
        <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#00d4ff]" title={t('Edit property')}>
          <Pencil size={10} />
        </button>
        <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8b949e] hover:text-[#f85149]" title={t('Remove property')}>
          <X size={10} />
        </button>
      </div>
    </div>
  )
}
