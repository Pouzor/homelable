import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../client', () => ({ api: { get: hoisted.get } }))

import { kubernetesApi } from '../kubernetes'

describe('kubernetesApi', () => {
  it('only exposes read-only status and topology endpoints', () => {
    kubernetesApi.status()
    kubernetesApi.topology()

    expect(hoisted.get).toHaveBeenNthCalledWith(1, '/kubernetes/status')
    expect(hoisted.get).toHaveBeenNthCalledWith(2, '/kubernetes/topology')
    expect(Object.keys(kubernetesApi)).toEqual(['status', 'topology'])
  })
})
