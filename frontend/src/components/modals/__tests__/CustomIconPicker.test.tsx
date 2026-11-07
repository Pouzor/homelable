import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { mediaApi } from '@/api/client'
import { CustomIconPicker } from '../CustomIconPicker'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/api/client', () => ({ mediaApi: { upload: vi.fn() } }))

const api = vi.mocked(mediaApi)
const LINK = 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/immich.svg'
const MEDIA = '/api/v1/media/0123456789abcdef0123456789abcdef.png'
const urlInput = () => screen.getByLabelText('Custom icon URL') as HTMLInputElement

beforeEach(() => vi.clearAllMocks())

describe('CustomIconPicker', () => {
  it('emits a url: key for a valid pasted link', () => {
    const onSelect = vi.fn()
    render(<CustomIconPicker onSelect={onSelect} allowUpload={false} />)
    fireEvent.change(urlInput(), { target: { value: `  ${LINK} ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(onSelect).toHaveBeenCalledWith(`url:${LINK}`)
  })

  it('applies on Enter', () => {
    const onSelect = vi.fn()
    render(<CustomIconPicker onSelect={onSelect} allowUpload={false} />)
    fireEvent.change(urlInput(), { target: { value: LINK } })
    fireEvent.keyDown(urlInput(), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(`url:${LINK}`)
  })

  it('refuses an invalid link and says why', () => {
    const onSelect = vi.fn()
    render(<CustomIconPicker onSelect={onSelect} allowUpload={false} />)
    fireEvent.change(urlInput(), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/http\(s\) link/)
    expect(urlInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('clears the error once the link is edited', () => {
    render(<CustomIconPicker onSelect={vi.fn()} allowUpload={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(screen.getByRole('alert')).toBeDefined()
    fireEvent.change(urlInput(), { target: { value: 'h' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('prefills the current link and previews it', () => {
    render(<CustomIconPicker value={`url:${LINK}`} onSelect={vi.fn()} allowUpload={false} />)
    expect(urlInput().value).toBe(LINK)
    expect(screen.getByAltText('Custom icon preview').getAttribute('src')).toBe(LINK)
  })

  it('does not prefill from a brand or generic key', () => {
    render(<CustomIconPicker value="brand:plex" onSelect={vi.fn()} allowUpload={false} />)
    expect(urlInput().value).toBe('')
    expect(screen.queryByAltText('Custom icon preview')).toBeNull()
  })

  it('hides the upload button when uploads are not allowed', () => {
    render(<CustomIconPicker onSelect={vi.fn()} allowUpload={false} />)
    expect(screen.queryByRole('button', { name: /upload image/i })).toBeNull()
    expect(screen.getByText(/Uploads need the backend/)).toBeDefined()
  })

  it('uploads a file and emits a url: key for the media path', async () => {
    api.upload.mockResolvedValue({ url: MEDIA, filename: MEDIA.split('/').pop()! })
    const onSelect = vi.fn()
    render(<CustomIconPicker onSelect={onSelect} allowUpload />)
    expect(screen.getByRole('button', { name: /upload image/i })).toBeDefined()
    const file = new File(['x'], 'nas.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Custom icon file'), { target: { files: [file] } })
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(`url:${MEDIA}`))
    expect(api.upload).toHaveBeenCalledWith(file)
    expect(urlInput().value).toBe(MEDIA)
  })

  it('toasts and emits nothing when the upload fails', async () => {
    api.upload.mockRejectedValue(new Error('413'))
    const onSelect = vi.fn()
    render(<CustomIconPicker onSelect={onSelect} allowUpload />)
    const file = new File(['x'], 'nas.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Custom icon file'), { target: { files: [file] } })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Icon upload failed'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /upload image/i }).hasAttribute('disabled')).toBe(false)
  })

  it('refuses an upload response that is not a media path', async () => {
    api.upload.mockResolvedValue({ url: 'javascript:alert(1)', filename: 'x' })
    const onSelect = vi.fn()
    render(<CustomIconPicker onSelect={onSelect} allowUpload />)
    fireEvent.change(screen.getByLabelText('Custom icon file'), {
      target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onSelect).not.toHaveBeenCalled()
  })
})
