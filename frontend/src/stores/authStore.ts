import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type AuthMode = 'local' | 'oidc'
export type AuthMethod = AuthMode

export interface AuthUser {
  subject: string
  display_name: string
  auth_method: AuthMethod
  issuer: string | null
  csrf_token: string | null
}

interface AuthState {
  token: string | null
  isAuthenticated: boolean
  isInitialized: boolean
  authMode: AuthMode | null
  authMethod: AuthMethod | null
  oidcLoginUrl: string | null
  displayName: string | null
  csrfToken: string | null
  setAuthConfig: (mode: AuthMode, oidcLoginUrl: string | null) => void
  authenticate: (user: AuthUser) => void
  finishInitialization: () => void
  login: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      isAuthenticated: false,
      isInitialized: false,
      authMode: null,
      authMethod: null,
      oidcLoginUrl: null,
      displayName: null,
      csrfToken: null,
      setAuthConfig: (authMode, oidcLoginUrl) => set({ authMode, oidcLoginUrl }),
      authenticate: (user) => set((state) => ({
        token: user.auth_method === 'oidc' ? null : state.token,
        isAuthenticated: true,
        isInitialized: true,
        authMethod: user.auth_method,
        displayName: user.display_name,
        csrfToken: user.csrf_token,
      })),
      finishInitialization: () => set({ isInitialized: true }),
      login: (token) => set({
        token,
        isAuthenticated: true,
        isInitialized: true,
        authMethod: 'local',
        displayName: null,
        csrfToken: null,
      }),
      logout: () => set({
        token: null,
        isAuthenticated: false,
        isInitialized: true,
        authMethod: null,
        displayName: null,
        csrfToken: null,
      }),
    }),
    {
      name: 'homelable-auth',
      // sessionStorage: scoped to the tab, cleared on browser close.
      // Prevents XSS from other tabs stealing the token via localStorage.
      storage: createJSONStorage(() => sessionStorage),
      // OIDC credentials stay in HttpOnly cookies. Its CSRF token is deliberately
      // memory-only and is recovered from /auth/me after every page load.
      partialize: (state) => ({ token: state.token }),
      // Ignore authentication flags written by older versions of the store. A
      // persisted local token is revalidated by the bootstrap request instead.
      merge: (persisted, current) => {
        const token = (persisted as { token?: unknown } | null)?.token
        return {
          ...current,
          token: typeof token === 'string' ? token : null,
        }
      },
    }
  )
)
