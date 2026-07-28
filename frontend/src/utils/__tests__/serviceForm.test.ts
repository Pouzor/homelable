import { describe, it, expect } from 'vitest'
import { serviceToForm, EMPTY_SERVICE_FORM } from '../serviceForm'

describe('serviceToForm', () => {
  it('maps a service onto string form fields', () => {
    expect(serviceToForm({ port: 443, protocol: 'udp', service_name: 'svc', path: '/x', icon: 'database' })).toEqual({
      service_name: 'svc',
      port: '443',
      protocol: 'udp',
      path: '/x',
      icon: 'database',
    })
  })

  it('blanks out absent port and path', () => {
    expect(serviceToForm({ protocol: 'tcp', service_name: 'svc' })).toEqual({
      service_name: 'svc',
      port: '',
      protocol: 'tcp',
      path: '',
      icon: undefined,
    })
  })

  it('keeps a brand icon key intact', () => {
    expect(serviceToForm({ protocol: 'tcp', service_name: 'plex', icon: 'brand:plex' }).icon).toBe('brand:plex')
  })

  it('starts from a blank tcp form', () => {
    expect(EMPTY_SERVICE_FORM).toEqual({ service_name: '', port: '', protocol: 'tcp', path: '' })
  })
})
