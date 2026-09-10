import { useState } from 'react'
import { Network } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useDesignStore } from '@/stores/designStore'
import { designsApi } from '@/api/client'

interface AutoPlaceModalProps {
  open: boolean
  onClose: () => void
  onDone: () => void
}

type RunResult = {
  nodes_placed: number
  nodes_moved: number
  edges_created: number
  skipped: number
}

export function AutoPlaceModal({ open, onClose, onDone }: AutoPlaceModalProps) {
  const designs = useDesignStore((s) => s.designs)
  const activeDesignId = useDesignStore((s) => s.activeDesignId)

  const [selectedDesignId, setSelectedDesignId] = useState<string>('')
  const [force, setForce] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Default to active design when dropdown hasn't been touched
  const effectiveDesignId = selectedDesignId || activeDesignId || ''

  function handleClose() {
    setResult(null)
    setError(null)
    setRunning(false)
    onClose()
  }

  async function handleRun() {
    if (!effectiveDesignId) return
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const res = await designsApi.autoPlace(effectiveDesignId, force)
      setResult(res.data)
      onDone()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e as Error)?.message
        ?? 'Unknown error'
      setError(msg)
    } finally {
      setRunning(false)
    }
  }

  const networkDesigns = designs.filter((d) => d.design_type === 'network')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-sm bg-[#161b22] border-[#30363d]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Network size={15} className="text-[#00d4ff]" />
            Auto-place topology
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-4">
            <div className="rounded bg-[#0d1117] border border-[#30363d] p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nodes placed</span>
                <span className="font-mono text-[#39d353]">{result.nodes_placed}</span>
              </div>
              {result.nodes_moved > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nodes repositioned</span>
                  <span className="font-mono text-[#e3b341]">{result.nodes_moved}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Edges created</span>
                <span className="font-mono text-[#58a6ff]">{result.edges_created}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already placed</span>
                <span className="font-mono text-muted-foreground">{result.skipped}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auto-place-design" className="text-xs text-muted-foreground">
                Canvas
              </Label>
              <select
                id="auto-place-design"
                className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#58a6ff]"
                value={effectiveDesignId}
                onChange={(e) => setSelectedDesignId(e.target.value)}
                disabled={running}
              >
                {networkDesigns.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={running}
                className="accent-[#58a6ff]"
              />
              <span className="text-xs text-muted-foreground">
                Re-layout existing nodes (topology-aware)
              </span>
            </label>

            <p className="text-xs text-muted-foreground leading-relaxed">
              LLDP walks all SNMP-enabled devices and places unplaced approved devices in a tier
              layout. Check the box to also reposition existing nodes by topology.
            </p>

            {error && (
              <p className="text-xs text-[#f85149] bg-[#3d1418] rounded px-2 py-1.5">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={handleClose} disabled={running}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRun}
                disabled={running || !effectiveDesignId}
                className="bg-[#238636] hover:bg-[#2ea043] text-white"
              >
                {running ? 'Running...' : 'Place devices'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
