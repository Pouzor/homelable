import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/api/client', () => ({
  authApi: {
    config: vi.fn(),
    me: vi.fn(),
  },
}))

import { authApi } from '@/api/client'
import { bootstrapAuth } from '../bootstrap'

describe('bootstrapAuth', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({
      token: null,
      isAuthenticated: false,
      isInitialized: false,
      authMode: null,
      authMethod: null,
      oidcLoginUrl: null,
      displayName: null,
      csrfToken: null,
    })
    vi.mocked(authApi.config).mockReset()
    vi.mocked(authApi.me).mockReset()
  })

  it('restores an OIDC cookie session without storing an IdP token', async () => {
    vi.mocked(authApi.config).mockResolvedValue({
      data: { mode: 'oidc', oidc_login_url: '/api/v1/auth/oidc/login' },
    } as never)
    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        subject: 'user-1',
        display_name: 'Alice',
        auth_method: 'oidc',
        issuer: 'https://id.example/application/o/homelable/',
        csrf_token: 'csrf-123',
      },
    } as never)

    await bootstrapAuth()

    const state = useAuthStore.getState()
    expect(authApi.me).toHaveBeenCalledOnce()
    expect(state.isAuthenticated).toBe(true)
    expect(state.authMethod).toBe('oidc')
    expect(state.token).toBeNull()
    expect(state.csrfToken).toBe('csrf-123')
  })

  it('does not probe /auth/me for local mode without a persisted token', async () => {
    vi.mocked(authApi.config).mockResolvedValue({
      data: { mode: 'local', oidc_login_url: null },
    } as never)

    await bootstrapAuth()

    expect(authApi.me).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({
      authMode: 'local',
      isAuthenticated: false,
      isInitialized: true,
    })
  })

  it('validates and retains a persisted local bearer token', async () => {
    useAuthStore.setState({ token: 'local-token' })
    vi.mocked(authApi.config).mockResolvedValue({
      data: { mode: 'local', oidc_login_url: null },
    } as never)
    vi.mocked(authApi.me).mockResolvedValue({
      data: {
        subject: 'admin',
        display_name: 'admin',
        auth_method: 'local',
        issuer: null,
        csrf_token: null,
      },
    } as never)

    await bootstrapAuth()

    expect(useAuthStore.getState()).toMatchObject({
      token: 'local-token',
      isAuthenticated: true,
      authMethod: 'local',
    })
  })

  it('fails closed when the backend rejects the session', async () => {
    useAuthStore.setState({ token: 'expired-token', isAuthenticated: true })
    vi.mocked(authApi.config).mockResolvedValue({
      data: { mode: 'local', oidc_login_url: null },
    } as never)
    vi.mocked(authApi.me).mockRejectedValue({ response: { status: 401 } })

    await bootstrapAuth()

    expect(useAuthStore.getState()).toMatchObject({
      token: null,
      isAuthenticated: false,
      isInitialized: true,
    })
  })

  it('leaves the auth mode unknown when discovery is unavailable', async () => {
    vi.mocked(authApi.config).mockRejectedValue(new Error('network down'))

    await bootstrapAuth()

    expect(useAuthStore.getState()).toMatchObject({
      authMode: null,
      isAuthenticated: false,
      isInitialized: true,
    })
  })
})
