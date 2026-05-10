import { useState, useCallback, useEffect, useRef } from 'react'
import { Plus, Save, ScanLine, ChevronLeft, ChevronRight, LayoutDashboard, Clock, EyeOff, RefreshCw, Loader2, Square, Eye, Settings, StopCircle, LogOut, Network, Type } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import { scanApi, settingsApi } from '@/api/client'
import { toast } from 'sonner'
import { useLatestRelease } from '@/hooks/useLatestRelease'
import {
  type AlignmentSettings,
  readAlignmentSettings,
  writeAlignmentSettings,
  subscribeAlignmentSettings,
} from '@/utils/alignmentSettings'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

type SidebarView = 'canvas' | 'history' | 'settings'

const PENDING_TRIGGERS: { kind: 'pending' | 'hidden'; icon: typeof ScanLine; label: string }[] = [
  { kind: 'pending', icon: ScanLine, label: 'Pending Devices' },
  { kind: 'hidden', icon: EyeOff, label: 'Hidden Devices' },
]

interface ScanRun {
  id: string
  status: string
  kind?: string
  ranges: string[]
  devices_found: number
  started_at: string
  finished_at: string | null
  error: string | null
}

interface SidebarProps {
  onAddNode: () => void
  onAddGroupRect: () => void
  onAddText: () => void
  onScan: () => void
  onZigbeeImport: () => void
  onSave: () => void
  forceView?: SidebarView
  onOpenPending: (deviceId?: string, status?: 'pending' | 'hidden') => void
}

export function Sidebar({ onAddNode, onAddGroupRect, onAddText, onScan, onZigbeeImport, onSave, forceView, onOpenPending }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeView, setActiveView] = useState<SidebarView>(forceView ?? 'canvas')
  const [prevForceView, setPrevForceView] = useState(forceView)
  const logout = useAuthStore((s) => s.logout)

  // forceView acts as a one-shot trigger from parent; user clicks afterwards still control view.
  if (forceView !== prevForceView) {
    setPrevForceView(forceView)
    if (forceView) {
      setActiveView(forceView)
      setCollapsed(false)
    }
  }

  const { nodes, hasUnsavedChanges, hideIp, toggleHideIp } = useCanvasStore()

  const networkNodes = nodes.filter((n) => n.data.type !== 'groupRect' && n.data.type !== 'text')
  const onlineCount = networkNodes.filter((n) => n.data.status === 'online').length
  const offlineCount = networkNodes.filter((n) => n.data.status === 'offline').length

  const handleScan = useCallback(() => {
    onScan()
  }, [onScan])

  return (
    <aside
      className="flex flex-col border-r border-border bg-[#161b22] transition-all duration-200 relative shrink-0"
      style={{ width: collapsed ? 48 : 220 }}
    >
      {/* Toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="absolute -right-3 top-6 z-10 flex items-center justify-center w-6 h-6 rounded-full border border-border bg-[#21262d] text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Logo */}
      <div className="flex items-center px-3 py-4 border-b border-border overflow-hidden">
        <Logo size={28} showText={!collapsed} />
      </div>

      {/* Views */}
      <nav className="flex flex-col gap-0.5 p-2">
        <SidebarItem
          icon={LayoutDashboard}
          label="Canvas"
          collapsed={collapsed}
          active={activeView === 'canvas'}
          onClick={() => setActiveView('canvas')}
        />
        {!STANDALONE && PENDING_TRIGGERS.map((t) => (
          <SidebarItem
            key={t.kind}
            icon={t.icon}
            label={t.label}
            collapsed={collapsed}
            onClick={() => onOpenPending(undefined, t.kind)}
          />
        ))}
        {!STANDALONE && (
          <SidebarItem
            icon={Clock}
            label="Scan History"
            collapsed={collapsed}
            active={activeView === 'history'}
            onClick={() => setActiveView('history')}
          />
        )}
      </nav>

      {/* View content (only when expanded) */}
      {!collapsed && activeView !== 'canvas' && (
        <div className="flex-1 min-h-0 overflow-y-auto border-t border-border">
          {activeView === 'history' && <ScanHistoryPanel />}
          {activeView === 'settings' && <SettingsPanel />}
        </div>
      )}

      {/* Stats (only on canvas view) */}
      {!collapsed && activeView === 'canvas' && (
        <div className="flex-1" />
      )}

      {/* Stats footer */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground space-y-0.5">
          <div className="flex justify-between">
            <span>Total</span>
            <span className="text-foreground font-mono">{networkNodes.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#39d353]">Online</span>
            <span className="font-mono text-[#39d353]">{onlineCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#f85149]">Offline</span>
            <span className="font-mono text-[#f85149]">{offlineCount}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-0.5 p-2 border-t border-border">
        <SidebarItem icon={Plus} label="Add Node" collapsed={collapsed} onClick={onAddNode} />
        <SidebarItem icon={Square} label="Add Zone" collapsed={collapsed} onClick={onAddGroupRect} />
        <SidebarItem icon={Type} label="Add Text" collapsed={collapsed} onClick={onAddText} />
        {!STANDALONE && <SidebarItem icon={ScanLine} label="Scan Network" collapsed={collapsed} onClick={handleScan} />}
        {!STANDALONE && <SidebarItem icon={Network} label="Zigbee Import" collapsed={collapsed} onClick={onZigbeeImport} />}
        <SidebarItem
          icon={hideIp ? EyeOff : Eye}
          label={hideIp ? 'Show IPs' : 'Hide IPs'}
          collapsed={collapsed}
          onClick={toggleHideIp}
          active={hideIp}
        />
        <SidebarItem
          icon={Save}
          label="Save Canvas"
          collapsed={collapsed}
          onClick={onSave}
          badge={hasUnsavedChanges}
          accent
        />
        {!STANDALONE && (
          <SidebarItem
            icon={Settings}
            label="Settings"
            collapsed={collapsed}
            active={activeView === 'settings'}
            onClick={() => setActiveView((v) => v === 'settings' ? 'canvas' : 'settings')}
          />
        )}
        {!STANDALONE && (
          <SidebarItem
            icon={LogOut}
            label="Logout"
            collapsed={collapsed}
            onClick={logout}
          />
        )}
      </div>

      {!collapsed && <VersionBadge />}
    </aside>
  )
}


function ScanHistoryPanel() {
  const [runs, setRuns] = useState<ScanRun[]>([])
  const [loading, setLoading] = useState(false)
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
          if (run.kind === 'zigbee') {
            toast.success(`Zigbee import done — ${run.devices_found} device${run.devices_found !== 1 ? 's' : ''}`)
          }
          // Notify pending modal/canvas to refresh
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

  // Initial load
  useEffect(() => { load() }, [load])

  // Auto-refresh every 3s while any run is still running
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [runs, load])

  const [stopping, setStopping] = useState<string | null>(null)

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

  const statusColor = (s: string) =>
    s === 'done' ? '#39d353'
    : s === 'running' ? '#e3b341'
    : s === 'error' ? '#f85149'
    : s === 'cancelled' ? '#8b949e'
    : '#8b949e'

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">History</span>
        <button onClick={load} className="text-muted-foreground hover:text-foreground p-0.5">
          <RefreshCw size={12} />
        </button>
      </div>
      {loading && runs.length === 0 && <Loader2 size={14} className="animate-spin text-muted-foreground mx-auto my-4" />}
      {!loading && runs.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No scans yet</p>
      )}
      {runs.map((r) => (
        <div key={r.id} className="mb-2 p-2 rounded-md bg-[#21262d] text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColor(r.status) }} />
            <span className="font-mono text-foreground capitalize">{r.status}</span>
            {r.status === 'running' && <Loader2 size={10} className="animate-spin text-[#e3b341]" />}
            <span
              className="text-[9px] font-mono px-1 py-0.5 rounded uppercase tracking-wider"
              style={r.kind === 'zigbee'
                ? { background: '#00d4ff22', color: '#00d4ff' }
                : { background: '#a855f722', color: '#a855f7' }}
            >
              {r.kind === 'zigbee' ? 'ZIG' : 'IP'}
            </span>
            <span className="ml-auto text-muted-foreground font-mono">{r.devices_found} found</span>
            {r.status === 'running' && (
              <Tooltip>
                <TooltipTrigger>
                  <button
                    aria-label="Stop scan"
                    onClick={() => handleStop(r.id)}
                    disabled={stopping === r.id}
                    className="p-0.5 text-[#f85149] hover:bg-[#f85149]/10 rounded transition-colors disabled:opacity-50"
                  >
                    {stopping === r.id
                      ? <Loader2 size={11} className="animate-spin" />
                      : <StopCircle size={11} />
                    }
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Stop scan</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="text-muted-foreground text-[10px] mt-0.5">
            {new Date(r.started_at.endsWith('Z') ? r.started_at : r.started_at + 'Z').toLocaleString()}
          </div>
          {r.ranges.length > 0 && (
            <div className="text-[#8b949e] text-[10px] font-mono truncate">{r.ranges.join(', ')}</div>
          )}
          {r.error && (
            <div className="text-[#f85149] text-[10px] mt-1 leading-tight wrap-break-word whitespace-pre-wrap">
              {r.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function SettingsPanel() {
  const [interval, setIntervalValue] = useState(60)
  const [saving, setSaving] = useState(false)
  const [alignment, setAlignment] = useState<AlignmentSettings>(readAlignmentSettings)

  useEffect(() => {
    settingsApi.get()
      .then((res) => setIntervalValue(res.data.interval_seconds))
      .catch(() => {/* use default */})
  }, [])

  useEffect(() => subscribeAlignmentSettings(setAlignment), [])

  const updateAlignment = (patch: Partial<AlignmentSettings>) => {
    const next = { ...alignment, ...patch }
    setAlignment(next)
    writeAlignmentSettings(next)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await settingsApi.save({ interval_seconds: interval })
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 space-y-4">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Settings</span>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Status check interval (s)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={10}
            max={3600}
            value={interval}
            onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v)) setIntervalValue(v) }}
            className="w-24 px-2 py-1 rounded-md text-xs font-mono bg-[#0d1117] border border-border text-foreground focus:outline-none focus:border-[#00d4ff]"
          />
          <span className="text-xs text-muted-foreground">seconds</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-tight">
          How often node health is polled (ping, HTTP, SSH…)
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-1.5 rounded-md text-xs font-medium bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/20 transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>

      <div className="pt-3 border-t border-border space-y-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Canvas</span>

        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-xs text-foreground">Snap to nodes</span>
          <input
            type="checkbox"
            checked={alignment.enabled}
            onChange={(e) => updateAlignment({ enabled: e.target.checked })}
            className="cursor-pointer accent-[#00d4ff]"
            aria-label="Toggle alignment guides"
          />
        </label>

        <div className={alignment.enabled ? 'space-y-1.5' : 'space-y-1.5 opacity-50 pointer-events-none'}>
          <label className="text-xs text-muted-foreground">Snap distance</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={2}
              max={16}
              step={1}
              value={alignment.threshold}
              onChange={(e) => updateAlignment({ threshold: Number(e.target.value) })}
              className="flex-1 cursor-pointer accent-[#00d4ff]"
              aria-label="Alignment snap threshold"
            />
            <span className="font-mono text-[11px] text-foreground w-8 text-right">{alignment.threshold}px</span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Distance at which dragged nodes snap to neighbours. Hold Alt while dragging to disable.
          </p>
        </div>
      </div>
    </div>
  )
}

function VersionBadge() {
  const current = __APP_VERSION__
  const { latest, hasUpdate } = useLatestRelease(current)

  return (
    <div className="px-3 py-2 border-t border-border flex flex-col gap-1">
      <a
        href={`https://github.com/Pouzor/homelable/releases/tag/v${current}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        v{current}
      </a>
      {hasUpdate && latest && (
        <a
          href={latest.url.startsWith('https://') ? latest.url : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#e3b341]/15 text-[#e3b341] border border-[#e3b341]/30 hover:bg-[#e3b341]/25 transition-colors self-start"
        >
          ↑ v{latest.version} available
        </a>
      )}
    </div>
  )
}

interface SidebarItemProps {
  icon: React.ElementType
  label: string
  collapsed: boolean
  active?: boolean
  badge?: boolean
  accent?: boolean
  onClick?: () => void
}

function SidebarItem({ icon: Icon, label, collapsed, active, badge, accent, onClick }: SidebarItemProps) {
  const btn = (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
        active
          ? 'bg-[#00d4ff]/10 text-[#00d4ff]'
          : accent
          ? 'text-[#00d4ff] hover:bg-[#00d4ff]/10'
          : 'text-muted-foreground hover:text-foreground hover:bg-[#21262d]'
      }`}
    >
      <Icon size={16} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {badge && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#e3b341]" />
      )}
    </button>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger>{btn}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return btn
}
