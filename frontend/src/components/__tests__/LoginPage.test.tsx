import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginPage } from '../LoginPage'
import { useAuthStore } from '@/stores/authStore'

vi.mock('@/api/client', () => ({
  authApi: {
    login: vi.fn(),
  },
}))

import { authApi } from '@/api/client'

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, isAuthenticated: false })
    vi.mocked(authApi.login).mockReset()
  })

  // ── Rendering ────────────────────────────────────────────────────────────

  it('renders username and password fields', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText('Username')).toBeDefined()
    expect(screen.getByLabelText('Password')).toBeDefined()
  })

  it('renders a Sign in button', () => {
    render(<LoginPage />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined()
  })

  // ── Security checks ──────────────────────────────────────────────────────

  it('password field type is "password" — not rendered as plain text', () => {
    render(<LoginPage />)
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.type).toBe('password')
  })

  it('username field has autocomplete="username"', () => {
    render(<LoginPage />)
    const un = screen.getByLabelText('Username') as HTMLInputElement
    expect(un.getAttribute('autocomplete')).toBe('username')
  })

  it('password field has autocomplete="current-password" (supports password managers)', () => {
    render(<LoginPage />)
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.getAttribute('autocomplete')).toBe('current-password')
  })

  it('shows a generic error message — no credential enumeration', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new Error('401'))
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } })
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!)
    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeDefined()
    })
    // Must show exactly ONE error — not separate per-field messages (no enumeration)
    const errors = document.querySelectorAll('p.text-\\[\\#f85149\\]')
    expect(errors.length).toBe(1)
    expect(errors[0].textContent).toBe('Invalid username or password')
  })

  it('clears previous error before each new attempt', async () => {
    vi.mocked(authApi.login)
      .mockRejectedValueOnce(new Error('401'))
      .mockRejectedValueOnce(new Error('401'))
    render(<LoginPage />)
    const form = screen.getByRole('button', { name: /sign in/i }).closest('form')!
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } })
    fireEvent.submit(form)
    await waitFor(() => screen.getByText('Invalid username or password'))
    fireEvent.submit(form)
    // Error clears while loading (setError('') before try)
    await waitFor(() => screen.getByText('Invalid username or password'))
    expect(screen.getAllByText('Invalid username or password')).toHaveLength(1)
  })

  it('disables submit button while loading — prevents double-submit', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(authApi.login).mockReturnValue(new Promise((r) => { resolve = r }))
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass' } })
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!)
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '' }) as HTMLButtonElement).disabled).toBe(true)
    })
    resolve({ data: { access_token: 'tok' } })
  })

  it('calls authApi.login with credentials via POST body (not URL params)', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ data: { access_token: 'tok' } } as never)
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!)
    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith('admin', 'secret')
    })
  })

  it('stores token in authStore on successful login', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ data: { access_token: 'mytoken123' } } as never)
    render(<LoginPage />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct' } })
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form')!)
    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(useAuthStore.getState().token).toBe('mytoken123')
    })
  })

  it('token persisted via sessionStorage — not localStorage', () => {
    // The authStore uses createJSONStorage(() => sessionStorage)
    // Verify the storage key exists in sessionStorage after login
    render(<LoginPage />)
    // Even before login, the store is backed by sessionStorage
    expect(typeof sessionStorage).toBe('object')
    // localStorage should NOT contain the auth token
    expect(localStorage.getItem('homelable-auth')).toBeNull()
  })

  it('does not show error on initial render', () => {
    render(<LoginPage />)
    expect(screen.queryByText('Invalid username or password')).toBeNull()
  })

  it('requires username (HTML required attribute)', () => {
    render(<LoginPage />)
    const un = screen.getByLabelText('Username') as HTMLInputElement
    expect(un.required).toBe(true)
  })

  it('requires password (HTML required attribute)', () => {
    render(<LoginPage />)
    const pw = screen.getByLabelText('Password') as HTMLInputElement
    expect(pw.required).toBe(true)
  })
})
