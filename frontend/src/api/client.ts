import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'

export const api = axios.create({
  baseURL: '/api/v1',
})

// Unauthenticated axios instance — no JWT, no 401 redirect (used for public endpoints)
const publicApi = axios.create({ baseURL: '/api/v1' })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) useAuthStore.getState().logout()
    return Promise.reject(err)
  }
)

export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ access_token: string }>('/auth/login', { username, password }),
}

export const canvasApi = {
  load: () => api.get('/canvas'),
  save: (payload: {
    nodes: object[]
    edges: object[]
    viewport: object
    custom_style?: object | null
  }) => api.post('/canvas/save', payload),
}

export const nodesApi = {
  create: (data: object) => api.post('/nodes', data),
  update: (id: string, data: object) => api.patch(`/nodes/${id}`, data),
  delete: (id: string) => api.delete(`/nodes/${id}`),
}

export const edgesApi = {
  create: (data: object) => api.post('/edges', data),
  delete: (id: string) => api.delete(`/edges/${id}`),
}

export const liveviewApi = {
  load: (key: string) => publicApi.get('/liveview', { params: { key } }),
}

export const scanApi = {
  trigger: () => api.post('/scan/trigger'),
  pending: () => api.get('/scan/pending'),
  hidden: () => api.get('/scan/hidden'),
  runs: () => api.get('/scan/runs'),
  clearPending: () => api.delete('/scan/pending'),
  approve: (id: string, nodeData: object) => api.post(`/scan/pending/${id}/approve`, nodeData),
  hide: (id: string) => api.post(`/scan/pending/${id}/hide`),
  ignore: (id: string) => api.post(`/scan/pending/${id}/ignore`),
  bulkApprove: (ids: string[]) => api.post<{ approved: number; node_ids: string[]; device_ids: string[]; skipped: number }>('/scan/pending/bulk-approve', { device_ids: ids }),
  bulkHide: (ids: string[]) => api.post<{ hidden: number; skipped: number }>('/scan/pending/bulk-hide', { device_ids: ids }),
  stop: (runId: string) => api.post(`/scan/${runId}/stop`),
  getConfig: () => api.get<{ ranges: string[] }>('/scan/config'),
  saveConfig: (data: { ranges: string[] }) => api.post('/scan/config', data),
}

export const settingsApi = {
  get: () => api.get<{ interval_seconds: number }>('/settings'),
  save: (data: { interval_seconds: number }) => api.post<{ interval_seconds: number }>('/settings', data),
}

export const zigbeeApi = {
  testConnection: (data: {
    mqtt_host: string
    mqtt_port: number
    mqtt_username?: string
    mqtt_password?: string
    mqtt_tls?: boolean
    mqtt_tls_insecure?: boolean
  }) =>
    api.post<{ connected: boolean; message: string }>('/zigbee/test-connection', data),

  importNetwork: (data: {
    mqtt_host: string
    mqtt_port: number
    mqtt_username?: string
    mqtt_password?: string
    base_topic?: string
    mqtt_tls?: boolean
    mqtt_tls_insecure?: boolean
  }) =>
    api.post<{
      nodes: import('@/components/zigbee/types').ZigbeeNode[]
      edges: import('@/components/zigbee/types').ZigbeeEdge[]
      device_count: number
    }>('/zigbee/import', data),
}
