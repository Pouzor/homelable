import { useEffect, useRef, useState } from 'react'
import { Save, LayoutDashboard, ChevronDown, Download, Palette, Undo2, Redo2, HelpCircle, FileDown, Upload, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/Logo'
import { useCanvasStore } from '@/stores/canvasStore'
import { useDesignStore } from '@/stores/designStore'
import { useRackStore } from '@/rack/store'
import { RackToolbarActions } from './RackToolbarActions'
import type { AutoLayoutMode } from '@/utils/zoneGrouping'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

interface ToolbarProps {
  onSave: () => void
  onAutoLayout: (mode: AutoLayoutMode) => void
  onExport: () => void
  onChangeStyle: () => void
  onUndo: () => void
  onRedo: () => void
  onShortcuts: () => void
  onExportYaml: () => void
  onImportYaml: (content: string) => void
  onViewOnly: () => void
}

export function Toolbar({ onSave, onAutoLayout, onExport, onChangeStyle, onUndo, onRedo, onShortcuts, onExportYaml, onImportYaml, onViewOnly }: ToolbarProps) {
  const { hasUnsavedChanges: canvasDirty, past, future } = useCanvasStore()
  const isRack = useDesignStore((s) => s.activeDesignType) === 'rack'
  const rackDirty = useRackStore((s) => s.hasUnsavedChanges)
  const hasUnsavedChanges = isRack ? rackDirty : canvasDirty
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result
      if (typeof content === 'string') onImportYaml(content)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <header className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#161b22] shrink-0">
      <Logo size={28} showText={true} />
      <div className="flex-1" />
      {/* Undo/redo are canvas history; the rack canvas has none yet. */}
      {!isRack && (
        <>
          <Button
            size="sm" variant="ghost"
            className="gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer hover:bg-[#21262d]"
            onClick={onUndo}
            disabled={past.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </Button>
          <Button
            size="sm" variant="ghost"
            className="gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer hover:bg-[#21262d]"
            onClick={onRedo}
            disabled={future.length === 0}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </Button>
        </>
      )}
      <div className="w-px h-4 bg-border mx-1" />
      {isRack && <RackToolbarActions />}
      {!isRack && (
      <>
      <AutoLayoutButton onAutoLayout={onAutoLayout} />
      <Button data-tour="style" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={onChangeStyle}>
        <Palette size={14} /> Style
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={() => fileInputRef.current?.click()} title="Import from YAML">
        <Upload size={14} /> Import
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={onExportYaml} title="Export canvas as YAML">
        <Download size={14} /> Export
      </Button>
      </>
      )}
      {/* PNG capture is DOM-based, so it works for both canvas kinds. */}
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={onExport} title="Download canvas as PNG">
        <FileDown size={14} /> PNG
      </Button>
      {/* Live view reads backend/localStorage canvas; pointless in standalone
          where the editor already shows the only (localStorage) copy. Rack
          canvases have no live view yet. */}
      {!STANDALONE && !isRack && (
        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={onViewOnly} title="Open read-only live view of this canvas">
          <Eye size={14} /> View
        </Button>
      )}
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={onShortcuts} title="Keyboard shortcuts (?)">
        <HelpCircle size={14} />
      </Button>
      <Button
        size="sm"
        className="gap-1.5 relative cursor-pointer border border-transparent hover:border-white"
        style={{
          background: hasUnsavedChanges ? '#00d4ff' : undefined,
          color: hasUnsavedChanges ? '#0d1117' : undefined,
        }}
        onClick={() => onSave()}
      >
        {hasUnsavedChanges && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#e3b341] border border-[#161b22]" />
        )}
        <Save size={14} /> Save
      </Button>
    </header>
  )
}

const LAYOUT_MODES: { mode: Exclude<AutoLayoutMode, 'hierarchy'>; label: string; hint: string }[] = [
  { mode: 'type', label: 'Group by device type', hint: 'One zone per family: hardware, virtualization, IoT…' },
  { mode: 'subnet', label: 'Group by subnet', hint: 'One zone per /24; devices without an IP stay loose' },
]

/**
 * Auto Layout as a split button: the main half runs the plain hierarchy, the
 * chevron offers the zone-grouping modes (#326).
 */
function AutoLayoutButton({ onAutoLayout }: { onAutoLayout: (mode: AutoLayoutMode) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (mode: AutoLayoutMode) => {
    setOpen(false)
    onAutoLayout(mode)
  }

  return (
    <div ref={rootRef} className="relative flex items-center">
      <Button size="sm" variant="ghost" className="gap-1.5 pr-1.5 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]" onClick={() => pick('hierarchy')}>
        <LayoutDashboard size={14} /> Auto Layout
      </Button>
      <Button
        size="sm" variant="ghost"
        className="px-1 text-muted-foreground hover:text-foreground cursor-pointer hover:bg-[#21262d]"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More layout options"
        title="More layout options"
      >
        <ChevronDown size={12} />
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-card p-1 shadow-lg">
          {LAYOUT_MODES.map(({ mode, label, hint }) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              className="w-full rounded px-2 py-1.5 text-left cursor-pointer hover:bg-[#21262d]"
              onClick={() => pick(mode)}
            >
              <div className="text-xs text-foreground">{label}</div>
              <div className="text-[11px] text-muted-foreground">{hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
