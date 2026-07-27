import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type { AuthMode, AuthUser } from '@/stores/authStore'

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
})

// Unauthenticated axios instance — no JWT, no 401 redirect (used for public endpoints)
const publicApi = axios.create({ baseURL: '/api/v1' })

api.interceptors.request.use((config) => {
  const { token, csrfToken } = useAuthStore.getState()
  if (token) config.headers.Authorization = `Bearer ${token}`
  const method = config.method?.toUpperCase() ?? 'GET'
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    config.headers['X-Homelable-CSRF'] = csrfToken
  }
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
  config: () => publicApi.get<{ mode: AuthMode; oidc_login_url: string | null }>('/auth/config'),
  login: (username: string, password: string) =>
    api.post<{ access_token: string }>('/auth/login', { username, password }),
  me: () => api.get<AuthUser>('/auth/me'),
  logout: () => api.post('/auth/logout'),
}

export const canvasApi = {
  load: (design_id?: string) => {
    const params = design_id ? { design_id } : {}
    return api.get('/canvas', { params })
  },
  save: (payload: {
    nodes: object[]
    edges: object[]
    viewport: object
    custom_style?: object | null
    design_id?: string | null
  }) => api.post('/canvas/save', payload),
}

export const mediaApi = {
  /** Upload an image, returns its server URL (e.g. /api/v1/media/<uuid>.png). */
  upload: async (file: File): Promise<{ url: string; filename: string }> => {
    const form = new FormData()
    form.append('file', file)
    const res = await api.post<{ url: string; filename: string }>('/media/upload', form)
    return res.data
  },
  delete: (filename: string) => api.delete(`/media/${filename}`),
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
  load: (key: string, design?: string) =>
    publicApi.get('/liveview', { params: { key, ...(design ? { design_id: design } : {}) } }),
  getConfig: () => api.get<{ enabled: boolean; key: string | null }>('/liveview/config'),
}

export interface DeepScanConfig {
  http_ranges: string[]
  http_probe_enabled: boolean
  verify_tls: boolean
}

export type ScanConfigData = { ranges: string[] } & DeepScanConfig

// A device the backend refused to place because an equivalent node already
// exists on the target design (same ip/mac/ieee). `existing_node_id` points at
// the node already there so the UI can link to it.
export interface SkippedDevice {
  device_id: string
  label: string
  match: 'ip' | 'mac' | 'ieee'
  value: string
  existing_node_id: string | null
}

// 409 body from single approve / create when a same-design duplicate is found.
export interface DuplicateNodeConflict {
  duplicate: true
  existing_node_id: string
  existing_label: string
  match: 'ip' | 'mac' | 'ieee'
  value: string
}

export const scanApi = {
  trigger: (deepScan?: Partial<DeepScanConfig>) => api.post('/scan/trigger', deepScan ?? {}),
  pending: () => api.get('/scan/pending'),
  hidden: () => api.get('/scan/hidden'),
  runs: () => api.get('/scan/runs'),
  clearPending: () => api.delete('/scan/pending'),
  approve: (id: string, nodeData: object) =>
    api.post<{
      approved: boolean
      node_id: string
      edges_created: number
      edges: { id: string; source: string; target: string; type?: string; source_handle?: string | null; target_handle?: string | null }[]
    }>(`/scan/pending/${id}/approve`, nodeData),
  hide: (id: string) => api.post(`/scan/pending/${id}/hide`),
  ignore: (id: string) => api.post(`/scan/pending/${id}/ignore`),
  bulkApprove: (ids: string[], designId?: string | null) =>
    api.post<{
      approved: number
      node_ids: string[]
      device_ids: string[]
      edges_created: number
      edges: { id: string; source: string; target: string; type?: string; source_handle?: string | null; target_handle?: string | null }[]
      skipped: number
      skipped_devices: SkippedDevice[]
    }>('/scan/pending/bulk-approve', { device_ids: ids, design_id: designId ?? undefined }),
  bulkHide: (ids: string[]) => api.post<{ hidden: number; skipped: number }>('/scan/pending/bulk-hide', { device_ids: ids }),
  restore: (id: string) => api.post<{ restored: boolean; device_id: string }>(`/scan/pending/${id}/restore`),
  bulkRestore: (ids: string[]) => api.post<{ restored: number; skipped: number }>('/scan/pending/bulk-restore', { device_ids: ids }),
  stop: (runId: string) => api.post(`/scan/${runId}/stop`),
  getConfig: () => api.get<ScanConfigData>('/scan/config'),
  saveConfig: (data: ScanConfigData) => api.post('/scan/config', data),
}

export interface AppSettings {
  interval_seconds: number
  service_check_enabled: boolean
  service_check_interval: number
}

export const settingsApi = {
  get: () => api.get<AppSettings>('/settings'),
  save: (data: AppSettings) => api.post<AppSettings>('/settings', data),
}

export interface ProxmoxConnection {
  host: string
  port: number
  token_id?: string
  token_secret?: string
  verify_tls?: boolean
}

export interface ProxmoxConfigData {
  host: string
  port: number
  verify_tls: boolean
  sync_enabled: boolean
  sync_interval: number
  token_configured: boolean
}

export const proxmoxApi = {
  testConnection: (data: ProxmoxConnection) =>
    api.post<{ connected: boolean; message: string }>('/proxmox/test-connection', data),

  importNetwork: (data: ProxmoxConnection) =>
    api.post<{
      nodes: import('@/components/proxmox/types').ProxmoxNode[]
      edges: import('@/components/proxmox/types').ProxmoxEdge[]
      device_count: number
    }>('/proxmox/import', data),

  importToPending: (data: ProxmoxConnection) =>
    api.post<{
      id: string
      status: string
      kind: string
      ranges: string[]
      devices_found: number
      started_at: string
      finished_at: string | null
      error: string | null
    }>('/proxmox/import-pending', data),

  getConfig: () => api.get<ProxmoxConfigData>('/proxmox/config'),
  // Only the auto-sync activation is persisted. Connection config
  // (host/port/token/verify_tls) is env-only and never sent.
  saveConfig: (data: { sync_enabled: boolean; sync_interval: number }) =>
    api.post<ProxmoxConfigData>('/proxmox/config', data),

  syncNow: () =>
    api.post<{
      id: string
      status: string
      kind: string
      ranges: string[]
      devices_found: number
      started_at: string
      finished_at: string | null
      error: string | null
    }>('/proxmox/sync-now'),
}

export const designsApi = {
  list: () => api.get<import('@/types').Design[]>('/designs'),
  create: (data: { name: string; icon?: string; design_type?: string }) =>
    api.post<import('@/types').Design>('/designs', data),
  copy: (sourceId: string, data: { name: string; icon?: string }) =>
    api.post<import('@/types').Design>(`/designs/${sourceId}/copy`, data),
  update: (id: string, data: { name?: string; icon?: string }) =>
    api.put<import('@/types').Design>(`/designs/${id}`, data),
  delete: (id: string) => api.delete(`/designs/${id}`),
}

export interface ZigbeeConfigData {
  mqtt_host: string
  mqtt_port: number
  base_topic: string
  mqtt_tls: boolean
  sync_enabled: boolean
  sync_interval: number
  host_configured: boolean
}

export interface ZwaveConfigData {
  mqtt_host: string
  mqtt_port: number
  prefix: string
  gateway_name: string
  mqtt_tls: boolean
  sync_enabled: boolean
  sync_interval: number
  host_configured: boolean
}

// Shape returned by every background-scan trigger (import-pending / sync-now).
interface ScanRunResult {
  id: string
  status: string
  kind: string
  ranges: string[]
  devices_found: number
  started_at: string
  finished_at: string | null
  error: string | null
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

  importToPending: (data: {
    mqtt_host: string
    mqtt_port: number
    mqtt_username?: string
    mqtt_password?: string
    base_topic?: string
    mqtt_tls?: boolean
    mqtt_tls_insecure?: boolean
  }) =>
    api.post<{
      id: string
      status: string
      kind: string
      ranges: string[]
      devices_found: number
      started_at: string
      finished_at: string | null
      error: string | null
    }>('/zigbee/import-pending', data),

  getConfig: () => api.get<ZigbeeConfigData>('/zigbee/config'),
  // Only the auto-sync activation is persisted. MQTT connection config
  // (host/port/credentials/topic/tls) is env-only and never sent.
  saveConfig: (data: { sync_enabled: boolean; sync_interval: number }) =>
    api.post<ZigbeeConfigData>('/zigbee/config', data),
  syncNow: () => api.post<ScanRunResult>('/zigbee/sync-now'),
}

export const zwaveApi = {
  testConnection: (data: {
    mqtt_host: string
    mqtt_port: number
    mqtt_username?: string
    mqtt_password?: string
    mqtt_tls?: boolean
    mqtt_tls_insecure?: boolean
  }) =>
    api.post<{ connected: boolean; message: string }>('/zwave/test-connection', data),

  importNetwork: (data: {
    mqtt_host: string
    mqtt_port: number
    mqtt_username?: string
    mqtt_password?: string
    prefix?: string
    gateway_name?: string
    mqtt_tls?: boolean
    mqtt_tls_insecure?: boolean
  }) =>
    api.post<{
      nodes: import('@/components/zwave/types').ZwaveNode[]
      edges: import('@/components/zwave/types').ZwaveEdge[]
      device_count: number
    }>('/zwave/import', data),

  importToPending: (data: {
    mqtt_host: string
    mqtt_port: number
    mqtt_username?: string
    mqtt_password?: string
    prefix?: string
    gateway_name?: string
    mqtt_tls?: boolean
    mqtt_tls_insecure?: boolean
  }) =>
    api.post<{
      id: string
      status: string
      kind: string
      ranges: string[]
      devices_found: number
      started_at: string
      finished_at: string | null
      error: string | null
    }>('/zwave/import-pending', data),

  getConfig: () => api.get<ZwaveConfigData>('/zwave/config'),
  // Only the auto-sync activation is persisted. MQTT connection config
  // (host/port/credentials/prefix/gateway/tls) is env-only and never sent.
  saveConfig: (data: { sync_enabled: boolean; sync_interval: number }) =>
    api.post<ZwaveConfigData>('/zwave/config', data),
  syncNow: () => api.post<ScanRunResult>('/zwave/sync-now'),
}
