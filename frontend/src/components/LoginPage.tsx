import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/ui/Logo'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'
import { t, useLocale } from '@/i18n'
import { authApi } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { API_BASE_URL, resolveServerPath } from '@/utils/basePath'

export function LoginPage() {
  useLocale()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { authMode, oidcLoginUrl, login } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(username, password)
      login(res.data.access_token)
    } catch (err: unknown) {
      const hasResponse = err && typeof err === 'object' && 'response' in err
      setError(
        hasResponse
          ? t('Invalid username or password')
          : t('Could not reach the server — check your CORS_ORIGINS setting'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0d1117]">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#00d4ff 1px, transparent 1px), linear-gradient(90deg, #00d4ff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative w-full max-w-sm px-4">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <Logo size={64} showText={false} />
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              <span className="text-[#e6edf3]">Home</span>
              <span className="text-[#00d4ff]">lable</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('HomeLab Visualizer')}</p>
          </div>
        </div>

        {authMode === 'local' && (
          <>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 bg-[#161b22] border-[#30363d] rounded-xl p-6"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username" className="text-xs text-muted-foreground">{t('Username')}</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-[#21262d] border-[#30363d] focus-visible:ring-[#00d4ff]/50 text-sm"
                  placeholder="admin"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="text-xs text-muted-foreground">{t('Password')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#21262d] border-[#30363d] focus-visible:ring-[#00d4ff]/50 text-sm"
                  required
                />
              </div>

              {error && (
                <p className="text-xs text-[#f85149] text-center">{error}</p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="mt-1 bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 font-medium"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : t('Sign in')}
              </Button>
            </form>

            <p className="text-center text-[10px] text-muted-foreground/40 mt-4">
              {t('Credentials configured in')} <span className="font-mono">.env</span>
            </p>
          </>
        )}

        {authMode === 'oidc' && (
          <div className="flex flex-col gap-4 bg-[#161b22] border-[#30363d] rounded-xl p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('Continue through the configured OpenID Connect provider.')}
            </p>
            <a
              href={resolveServerPath(oidcLoginUrl ?? `${API_BASE_URL}/auth/oidc/login`)}
              className={cn(
                buttonVariants(),
                'bg-[#00d4ff] text-[#0d1117] hover:bg-[#00d4ff]/90 font-medium',
              )}
            >
              {t('Sign in with OpenID Connect')}
            </a>
          </div>
        )}

        {authMode === null && (
          <div className="flex flex-col gap-4 bg-[#161b22] border-[#30363d] rounded-xl p-6 text-center">
            <p className="text-sm text-[#f85149]">{t('Could not load authentication configuration.')}</p>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              {t('Retry')}
            </Button>
          </div>
        )}

        {/* Language is offered before signing in: a reader who cannot read the
            form cannot be expected to find the switcher once inside. */}
        <div className="flex justify-center mt-6">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
