import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import type { ServiceStatus } from '@/types'

interface ServiceStatusEntry {
  port?: number
  protocol?: string
  /** Per-service host override, part of the overlay key — several vhosts can
   *  share one port on one node. Null when the service has none. */
  host?: string | null
  status: ServiceStatus
}

interface StatusMessage {
  type?: string
  /** The device that was checked. A device is checked once, however many
   *  canvases draw it. */
  device_id?: string
  /** The nodes drawing that device, as the backend knew them at check time. */
  node_ids?: string[]
  status?: 'online' | 'offline' | 'pending' | 'unknown'
  checked_at?: string
  response_time_ms?: number | null
  run_id?: string
  devices_found?: number
  services?: ServiceStatusEntry[]
}

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

/**
 * The nodes a device-scoped message applies to.
 *
 * The backend sends the node ids it knew at check time; a node placed since
 * then is resolved from the store by `device_id`, so a freshly approved device
 * lights up on the first cycle rather than the second.
 */
function targets(msg: StatusMessage): string[] {
  const known = msg.node_ids ?? []
  if (!msg.device_id) return known
  // `getState` is absent when the store is mocked; the message's own list is
  // then the whole answer.
  const nodes = useCanvasStore.getState?.()?.nodes ?? []
  const fromStore = nodes
    .filter((n) => n.data.device_id === msg.device_id)
    .map((n) => n.id)
  return [...new Set([...known, ...fromStore])]
}

export function useStatusPolling() {
  const wsRef = useRef<WebSocket | null>(null)
  const { setNodeStatus, notifyScanDeviceFound, setServiceStatuses } = useCanvasStore()
  const { isAuthenticated, authMethod, token } = useAuthStore()

  useEffect(() => {
    if (STANDALONE || !isAuthenticated || (authMethod !== 'oidc' && !token)) return

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host  // includes port when non-standard
    const url = `${protocol}://${host}/api/v1/status/ws/status`

    const ws = new WebSocket(url)
    wsRef.current = ws

    // Local mode sends the bearer token as the first message (not in the URL
    // where proxies may log it). OIDC mode is authenticated during the upgrade
    // with the backend's HttpOnly session cookie, so React sends no credential.
    if (token) {
      ws.onopen = () => {
        ws.send(JSON.stringify({ token }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg: StatusMessage = JSON.parse(event.data)
        if (msg.type === 'scan_device_found') {
          notifyScanDeviceFound()
        } else if (msg.type === 'service_status' && msg.services) {
          for (const nodeId of targets(msg)) setServiceStatuses(nodeId, msg.services)
        } else if (msg.status) {
          // Live status is monitoring data, not a user edit — must not dirty the
          // canvas (otherwise autosave rewrites an untouched canvas every cycle).
          // One check lights up every node drawing that device.
          for (const nodeId of targets(msg)) {
            setNodeStatus(nodeId, {
              status: msg.status,
              response_time_ms: msg.response_time_ms ?? undefined,
              last_seen: msg.status === 'online' ? msg.checked_at : undefined,
            })
          }
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => {
      // silently ignore — backend may not be running in dev
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [isAuthenticated, authMethod, token, setNodeStatus, notifyScanDeviceFound, setServiceStatuses])
}
