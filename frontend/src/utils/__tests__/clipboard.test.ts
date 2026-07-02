import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from '../clipboard'

const ORIGINAL_CLIPBOARD = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const ORIGINAL_SECURE = Object.getOwnPropertyDescriptor(window, 'isSecureContext')

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true, writable: true })
}

afterEach(() => {
  if (ORIGINAL_CLIPBOARD) Object.defineProperty(navigator, 'clipboard', ORIGINAL_CLIPBOARD)
  if (ORIGINAL_SECURE) Object.defineProperty(window, 'isSecureContext', ORIGINAL_SECURE)
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('copyToClipboard', () => {
  describe('secure context (HTTPS)', () => {
    it('uses navigator.clipboard.writeText and returns true', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      setClipboard({ writeText })
      setSecureContext(true)

      const ok = await copyToClipboard('hello')

      expect(ok).toBe(true)
      expect(writeText).toHaveBeenCalledWith('hello')
    })

    it('returns false when writeText rejects', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'))
      setClipboard({ writeText })
      setSecureContext(true)

      expect(await copyToClipboard('hello')).toBe(false)
    })
  })

  describe('non-secure context (HTTP) fallback', () => {
    it('falls back to execCommand when clipboard is unavailable', async () => {
      setClipboard(undefined)
      setSecureContext(false)
      const execCommand = vi.fn().mockReturnValue(true)
      document.execCommand = execCommand

      const ok = await copyToClipboard('table-data')

      expect(ok).toBe(true)
      expect(execCommand).toHaveBeenCalledWith('copy')
    })

    it('falls back when clipboard exists but context is not secure', async () => {
      setClipboard({ writeText: vi.fn() })
      setSecureContext(false)
      const execCommand = vi.fn().mockReturnValue(true)
      document.execCommand = execCommand

      expect(await copyToClipboard('x')).toBe(true)
      expect(execCommand).toHaveBeenCalledWith('copy')
    })

    it('removes the temporary textarea after copying', async () => {
      setClipboard(undefined)
      setSecureContext(false)
      document.execCommand = vi.fn().mockReturnValue(true)

      await copyToClipboard('x')

      expect(document.querySelector('textarea')).toBeNull()
    })

    it('returns false and cleans up when execCommand throws', async () => {
      setClipboard(undefined)
      setSecureContext(false)
      document.execCommand = vi.fn(() => { throw new Error('boom') })

      expect(await copyToClipboard('x')).toBe(false)
      expect(document.querySelector('textarea')).toBeNull()
    })

    it('returns false when execCommand reports failure', async () => {
      setClipboard(undefined)
      setSecureContext(false)
      document.execCommand = vi.fn().mockReturnValue(false)

      expect(await copyToClipboard('x')).toBe(false)
    })
  })
})
