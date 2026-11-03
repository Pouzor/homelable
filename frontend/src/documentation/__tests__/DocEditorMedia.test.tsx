import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mediaApi } from '@/api/client'
import { DocEditor } from '../components/DocEditor'

vi.mock('sonner', async () => (await import('@/test/mocks')).mockSonner())
vi.mock('@/api/client', () => ({
  documentsApi: { block: vi.fn() },
  mediaApi: { upload: vi.fn() },
}))

const api = vi.mocked(mediaApi)

const png = (name = 'rack.png') => new File(['x'], name, { type: 'image/png' })
const source = () => screen.getByLabelText('Document source') as HTMLTextAreaElement

/** A stateful host, so the textarea really holds what was typed. */
function setupLive(initial = '') {
  const onChange = vi.fn()
  function Host() {
    const [body, setBody] = useState(initial)
    return (
      <DocEditor
        body={body}
        onChange={(next) => { onChange(next); setBody(next) }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        dirty
        saving={false}
      />
    )
  }
  render(<Host />)
  return { onChange }
}

const drop = (files: File[]) =>
  fireEvent.drop(source(), { dataTransfer: { files, types: ['Files'] } })

const paste = (files: File[], text = '') =>
  fireEvent.paste(source(), { clipboardData: { files, getData: () => text } })

beforeEach(() => {
  vi.clearAllMocks()
  api.upload.mockResolvedValue({ url: '/api/v1/media/abc.png', filename: 'abc.png' })
})

describe('DocEditor — media', () => {
  it('uploads the file picked from /image and puts it where the slash was', async () => {
    const user = userEvent.setup()
    setupLive()

    await user.click(source())
    await user.keyboard('Intro{Enter}/')
    await user.click(await screen.findByText('/image'))
    // The slash is gone before any file is chosen, so cancelling the dialog
    // leaves nothing behind.
    await waitFor(() => expect(source().value).toBe('Intro\n'))

    await user.upload(screen.getByLabelText('Upload a file'), png())

    await waitFor(() => expect(source().value).toBe('Intro\n![rack](/api/v1/media/abc.png)'))
    expect(api.upload).toHaveBeenCalledTimes(1)
  })

  it('uploads the file picked from /pdf and links it', async () => {
    const user = userEvent.setup()
    api.upload.mockResolvedValue({ url: '/api/v1/media/abc.pdf', filename: 'abc.pdf' })
    setupLive()

    await user.click(source())
    await user.keyboard('/')
    await user.click(await screen.findByText('/pdf'))
    const input = screen.getByLabelText('Upload a file') as HTMLInputElement
    // Narrowed to the command: the dialog offers PDFs, not images.
    expect(input.accept).toBe('application/pdf')

    await user.upload(input, new File(['x'], 'manual.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(source().value).toBe('[manual.pdf](/api/v1/media/abc.pdf)'))
  })

  it('offers images, SVG included, from /image', async () => {
    const user = userEvent.setup()
    setupLive()

    await user.click(source())
    await user.keyboard('/')
    await user.click(await screen.findByText('/image'))

    expect((screen.getByLabelText('Upload a file') as HTMLInputElement).accept).toBe(
      'image/png,image/jpeg,image/webp,image/svg+xml',
    )
  })

  it('takes a dropped SVG and a dropped PDF together', async () => {
    api.upload
      .mockResolvedValueOnce({ url: '/api/v1/media/a.svg', filename: 'a.svg' })
      .mockResolvedValueOnce({ url: '/api/v1/media/b.pdf', filename: 'b.pdf' })
    setupLive()

    drop([
      new File(['<svg/>'], 'topology.svg', { type: 'image/svg+xml' }),
      new File(['x'], 'manual.pdf', { type: 'application/pdf' }),
    ])

    await waitFor(() =>
      expect(source().value).toBe('![topology](/api/v1/media/a.svg)\n[manual.pdf](/api/v1/media/b.pdf)'),
    )
  })

  it('uploads a dropped image and inserts it at the caret', async () => {
    const user = userEvent.setup()
    setupLive()
    await user.click(source())
    await user.keyboard('Before ')

    drop([png()])

    await waitFor(() => expect(source().value).toBe('Before ![rack](/api/v1/media/abc.png)'))
  })

  it('puts each dropped file on a line of its own', async () => {
    api.upload
      .mockResolvedValueOnce({ url: '/api/v1/media/a.png', filename: 'a.png' })
      .mockResolvedValueOnce({ url: '/api/v1/media/b.png', filename: 'b.png' })
    setupLive()

    drop([png('front.png'), png('back.png')])

    await waitFor(() =>
      expect(source().value).toBe('![front](/api/v1/media/a.png)\n![back](/api/v1/media/b.png)'),
    )
  })

  it('uploads a pasted screenshot', async () => {
    setupLive()

    paste([png('image.png')])

    await waitFor(() => expect(source().value).toBe('![image](/api/v1/media/abc.png)'))
  })

  it('leaves a paste that carries text to the browser', () => {
    setupLive()

    // What a spreadsheet copies: the cells as text, and a picture of them.
    const handled = !paste([png()], 'a\tb')

    expect(handled).toBe(false)
    expect(api.upload).not.toHaveBeenCalled()
  })

  it('leaves a drop that carries no file to the browser', () => {
    setupLive()

    const handled = !fireEvent.drop(source(), { dataTransfer: { files: [], types: ['text/plain'] } })

    expect(handled).toBe(false)
    expect(api.upload).not.toHaveBeenCalled()
  })

  it('refuses an unsupported file without asking the server', async () => {
    const { onChange } = setupLive()

    drop([new File(['x'], 'notes.txt', { type: 'text/plain' })])

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only PNG, JPEG, WebP, SVG or PDF can go in a document'))
    expect(api.upload).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('says why an upload failed and leaves the document alone', async () => {
    api.upload.mockRejectedValue({ response: { data: { detail: 'File too large (max 10 MB)' } } })
    const { onChange } = setupLive('text')

    drop([png()])

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('File too large (max 10 MB)'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Inserting…')).not.toBeInTheDocument()
  })

  it('keeps the files that made it when a later one fails', async () => {
    api.upload
      .mockResolvedValueOnce({ url: '/api/v1/media/a.png', filename: 'a.png' })
      .mockRejectedValueOnce(new Error('network'))
    setupLive()

    drop([png('front.png'), png('back.png')])

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Upload failed'))
    expect(source().value).toBe('![front](/api/v1/media/a.png)')
  })

  it('keeps what was typed while the file was uploading', async () => {
    const user = userEvent.setup()
    let finish: (value: { url: string; filename: string }) => void = () => {}
    api.upload.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    setupLive()

    await user.click(source())
    await user.keyboard('a')
    drop([png()])
    expect(await screen.findByText('Inserting…')).toBeInTheDocument()
    await user.keyboard('b')

    finish({ url: '/api/v1/media/abc.png', filename: 'abc.png' })

    await waitFor(() => expect(source().value).toBe('ab![rack](/api/v1/media/abc.png)'))
  })
})
