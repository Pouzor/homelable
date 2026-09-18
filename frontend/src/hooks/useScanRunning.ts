import { useEffect, useState } from 'react'
import { scanApi, type ScanRunSummary } from '@/api/client'

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

/** How often to ask. Slow on purpose: this only drives a spinning icon, the
 *  Scan History modal owns the live detail and polls every 3s while open. */
const POLL_MS = 5000

/**
 * True while any scan / import run is in flight.
 *
 * Lets the sidebar show a scan is running without the user opening Scan
 * History. A run can be started from anywhere (sidebar, import modals, the
 * scheduler), so this polls rather than tracking what this tab kicked off.
 * Standalone has no backend: always false, and never a request.
 */
export function useScanRunning(): boolean {
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (STANDALONE) return
    let cancelled = false

    const check = async () => {
      try {
        const res = await scanApi.runs()
        const runs = (res.data ?? []) as ScanRunSummary[]
        if (!cancelled) setRunning(runs.some((r) => r.status === 'running'))
      } catch {
        // A failed poll is not evidence of a run; stay quiet, the modal reports.
        if (!cancelled) setRunning(false)
      }
    }

    check()
    const id = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return running
}
