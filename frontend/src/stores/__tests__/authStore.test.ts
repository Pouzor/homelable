import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/stores/authStore'

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear()
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
  })

  it('starts unauthenticated', () => {
    const { token, isAuthenticated } = useAuthStore.getState()
    expect(token).toBeNull()
    expect(isAuthenticated).toBe(false)
  })

  it('login sets token and isAuthenticated', () => {
    useAuthStore.getState().login('my-jwt-token')
    const { token, isAuthenticated } = useAuthStore.getState()
    expect(token).toBe('my-jwt-token')
    expect(isAuthenticated).toBe(true)
    expect(useAuthStore.getState().authMethod).toBe('local')
    expect(useAuthStore.getState().isInitialized).toBe(true)
  })

  it('logout clears token and isAuthenticated', () => {
    useAuthStore.getState().login('my-jwt-token')
    useAuthStore.getState().logout()
    const { token, isAuthenticated } = useAuthStore.getState()
    expect(token).toBeNull()
    expect(isAuthenticated).toBe(false)
  })

  it('stores OIDC identity and CSRF state without a browser-readable credential', () => {
    useAuthStore.getState().setAuthConfig('oidc', '/api/v1/auth/oidc/login')
    useAuthStore.getState().authenticate({
      subject: 'user-1',
      display_name: 'Alice',
      auth_method: 'oidc',
      issuer: 'https://id.example/application/o/homelable/',
      csrf_token: 'csrf-123',
    })

    const state = useAuthStore.getState()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(true)
    expect(state.authMethod).toBe('oidc')
    expect(state.displayName).toBe('Alice')
    expect(state.csrfToken).toBe('csrf-123')
    expect(sessionStorage.getItem('homelable-auth') ?? '').not.toContain('csrf-123')
  })

  it('keeps a validated local token when applying /auth/me identity', () => {
    useAuthStore.getState().login('local-token')
    useAuthStore.getState().authenticate({
      subject: 'admin',
      display_name: 'admin',
      auth_method: 'local',
      issuer: null,
      csrf_token: null,
    })

    expect(useAuthStore.getState().token).toBe('local-token')
  })
})
