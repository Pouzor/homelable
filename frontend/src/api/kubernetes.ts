import { api } from './client'
import type { KubernetesStatus, KubernetesTopology } from '@/types/kubernetes'

/** Read-only Kubernetes topology endpoints. There are intentionally no CRUD calls here. */
export const kubernetesApi = {
  status: () => api.get<KubernetesStatus>('/kubernetes/status'),
  topology: () => api.get<KubernetesTopology>('/kubernetes/topology'),
}
