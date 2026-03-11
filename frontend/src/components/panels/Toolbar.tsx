import { Save, LayoutDashboard, Download, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/Logo'
import { useCanvasStore } from '@/stores/canvasStore'

interface ToolbarProps {
  onSave: () => void
  onAutoLayout: () => void
  onExport: () => void
  onChangeStyle: () => void
}

export function Toolbar({ onSave, onAutoLayout, onExport, onChangeStyle }: ToolbarProps) {
  const { hasUnsavedChanges } = useCanvasStore()

  return (
    <header className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#161b22] shrink-0">
      <Logo size={28} showText={true} />
      <div className="flex-1" />
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onAutoLayout}>
        <LayoutDashboard size={14} /> Auto Layout
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onChangeStyle}>
        <Palette size={14} /> Style
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={onExport}>
        <Download size={14} /> Export
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
