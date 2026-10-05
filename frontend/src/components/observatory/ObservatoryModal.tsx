import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ObservatorySnapshot {
  enabled: boolean
  dashboard_url?: string
  stale?: boolean
  snapshot?: {
    stale_after_seconds: number
    collected_at: string
    collection_state: string
    host: { name: string; cpu_percent: number | null; memory_used_gib: number | null; memory_total_gib: number | null }
    guests: { id: string | number; kind: string; name: string; state: string }[]
  }
  insights?: { level: string; title: string; explanation: string }[]
}

export function ObservatoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<ObservatorySnapshot | null>(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [open])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    api.get<ObservatorySnapshot>('/observatory/snapshot', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setData(data) })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [open, revision])
  const sample = data?.snapshot
  const host = sample?.host
  const age = sample ? (now - Date.parse(sample.collected_at)) / 1000 : 0
  const stale = data?.stale || (sample && (age < -60 || age > sample.stale_after_seconds))
  const memory = host?.memory_used_gib != null && host?.memory_total_gib != null && host.memory_total_gib > 0
    ? `${(100 * host.memory_used_gib / host.memory_total_gib).toFixed(1)}%` : 'Unknown'
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
    <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Observatory monitoring</DialogTitle>
        <DialogDescription>Read-only measurements alongside your infrastructure map. History stays in Observatory.</DialogDescription>
      </DialogHeader>
      <Button variant="outline" onClick={() => { setData(null); setError(false); setRevision((n) => n + 1) }}>Refresh measurements</Button>
      {error && <p role="alert">Observatory is unavailable. Check its connection and integration settings.</p>}
      {!data && !error && <p role="status">Loading measurements…</p>}
      {data && !data.enabled && <p>Not connected. Configure the optional Observatory integration on your Homelable server. No network requests are made until it is configured.</p>}
      {sample && host && <>
        <p>{host.name} · Collected {new Date(sample.collected_at).toLocaleString()} · {sample.collection_state}</p>
        {stale && <p role="alert">These measurements are stale. Refresh before relying on them.</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-border p-3">CPU <strong className="block text-2xl">{host.cpu_percent == null ? 'Unknown' : `${host.cpu_percent}%`}</strong></div>
          <div className="rounded border border-border p-3">Memory <strong className="block text-2xl">{memory}</strong></div>
        </div>
        <h3 className="font-semibold">Guests</h3>
        {sample.guests.length === 0 && <p>No guests returned; check collection and permissions.</p>}
        <ul className="space-y-2">{sample.guests.map((guest) => <li key={`${guest.kind}-${guest.id}`} className="flex justify-between gap-3 border-b border-border pb-2"><span>{guest.name} · {guest.kind} {guest.id}</span><span>{guest.state}</span></li>)}</ul>
        <h3 className="font-semibold">Health findings</h3>
        {data?.insights?.map((finding, index) => <details key={index} className="rounded border border-border p-3"><summary className="cursor-pointer">{finding.title} · {finding.level}</summary><p className="mt-2 text-muted-foreground">{finding.explanation}</p></details>)}
        <nav aria-label="Observatory detail pages" className="flex flex-wrap gap-4">
          {[['Overview', ''], ['Resource history', '/resources'], ['Storage', '/storage'], ['Network', '/network'], ['Activity', '/events'], ['Operations', '/operations']].map(([label, path]) => <a key={label} href={`${data?.dashboard_url}${path}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">{label} ↗</a>)}
        </nav>
        <p className="text-xs text-muted-foreground">Snapshot only. This view does not change devices, scan the network, or copy history. Detail pages use your existing Observatory sign-in.</p>
      </>}
    </DialogContent>
  </Dialog>
}
