import { useRef } from 'react'
import { Save, LayoutDashboard, Download, Palette, Undo2, Redo2, HelpCircle, Table2, FileDown, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/Logo'
import { useCanvasStore } from '@/stores/canvasStore'

interface ToolbarProps {
  onSave: () => void
  onAutoLayout: () => void
  onExport: () => void
  onChangeStyle: () => void
  onUndo: () => void
  onRedo: () => void
  onShortcuts: () => void
  onExportMd: () => void
  onExportYaml: () => void
  onImportYaml: (content: string) => void
}

export function Toolbar({ onSave, onAutoLayout, onExport, onChangeStyle, onUndo, onRedo, onShortcuts, onExportMd, onExportYaml, onImportYaml }: ToolbarProps) {
  const { hasUnsavedChanges, past, future } = useCanvasStore()
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
      <Button
        size="sm" variant="ghost"
        className="gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        onClick={onUndo}
        disabled={past.length === 0}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={14} />
      </Button>
      <Button
        size="sm" variant="ghost"
        className="gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        onClick={onRedo}
        disabled={future.length === 0}
        title="Redo (Ctrl+Y)"
      >
        <Redo2 size={14} />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onAutoLayout}>
        <LayoutDashboard size={14} /> Auto Layout
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onChangeStyle}>
        <Palette size={14} /> Style
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => fileInputRef.current?.click()} title="Import from YAML">
        <Upload size={14} /> Import
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onExport} title="Export as PNG">
        <Download size={14} /> Export
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onExportMd} title="Copy inventory as Markdown table">
        <Table2 size={14} /> MD
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onExportYaml} title="Export canvas as YAML">
        <FileDown size={14} /> YAML
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onShortcuts} title="Keyboard shortcuts (?)">
        <HelpCircle size={14} />
      </Button>
      <Button
        size="sm"
        className="gap-1.5 relative"
        style={{
          background: hasUnsavedChanges ? '#00d4ff' : undefined,
          color: hasUnsavedChanges ? '#0d1117' : undefined,
        }}
        onClick={onSave}
      >
        {hasUnsavedChanges && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#e3b341] border border-[#161b22]" />
        )}
        <Save size={14} /> Save
      </Button>
    </header>
  )
}
