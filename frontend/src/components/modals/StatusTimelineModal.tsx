import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Loader2, RefreshCw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { nodeHistoryApi } from '@/api/client'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { toast } from 'sonner'

interface StatusHistoryItem {
  id: string
  node_id: string
  node_label: string
  status: string
  response_time_ms: number | null
  checked_at: string
}

interface StatusTimelineModalProps {
  open: boolean
  onClose: () => void
}

interface GroupedStatus {
  nodeId: string
  label: string
  events: StatusHistoryItem[]
}

interface TimelineSegment extends StatusHistoryItem {
  startPercent: number
  widthPercent: number
}

const HOURS = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, '0')}:00`)

function toIsoRange(date: string) {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(`${date}T23:59:59`)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function getStatusTone(status: string) {
  if (status === 'online') return '#39d353'
  if (status === 'offline') return '#f85149'
  return '#8b949e'
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '')
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized
  const int = Number.parseInt(value, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getMinuteOffset(dateIso: string) {
  const date = new Date(dateIso)
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

function formatCheckTime(dateIso: string) {
  return new Date(dateIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatShortTime(dateIso: string) {
  return new Date(dateIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getSectorLabel(startMinute: number, sectorMinutes: number) {
  const start = new Date()
  start.setHours(0, Math.floor(startMinute), 0, 0)
  const end = new Date()
  end.setHours(0, Math.min(24 * 60, Math.floor(startMinute + sectorMinutes)), 0, 0)
  const format = (value: Date) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${format(start)} - ${format(end)}`
}

function buildSegments(events: StatusHistoryItem[]): TimelineSegment[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((a, b) => +new Date(a.checked_at) - +new Date(b.checked_at))
  return sorted.map((event, index) => {
    const startMinute = getMinuteOffset(event.checked_at)
    const nextMinute = index < sorted.length - 1 ? getMinuteOffset(sorted[index + 1].checked_at) : 24 * 60
    const endMinute = Math.max(startMinute + 3, nextMinute)
    return {
      ...event,
      startPercent: (startMinute / (24 * 60)) * 100,
      widthPercent: Math.max(0.35, ((endMinute - startMinute) / (24 * 60)) * 100),
    }
  })
}

function findSegmentForMinute(segments: TimelineSegment[], minute: number) {
  return segments.find((segment) => {
    const startMinute = (segment.startPercent / 100) * 24 * 60
    const endMinute = startMinute + (segment.widthPercent / 100) * 24 * 60
    return minute >= startMinute && minute < endMinute
  }) ?? null
}

function TimelineRow({ group, detailed, active }: { group: GroupedStatus; detailed: boolean; active: boolean }) {
  const segments = useMemo(() => buildSegments(group.events), [group.events])
  const latestStatus = group.events[group.events.length - 1]?.status ?? 'unknown'
  const sectorMinutes = detailed ? 15 : 60
  const sectorCount = (24 * 60) / sectorMinutes
  const [activeSectorIndex, setActiveSectorIndex] = useState<number | null>(null)

  useEffect(() => {
    setActiveSectorIndex(null)
  }, [group.nodeId, detailed])

  const sectorInfo = useMemo(() => {
    if (activeSectorIndex == null) return null
    const startMinute = activeSectorIndex * sectorMinutes
    const segment = findSegmentForMinute(segments, startMinute)
    return {
      label: getSectorLabel(startMinute, sectorMinutes),
      segment,
    }
  }, [activeSectorIndex, sectorMinutes, segments])

  return (
    <div className={`grid gap-2 items-center ${detailed ? 'grid-cols-1' : 'grid-cols-[220px_minmax(0,1fr)]'}`}>
      {!detailed && (
        <div className={`rounded-2xl border px-3 py-3 transition-colors ${active ? 'border-[#00d4ff]/35 bg-[#112131]' : 'border-border bg-[#0f1722]'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-foreground">{group.label}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{group.events.length} checks</div>
            </div>
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: getStatusTone(latestStatus) }}
              title={latestStatus}
            />
          </div>
        </div>
      )}

      <div className={`rounded-2xl border p-3 transition-colors ${active ? 'border-[#00d4ff]/25 bg-[#0d1621]' : 'border-border bg-[#0b131d]'}`}>
        {detailed && (
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-medium text-foreground">{group.label}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{group.events.length} checks in the selected day</div>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getStatusTone(latestStatus) }} />
                {latestStatus}
              </span>
            </div>
          </div>
        )}

        <div className={`grid ${detailed ? 'grid-cols-[repeat(24,minmax(0,1fr))]' : 'grid-cols-[repeat(24,minmax(0,1fr))]'} gap-2 border-b border-border pb-3 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground`}>
          {HOURS.map((hour) => (
            <div key={`${group.nodeId}-${hour}`} className="text-center">{hour}</div>
          ))}
        </div>

        <div className={`relative mt-3 overflow-hidden rounded-2xl border border-white/5 ${detailed ? 'h-24' : 'h-14'}`}>
          <div
            className={`absolute inset-0 grid ${detailed ? 'grid-cols-96' : 'grid-cols-24'} overflow-hidden z-10`}
            onMouseLeave={() => setActiveSectorIndex(null)}
            onPointerLeave={() => setActiveSectorIndex(null)}
          >
            {Array.from({ length: sectorCount }, (_, index) => (
              <button
                key={`${group.nodeId}-sector-${index}`}
                type="button"
                className={`border-r border-white/6 last:border-r-0 transition-colors focus:outline-none ${activeSectorIndex === index ? 'bg-white/10' : 'bg-transparent hover:bg-white/5'}`}
                onMouseEnter={() => setActiveSectorIndex(index)}
                onFocus={() => setActiveSectorIndex(index)}
                onBlur={() => setActiveSectorIndex(null)}
                onClick={() => setActiveSectorIndex(index)}
                aria-label={`Sector ${getSectorLabel(index * sectorMinutes, sectorMinutes)}`}
              />
            ))}
          </div>

          {segments.map((segment) => {
            const tone = getStatusTone(segment.status)
            return (
              <div
                key={segment.id}
                className="pointer-events-none absolute inset-y-2 overflow-hidden rounded-xl border text-[10px] font-mono text-white"
                style={{
                  left: `${segment.startPercent}%`,
                  width: `${segment.widthPercent}%`,
                  minWidth: detailed ? '26px' : '18px',
                  borderColor: hexToRgba(tone, 0.92),
                  background: `linear-gradient(90deg, ${hexToRgba(tone, 0.2)} 0%, ${hexToRgba(tone, 0.82)} 16%, ${hexToRgba(tone, 0.86)} 100%)`,
                }}
                title={`${segment.status} - ${formatCheckTime(segment.checked_at)}${segment.response_time_ms != null ? ` - ${segment.response_time_ms} ms` : ''}`}
              >
                <div className="absolute inset-y-0 left-0 w-px bg-white/35" />
                <div className="relative flex h-full min-w-0 items-center gap-2 px-2 py-1">
                  <div className="h-2 w-2 shrink-0 rounded-full bg-white/85" />
                  <div className="min-w-0 leading-tight">
                    <div className="truncate">{segment.status}</div>
                    <div className="truncate opacity-80">{formatShortTime(segment.checked_at)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3 rounded-xl border border-border bg-[#0a1118] px-3 py-2 text-xs">
          {sectorInfo?.segment ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-[#8b949e]">{sectorInfo.label}</span>
              <span className="inline-flex items-center gap-1 text-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getStatusTone(sectorInfo.segment.status) }} />
                {sectorInfo.segment.status}
              </span>
              <span className="font-mono text-[#dff9ff]">{formatCheckTime(sectorInfo.segment.checked_at)}</span>
              {sectorInfo.segment.response_time_ms != null && (
                <span className="font-mono text-muted-foreground">{sectorInfo.segment.response_time_ms} ms</span>
              )}
            </div>
          ) : sectorInfo ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[#8b949e]">{sectorInfo.label}</span>
              <span className="text-muted-foreground">No checks in this sector</span>
            </div>
          ) : (
            <div className="text-muted-foreground">
              {detailed ? 'Tap or hover a sector to inspect the check for that interval.' : 'Hover or tap a sector to inspect its check.'}
            </div>
          )}
        </div>

        {detailed && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {[...group.events]
              .sort((a, b) => +new Date(b.checked_at) - +new Date(a.checked_at))
              .map((event) => (
                <div
                  key={event.id}
                  className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
                    sectorInfo?.segment?.id === event.id
                      ? 'border-[#00d4ff]/45 bg-[#112131]'
                      : 'border-border bg-[#0a1118]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getStatusTone(event.status) }} />
                      {event.status}
                    </span>
                    <span className="font-mono text-muted-foreground">{formatCheckTime(event.checked_at)}</span>
                  </div>
                  {event.response_time_ms != null && (
                    <div className="mt-1 font-mono text-[11px] text-[#dff9ff]">{event.response_time_ms} ms</div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function StatusTimelineModal({ open, onClose }: StatusTimelineModalProps) {
  const intervalSeconds = useSettingsStore((s) => s.intervalSeconds)
  const nodesState = useCanvasStore((s) => s.nodes)
  const nodes = Array.isArray(nodesState) ? nodesState : []
  const [items, setItems] = useState<StatusHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [filterNodeId, setFilterNodeId] = useState('all')
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!open) return
    const firstLoad = items.length === 0
    if (firstLoad) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const range = toIsoRange(selectedDate)
      const res = await nodeHistoryApi.list({
        node_id: filterNodeId !== 'all' ? filterNodeId : undefined,
        start_date: range.start,
        end_date: range.end,
        limit: 10000,
      })
      setItems(res.data as StatusHistoryItem[])
    } catch {
      toast.error('Failed to load status timeline')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [open, selectedDate, filterNodeId, items.length])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  useEffect(() => {
    if (!open || intervalSeconds <= 0) return
    const timer = window.setInterval(load, intervalSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [open, intervalSeconds, load])

  const groups = useMemo<GroupedStatus[]>(() => {
    const grouped = new Map<string, { label: string; events: StatusHistoryItem[] }>()
    for (const item of [...items].reverse()) {
      const existing = grouped.get(item.node_id)
      if (existing) {
        existing.events.push(item)
      } else {
        grouped.set(item.node_id, { label: item.node_label, events: [item] })
      }
    }
    return [...grouped.entries()]
      .map(([nodeId, value]) => ({ nodeId, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [items])

  useEffect(() => {
    if (groups.length === 0) {
      setActiveNodeId(null)
      return
    }
    if (activeNodeId && !groups.some((group) => group.nodeId === activeNodeId)) {
      setActiveNodeId(null)
    }
  }, [groups, activeNodeId])

  useEffect(() => {
    if (!open) return
    setActiveNodeId(null)
  }, [open, selectedDate, filterNodeId])

  const nodeOptions = useMemo(
    () => nodes
      .filter((node) => node.data.type !== 'groupRect' && node.data.type !== 'group')
      .map((node) => ({ id: node.id, label: node.data.label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  )

  const totalOnline = items.filter((item) => item.status === 'online').length
  const totalOffline = items.filter((item) => item.status === 'offline').length
  const displayedGroups = activeNodeId ? groups.filter((group) => group.nodeId === activeNodeId) : groups

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent
        className="max-w-none w-[calc(100vw-16px)] h-[calc(100vh-16px)] p-0 overflow-hidden bg-[#081019] text-foreground border border-border"
        style={{ width: 'calc(100vw - 16px)', maxWidth: 'calc(100vw - 16px)', height: 'calc(100vh - 16px)' }}
      >
        <DialogHeader className="border-b border-border px-6 py-4 bg-[linear-gradient(180deg,rgba(0,212,255,0.08),rgba(8,16,25,0.2))]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#00d4ff]/20 bg-[#00d4ff]/10 text-[#00d4ff] shadow-[0_0_24px_rgba(0,212,255,0.12)]">
                <Activity size={20} />
              </div>
              <div>
                <DialogTitle>Status Timeline</DialogTitle>
                <p className="text-xs text-muted-foreground">24h grid view without horizontal card scrolling.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-md border border-border bg-[#11161d] px-3 py-2 text-xs text-foreground"
              />
              <select
                value={filterNodeId}
                onChange={(event) => setFilterNodeId(event.target.value)}
                className="min-w-[240px] rounded-md border border-border bg-[#11161d] px-3 py-2 text-xs text-foreground"
              >
                <option value="all">All devices</option>
                {nodeOptions.map((node) => (
                  <option key={node.id} value={node.id}>{node.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={load}
                className="flex items-center gap-1 rounded-md border border-border bg-[#11161d] px-3 py-2 text-xs text-foreground hover:bg-[#18202a]"
              >
                {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {refreshing ? 'Refreshing' : 'Refresh'}
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-r border-border bg-[linear-gradient(180deg,#09111a,#0c1621)] px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="Devices" value={String(groups.length)} tone="cyan" />
              <MetricCard label="Checks" value={String(items.length)} tone="slate" />
              <MetricCard label="Online" value={String(totalOnline)} tone="green" />
              <MetricCard label="Offline" value={String(totalOffline)} tone="red" />
            </div>
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Devices</p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setActiveNodeId(null)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                    activeNodeId == null
                      ? 'border-[#00d4ff]/40 bg-[#00d4ff]/10 text-[#dff9ff]'
                      : 'border-border bg-[#0f1722] text-muted-foreground hover:bg-[#15202c]'
                  }`}
                >
                  <span>All devices</span>
                  <span className="text-[11px] font-mono">{groups.length}</span>
                </button>
                {groups.map((group) => (
                  <button
                    key={group.nodeId}
                    type="button"
                    onClick={() => setActiveNodeId(group.nodeId)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      activeNodeId === group.nodeId
                        ? 'border-[#00d4ff]/40 bg-[#00d4ff]/10 text-[#dff9ff]'
                        : 'border-border bg-[#0f1722] text-muted-foreground hover:bg-[#15202c]'
                    }`}
                  >
                    <span className="truncate">{group.label}</span>
                    <span className="text-[11px] font-mono">{group.events.length}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(0,212,255,0.08),transparent_32%),linear-gradient(180deg,#0a111b,#0d1117)] px-5 py-4">
            {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading status timeline...</p>}
            {!loading && displayedGroups.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">No checks recorded for this day.</p>
              </div>
            )}
            {!loading && displayedGroups.length > 0 && (
              <div className="rounded-3xl border border-border bg-[linear-gradient(180deg,rgba(17,22,29,0.98),rgba(13,17,23,0.98))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                <div className="mt-3 space-y-2">
                  {displayedGroups.map((group) => (
                    <TimelineRow
                      key={group.nodeId}
                      group={group}
                      detailed={activeNodeId === group.nodeId}
                      active={activeNodeId === group.nodeId || (activeNodeId == null && filterNodeId === 'all')}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'green' | 'red' | 'slate' }) {
  const styles = {
    cyan: 'border-[#00d4ff]/20 bg-[#00d4ff]/10 text-[#dff9ff]',
    green: 'border-[#39d353]/20 bg-[#39d353]/10 text-[#dff9e8]',
    red: 'border-[#f85149]/20 bg-[#f85149]/10 text-[#ffe7e5]',
    slate: 'border-border bg-[#0f1722] text-[#e6edf3]',
  }
  return (
    <div className={`rounded-2xl border px-3 py-3 ${styles[tone]}`}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}
