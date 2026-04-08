import { useState, useCallback, useEffect, useRef } from 'react'
import { Plus, Save, ScanLine, ChevronLeft, ChevronRight, LayoutDashboard, Clock, EyeOff, Trash2, RefreshCw, Loader2, Square, Eye, Settings, StopCircle, X } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCanvasStore } from '@/stores/canvasStore'
import { scanApi, settingsApi } from '@/api/client'
import { toast } from 'sonner'
import { useLatestRelease } from '@/hooks/useLatestRelease'
import { PendingDeviceModal, type PendingDevice } from '@/components/modals/PendingDeviceModal'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

type SidebarView = 'canvas' | 'pending' | 'hidden' | 'history' | 'settings'

const ALL_VIEWS = [
  { id: 'canvas' as SidebarView, icon: LayoutDashboard, label: 'Canvas' },
  { id: 'pending' as SidebarView, icon: ScanLine, label: 'Pending Devices' },
  { id: 'hidden' as SidebarView, icon: EyeOff, label: 'Hidden Devices' },
  { id: 'history' as SidebarView, icon: Clock, label: 'Scan History' },
]
const VIEWS = STANDALONE ? ALL_VIEWS.slice(0, 1) : ALL_VIEWS

interface ScanRun {
  id: string
  status: string
  ranges: string[]
  devices_found: number
  started_at: string
  finished_at: string | null
  error: string | null
}

interface SidebarProps {
  onAddNode: () => void
  onAddGroupRect: () => void
  onScan: () => void
  onSave: () => void
  onNodeApproved: (nodeId: string) => void
  forceView?: SidebarView
  highlightPendingId?: string
}

export function Sidebar({ onAddNode, onAddGroupRect, onScan, onSave, onNodeApproved, forceView, highlightPendingId }: SidebarProps) {
  const [_collapsed, setCollapsed] = useState(false)
  const [_activeView, setActiveView] = useState<SidebarView>('canvas')

  // When forceView is set, override local state without useEffect
  const collapsed = forceView ? false : _collapsed
  const activeView = forceView ?? _activeView

  const { nodes, hasUnsavedChanges, hideIp, toggleHideIp } = useCanvasStore()

  const networkNodes = nodes.filter((n) => n.data.type !== 'groupRect')
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
        {VIEWS.map(({ id, icon: Icon, label }) => (
          <SidebarItem
            key={id}
            icon={Icon}
            label={label}
            collapsed={collapsed}
            active={activeView === id}
            onClick={() => setActiveView(id)}
          />
        ))}
      </nav>

      {/* View content (only when expanded) */}
      {!collapsed && activeView !== 'canvas' && (
        <div className="flex-1 min-h-0 overflow-y-auto border-t border-border">
          {activeView === 'pending' && <PendingDevicesPanel onNodeApproved={onNodeApproved} highlightId={highlightPendingId} />}
          {activeView === 'hidden' && <HiddenDevicesPanel />}
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
        {!STANDALONE && <SidebarItem icon={ScanLine} label="Scan Network" collapsed={collapsed} onClick={handleScan} />}
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
      </div>

      {!collapsed && <VersionBadge />}
    </aside>
  )
}

const COMMON_PORTS = new Set([22, 80, 443])

function PendingDevicesPanel({ onNodeApproved, highlightId }: { onNodeApproved: (nodeId: string) => void; highlightId?: string }) {
  const [devices, setDevices] = useState<PendingDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<PendingDevice | null>(null)
  const { addNode, scanEventTs } = useCanvasStore()
  const highlightRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await scanApi.pending()
      setDevices(res.data)
    } catch {
      toast.error('Failed to load pending devices')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleClearAll = async () => {
    try {
      await scanApi.clearPending()
      setDevices([])
      toast.success('Pending devices cleared')
    } catch {
      toast.error('Failed to clear pending devices')
    }
  }

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (scanEventTs > 0) load()
  }, [scanEventTs, load])

  useEffect(() => {
    if (!highlightId || loading) return
    highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [highlightId, loading])

  const handleApprove = async (device: PendingDevice) => {
    try {
      const nodeData = {
        label: device.hostname ?? device.ip,
        type: (device.suggested_type ?? 'generic') as import('@/types').NodeType,
        ip: device.ip,
        hostname: device.hostname ?? undefined,
        status: 'unknown',
        services: (device.services ?? []) as import('@/types').ServiceInfo[],
      }
      const res = await scanApi.approve(device.id, nodeData)
      const nodeId = res.data.node_id
      addNode({
        id: nodeId,
        type: nodeData.type,
        position: { x: 400, y: 300 },
        data: { ...nodeData, status: 'unknown' as const },
      })
      toast.success(`Approved ${nodeData.label}`)
      setDevices((prev) => prev.filter((d) => d.id !== device.id))
      setSelected(null)
      onNodeApproved(nodeId)
    } catch {
      toast.error('Failed to approve device')
    }
  }

  const handleHide = async (device: PendingDevice) => {
    try {
      await scanApi.hide(device.id)
      setDevices((prev) => prev.filter((d) => d.id !== device.id))
      toast.success('Device hidden')
    } catch {
      toast.error('Failed to hide device')
    }
  }

  const handleIgnore = async (device: PendingDevice) => {
    try {
      await scanApi.ignore(device.id)
      setDevices((prev) => prev.filter((d) => d.id !== device.id))
    } catch {
      toast.error('Failed to ignore device')
    }
  }

  return (
    <>
      <div className="p-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending</span>
          <div className="flex items-center gap-1">
            <button onClick={load} className="text-muted-foreground hover:text-foreground p-0.5" title="Refresh">
              <RefreshCw size={12} />
            </button>
            {devices.length > 0 && (
              <button onClick={handleClearAll} className="text-muted-foreground hover:text-[#f85149] p-0.5" title="Clear all pending">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground mx-auto my-4" />}
        {!loading && devices.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No pending devices</p>
        )}
        {devices.map((d) => {
          const namedService = d.services.find((s) => s.category != null && !COMMON_PORTS.has(s.port))
          const titleService = namedService
            ?? d.services.find((s) => s.port === 80)
            ?? d.services.find((s) => s.port === 443)
            ?? d.services.find((s) => s.port === 22)
          const title = titleService?.service_name ?? d.hostname ?? d.ip
          const showIpBelow = title !== d.ip
          const hasSsh = d.services.some((s) => s.port === 22)
          const hasHttp = d.services.some((s) => s.port === 80)
          const hasHttps = d.services.some((s) => s.port === 443)
          const otherCount = d.services.filter((s) => s.port !== 22 && s.port !== 80 && s.port !== 443).length
          const virtualBadge = detectVirtualBadge(d.mac)
          const sourceColor = d.discovery_source === 'mdns' ? '#a855f7' : '#8b949e'
          const sourceLabel = d.discovery_source === 'mdns' ? 'mDNS' : d.discovery_source === 'arp' ? 'ARP' : null
          const isHighlighted = d.id === highlightId
          return (
            <button
              key={d.id}
              ref={isHighlighted ? highlightRef : null}
              onClick={() => setSelected(d)}
              className={`w-full mb-1.5 p-2 rounded-md text-xs text-left transition-colors border ${isHighlighted ? 'bg-[#2d3748] border-[#e3b341]' : 'bg-[#21262d] border-transparent hover:bg-[#30363d] hover:border-[#30363d]'}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#e3b341] shrink-0" />
                <span className="text-foreground truncate font-medium">{title}</span>
              </div>
              {showIpBelow && (
                <div className="font-mono text-muted-foreground truncate pl-3 text-[10px] mt-0.5">{d.ip}</div>
              )}
              {(hasSsh || hasHttp || hasHttps || otherCount > 0 || virtualBadge || sourceLabel) && (
                <div className="flex items-center gap-1 pl-3 mt-1.5 flex-wrap">
                  {sourceLabel && <ServiceBadge label={sourceLabel} color={sourceColor} />}
                  {virtualBadge && (
                    <Tooltip>
                      <TooltipTrigger>
                        <span><ServiceBadge label={virtualBadge.label} color="#ff6e00" /></span>
                      </TooltipTrigger>
                      <TooltipContent side="right">{virtualBadge.title}</TooltipContent>
                    </Tooltip>
                  )}
                  {hasSsh && <ServiceBadge label="SSH" color="#a855f7" />}
                  {hasHttp && <ServiceBadge label="HTTP" color="#00d4ff" />}
                  {hasHttps && <ServiceBadge label="HTTPS" color="#39d353" />}
                  {otherCount > 0 && <ServiceBadge label={`+${otherCount}`} color="#8b949e" />}
                </div>
              )}
            </button>
          )
        })}
      </div>

      <PendingDeviceModal
        device={selected}
        onClose={() => setSelected(null)}
        onApprove={handleApprove}
        onHide={handleHide}
        onIgnore={handleIgnore}
      />
    </>
  )
}

function HiddenDevicesPanel() {
  const [devices, setDevices] = useState<PendingDevice[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await scanApi.hidden()
      setDevices(res.data)
    } catch {
      toast.error('Failed to load hidden devices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleIgnore = async (id: string) => {
    try {
      await scanApi.ignore(id)
      setDevices((prev) => prev.filter((d) => d.id !== id))
    } catch {
      toast.error('Failed to remove device')
    }
  }

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hidden</span>
        <button onClick={load} className="text-muted-foreground hover:text-foreground p-0.5">
          <RefreshCw size={12} />
        </button>
      </div>
      {loading && <Loader2 size={14} className="animate-spin text-muted-foreground mx-auto my-4" />}
      {!loading && devices.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No hidden devices</p>
      )}
      {devices.map((d) => (
        <div key={d.id} className="mb-2 p-2 rounded-md bg-[#21262d] text-xs">
          <div className="font-mono text-foreground">{d.ip}</div>
          {d.hostname && <div className="text-muted-foreground truncate">{d.hostname}</div>}
          <div className="flex gap-1 mt-1.5">
            <ActionButton icon={Trash2} label="Remove" color="red" onClick={() => handleIgnore(d.id)} />
          </div>
        </div>
      ))}
    </div>
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

      // Toast when a run transitions from running → error
      for (const run of next) {
        const prev = prevRunsRef.current.find((r) => r.id === run.id)
        if (prev?.status === 'running' && run.status === 'error') {
          toast.error(`Scan failed: ${run.error ?? 'unknown error'}`)
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
            <div className="text-[#f85149] text-[10px] mt-1 leading-tight break-words whitespace-pre-wrap">
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

  useEffect(() => {
    settingsApi.get()
      .then((res) => setIntervalValue(res.data.interval_seconds))
      .catch(() => {/* use default */})
  }, [])

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
            onChange={(e) => setIntervalValue(Number(e.target.value))}
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
          href={latest.url}
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

const MAC_OUI: Record<string, { label: string; title: string }> = {
  '52:54:00': { label: 'QEMU', title: 'QEMU/KVM Virtual Machine' },
  'bc:24:11': { label: 'PVE',  title: 'Proxmox Virtual Machine or LXC' },
  '00:50:56': { label: 'VMware', title: 'VMware Virtual Machine' },
  '00:0c:29': { label: 'VMware', title: 'VMware Virtual Machine' },
  '08:00:27': { label: 'VBox',  title: 'VirtualBox Virtual Machine' },
  '00:15:5d': { label: 'Hyper-V', title: 'Hyper-V Virtual Machine' },
}

function detectVirtualBadge(mac: string | null) {
  if (!mac) return null
  return MAC_OUI[mac.toLowerCase().slice(0, 8)] ?? null
}

function ServiceBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-1 py-0.5 rounded text-[9px] font-mono font-medium leading-none border"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}15` }}
    >
      {label}
    </span>
  )
}

interface ActionButtonProps {
  icon: React.ElementType
  label: string
  color?: 'green' | 'red'
  onClick: () => void
}

function ActionButton({ icon: Icon, label, color, onClick }: ActionButtonProps) {
  const colorClass =
    color === 'green' ? 'text-[#39d353] hover:bg-[#39d353]/10' :
    color === 'red' ? 'text-[#f85149] hover:bg-[#f85149]/10' :
    'text-muted-foreground hover:text-foreground hover:bg-[#30363d]'
  return (
    <Tooltip>
      <TooltipTrigger>
        <button onClick={onClick} className={`p-1 rounded ${colorClass} transition-colors`}>
          <Icon size={11} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
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
      className={`relative flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors ${
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
