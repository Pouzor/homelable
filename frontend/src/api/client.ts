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
  approve: (id: string, nodeData: object) => api.post(`/scan/pending/${id}/approve`, nodeData),
  hide: (id: string) => api.post(`/scan/pending/${id}/hide`),
  ignore: (id: string) => api.post(`/scan/pending/${id}/ignore`),
  stop: (runId: string) => api.post(`/scan/${runId}/stop`),
  getConfig: () => api.get<{ ranges: string[] }>('/scan/config'),
  saveConfig: (data: { ranges: string[] }) => api.post('/scan/config', data),
}

export const settingsApi = {
  get: () => api.get<{
    interval_seconds: number
    scan_interval_seconds: number
    default_node_color: string | null
    default_edge_color: string | null
    node_type_colors: Record<string, string>
    edge_type_colors: Record<string, string>
  }>('/settings'),
  save: (data: {
    interval_seconds: number
    scan_interval_seconds: number
    default_node_color: string | null
    default_edge_color: string | null
    node_type_colors: Record<string, string>
    edge_type_colors: Record<string, string>
  }) =>
    api.post<{
      interval_seconds: number
      scan_interval_seconds: number
      default_node_color: string | null
      default_edge_color: string | null
      node_type_colors: Record<string, string>
      edge_type_colors: Record<string, string>
    }>('/settings', data),
}

export const nodeHistoryApi = {
  list: (params?: { node_id?: string; start_date?: string; end_date?: string; limit?: number }) => api.get('/node-history', { params }),
}
