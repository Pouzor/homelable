import { authApi } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

/**
 * Discover the configured authentication mode and restore a valid session.
 * OIDC sessions are represented only by the backend's HttpOnly cookie; local
 * sessions retain their existing bearer token until /auth/me validates it.
 */
export async function bootstrapAuth(): Promise<void> {
  const store = useAuthStore.getState()

  try {
    const { data: config } = await authApi.config()
    store.setAuthConfig(config.mode, config.oidc_login_url)

    const token = useAuthStore.getState().token
    if (config.mode === 'oidc' || token) {
      try {
        const { data: user } = await authApi.me()
        useAuthStore.getState().authenticate(user)
      } catch {
        // The response interceptor clears invalid credentials on 401. Also
        // clear them for malformed/unreachable session checks, failing closed.
        useAuthStore.getState().logout()
      }
    }
  } catch {
    // Keep authMode unknown when discovery is unreachable. The login screen
    // reports that state without guessing which authentication mode is active.
  } finally {
    useAuthStore.getState().finishInitialization()
  }
}
