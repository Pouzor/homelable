import type { ServiceInfo } from '@/types'

/** String-based shape the service editor works with. */
export interface ServiceFormData {
  service_name: string
  port: string
  protocol: 'tcp' | 'udp'
  path: string
  host: string
  icon?: string
}

/** Fields a submitted service form contributes. `undefined` clears the field. */
export interface ServiceSubmitData {
  service_name: string
  protocol: 'tcp' | 'udp'
  port: number | undefined
  path: string | undefined
  host: string | undefined
  icon: string | undefined
}

export const EMPTY_SERVICE_FORM: ServiceFormData = {
  service_name: '',
  port: '',
  protocol: 'tcp',
  path: '',
  host: '',
}

/** Turn a stored service into the string-based form shape. */
export function serviceToForm(svc: ServiceInfo): ServiceFormData {
  return {
    service_name: svc.service_name,
    port: svc.port != null ? String(svc.port) : '',
    protocol: svc.protocol,
    path: svc.path ?? '',
    host: svc.host ?? '',
    icon: svc.icon,
  }
}
