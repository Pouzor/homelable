import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, X, Loader2, StopCircle, Clock, ScanLine, Network, RadioTower, Inbox } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { scanApi } from '@/api/client'
import { useCanvasStore } from '@/stores/canvasStore'
import { toast } from 'sonner'

export interface ScanRun {
  id: string
  status: string
  kind?: string
  ranges: string[]
  devices_found: number
  started_at: string
  finished_at: string | null
  error: string | null
}

interface ScanHistoryModalProps {
  open: boolean
  onClose: () => void
}

type KindFilter = 'all' | 'ip' | 'zigbee' | 'zwave'

/** Normalise a ScanRun.kind into one of the known display kinds. */
function runKind(kind: string | undefined): 'ip' | 'zigbee' | 'zwave' {
  return kind === 'zigbee' ? 'zigbee' : kind === 'zwave' ? 'zwave' : 'ip'
}

const KIND_META = {
  ip: { label: 'IP', color: '#a855f7' },
  zigbee: { label: 'Zigbee', color: '#00d4ff' },
  zwave: { label: 'Z-Wave', color: '#ff6e00' },
} as const
type StatusFilter = 'all' | 'running' | 'done' | 'error' | 'cancelled'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'error', label: 'Error' },
  { key: 'cancelled', label: 'Cancelled' },
]

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ip', label: 'IP' },
  { key: 'zigbee', label: 'Zigbee' },
  { key: 'zwave', label: 'Z-Wave' },
]

function statusColor(s: string): string {
  return s === 'done' ? '#39d353'
    : s === 'running' ? '#e3b341'
    : s === 'error' ? '#f85149'
    : s === 'cancelled' ? '#8b949e'
    : '#8b949e'
}

function parseUtc(ts: string): number {
  return new Date(ts.endsWith('Z') ? ts : ts + 'Z').getTime()
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function runDuration(r: ScanRun, now: number): string {
  const start = parseUtc(r.started_at)
  const end = r.finished_at ? parseUtc(r.finished_at) : now
  return formatDuration(end - start)
}

export function ScanHistoryModal({ open, onClose }: ScanHistoryModalProps) {
  const [runs, setRuns] = useState<ScanRun[]>([])
  const [loading, setLoading] = useState(false)
  const [stopping, setStopping] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [now, setNow] = useState(() => Date.now())
  const prevRunsRef = useRef<ScanRun[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await scanApi.runs()
      const next: ScanRun[] = res.data

      // Surface transitions and refresh dependent UI
      for (const run of next) {
        const prev = prevRunsRef.current.find((r) => r.id === run.id)
        if (prev?.status === 'running' && run.status === 'error') {
          toast.error(`Scan failed: ${run.error ?? 'unknown error'}`)
        }
        if (prev?.status === 'running' && run.status === 'done') {
          if (run.kind === 'zigbee' || run.kind === 'zwave') {
            const label = run.kind === 'zwave' ? 'Z-Wave' : 'Zigbee'
            toast.success(`${label} import done — ${run.devices_found} device${run.devices_found !== 1 ? 's' : ''}`)
          }
          useCanvasStore.getState().notifyScanDeviceFound()
        }
      }
      prevRunsRef.current = next
      setRuns(next)
    } catch {
      toast.error('Failed to load scan history')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load when opened; reset prior-state tracker so we don't replay old transitions
  useEffect(() => {
    if (!open) return
    prevRunsRef.current = []
    load()
  }, [open, load])

  // Auto-refresh every 3s while any run is still running (only when open)
  useEffect(() => {
    if (!open) return
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [open, runs, load])

  // Tick the clock every second while a scan is running (for live elapsed duration)
  useEffect(() => {
    if (!open) return
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open, runs])

  const handleStop = async (runId: string) => {
    setStopping(runId)
    try {
      await scanApi.stop(runId)
      toast.success('Scan stop requested')
    } catch {
      toast.error('Failed to stop scan')
    } finally {
      setStopping(null)
    }
  }

  const filtered = runs.filter((r) => {
    const k = runKind(r.kind)
    if (kindFilter !== 'all' && k !== kindFilter) return false
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    return true
  })

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-none w-[90vw] max-w-2xl h-[80vh] p-0 flex flex-col gap-0 bg-[#0d1117] border-border"
      >
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Clock size={16} className="text-[#00d4ff]" />
              Scan History
              <span className="text-muted-foreground font-normal text-xs">
                ({filtered.length}{filtered.length !== runs.length && ` of ${runs.length}`})
              </span>
            </DialogTitle>
            <div className="flex items-center gap-1">
              <button onClick={load} className="text-muted-foreground hover:text-foreground p-1.5 rounded transition-colors" title="Refresh">
                <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              </button>
              <DialogClose
                render={
                  <button
                    className="text-muted-foreground hover:text-foreground p-1.5 rounded transition-colors"
                    aria-label="Close"
                  />
                }
              >
                <X size={14} />
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        {/* Filters */}
        <div className="px-4 py-2 border-b border-border bg-[#161b22] shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Type</span>
            {KIND_FILTERS.map((f) => (
              <FilterChip key={f.key} active={kindFilter === f.key} onClick={() => setKindFilter(f.key)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</span>
            {STATUS_FILTERS.map((f) => (
              <FilterChip key={f.key} active={statusFilter === f.key} onClick={() => setStatusFilter(f.key)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {loading && runs.length === 0 && (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Inbox size={28} className="opacity-50" />
              <p className="text-sm">{runs.length === 0 ? 'No scans yet' : 'No scans match the filters'}</p>
            </div>
          )}
          {filtered.map((r) => {
            const kind = runKind(r.kind)
            const meta = KIND_META[kind]
            const KindIcon = kind === 'zigbee' ? Network : kind === 'zwave' ? RadioTower : ScanLine
            return (
              <div key={r.id} className="rounded-lg border border-border bg-[#161b22] p-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor(r.status) }} />
                  <span className="font-mono text-sm text-foreground capitalize">{r.status}</span>
                  {r.status === 'running' && <Loader2 size={12} className="animate-spin text-[#e3b341]" />}
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{ background: `${meta.color}22`, color: meta.color }}
                  >
                    <KindIcon size={10} />
                    {meta.label}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground font-mono">
                    {r.devices_found} found
                  </span>
                  {r.status === 'running' && (
                    <Tooltip>
                      <TooltipTrigger>
                        <button
                          aria-label="Stop scan"
                          onClick={() => handleStop(r.id)}
                          disabled={stopping === r.id}
                          className="p-1 text-[#f85149] hover:bg-[#f85149]/10 rounded transition-colors disabled:opacity-50"
                        >
                          {stopping === r.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <StopCircle size={13} />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">Stop scan</TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {/* Meta grid */}
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <Meta label="Started" value={new Date(parseUtc(r.started_at)).toLocaleString()} />
                  <Meta
                    label="Finished"
                    value={r.finished_at ? new Date(parseUtc(r.finished_at)).toLocaleString() : '—'}
                  />
                  <Meta label="Duration" value={runDuration(r, now)} mono />
                  <Meta label="Devices" value={`${r.devices_found}`} mono />
                </div>

                {r.ranges.length > 0 && (
                  <div className="mt-2 text-[11px]">
                    <span className="text-muted-foreground">Ranges: </span>
                    <span className="text-[#8b949e] font-mono break-all">{r.ranges.join(', ')}</span>
                  </div>
                )}

                {r.error && (
                  <div className="mt-2 text-[11px] text-[#f85149] leading-tight whitespace-pre-wrap break-words rounded bg-[#f85149]/10 px-2 py-1.5">
                    {r.error}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
        active
          ? 'bg-[#00d4ff]/10 border-[#00d4ff]/40 text-[#00d4ff]'
          : 'border-border text-muted-foreground hover:text-foreground hover:border-[#30363d]'
      }`}
    >
      {children}
    </button>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider">{label}</span>
      <span className={`text-foreground ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
