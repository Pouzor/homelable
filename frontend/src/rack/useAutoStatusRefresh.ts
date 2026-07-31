/**
 * Keeps "check device" mounts live.
 *
 * The status checker runs in the backend and reaches the rack only through the
 * Device Inventory (`node_status` on each row), which the rack fetches once on
 * load. A mount set to `auto` would therefore freeze on the state it had when
 * the canvas opened — so poll while at least one mount follows a node, and stop
 * as soon as none does. The refresh writes inventory only: it never dirties the
 * canvas, so autosave stays quiet.
 */
import { useEffect } from 'react'
import { useRackStore } from './store'

/** Matches the backend's default `STATUS_CHECKER_INTERVAL`. */
export const AUTO_STATUS_INTERVAL_MS = 60_000

export function useAutoStatusRefresh(intervalMs: number = AUTO_STATUS_INTERVAL_MS) {
  const refreshInventory = useRackStore((s) => s.refreshInventory)
  const following = useRackStore((s) => s.devices.some((d) => d.status === 'auto'))

  useEffect(() => {
    if (!following) return
    const timer = setInterval(() => void refreshInventory(), intervalMs)
    return () => clearInterval(timer)
  }, [following, intervalMs, refreshInventory])
}
