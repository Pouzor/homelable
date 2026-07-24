import { useEffect, useRef } from 'react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAuthStore } from '@/stores/authStore'
import type { ServiceStatus } from '@/types'

interface ServiceStatusEntry {
  port?: number
  protocol?: string
  status: ServiceStatus
}

interface StatusMessage {
  type?: string
  node_id?: string
  status?: 'online' | 'offline' | 'pending' | 'unknown'
  checked_at?: string
  response_time_ms?: number | null
  run_id?: string
  devices_found?: number
  services?: ServiceStatusEntry[]
}

const STANDALONE = import.meta.env.VITE_STANDALONE === 'true'

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
        } else if (msg.type === 'service_status' && msg.node_id && msg.services) {
          setServiceStatuses(msg.node_id, msg.services)
        } else if (msg.node_id && msg.status) {
          // Live status is monitoring data, not a user edit — must not dirty the
          // canvas (otherwise autosave rewrites an untouched canvas every cycle).
          setNodeStatus(msg.node_id, {
            status: msg.status,
            response_time_ms: msg.response_time_ms ?? undefined,
            last_seen: msg.status === 'online' ? msg.checked_at : undefined,
          })
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
