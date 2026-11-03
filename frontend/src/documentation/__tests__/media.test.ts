import { describe, expect, it } from 'vitest'

import { isSupportedMedia, mediaMarkdown, uploadError } from '../media'

const file = (name: string, type: string) => new File(['x'], name, { type })

describe('isSupportedMedia', () => {
  it('takes the image formats the server stores', () => {
    expect(isSupportedMedia(file('a.png', 'image/png'))).toBe(true)
    expect(isSupportedMedia(file('a.jpg', 'image/jpeg'))).toBe(true)
    expect(isSupportedMedia(file('a.webp', 'image/webp'))).toBe(true)
    expect(isSupportedMedia(file('a.svg', 'image/svg+xml'))).toBe(true)
  })

  it('takes a PDF, which is linked rather than shown', () => {
    expect(isSupportedMedia(file('a.pdf', 'application/pdf'))).toBe(true)
  })

  it('refuses everything else, an unknown type included', () => {
    expect(isSupportedMedia(file('a.gif', 'image/gif'))).toBe(false)
    expect(isSupportedMedia(file('a.txt', 'text/plain'))).toBe(false)
    expect(isSupportedMedia(file('a', ''))).toBe(false)
  })
})

describe('mediaMarkdown', () => {
  it('writes an image, named after the file without its extension', () => {
    expect(mediaMarkdown(file('rack.front.png', 'image/png'), '/api/v1/media/abc.png')).toBe(
      '![rack.front](/api/v1/media/abc.png)',
    )
  })

  it('drops the brackets that would close the alt text early', () => {
    expect(mediaMarkdown(file('plan [v2].png', 'image/png'), '/u.png')).toBe('![plan v2](/u.png)')
  })

  it('falls back to a plain alt when the name leaves nothing', () => {
    expect(mediaMarkdown(file('.png', 'image/png'), '/u.png')).toBe('![image](/u.png)')
  })

  it('writes an SVG as an image', () => {
    expect(mediaMarkdown(file('topology.svg', 'image/svg+xml'), '/u.svg')).toBe('![topology](/u.svg)')
  })

  it('writes a PDF as a link that keeps its extension', () => {
    expect(mediaMarkdown(file('UPS [manual].pdf', 'application/pdf'), '/u.pdf')).toBe('[UPS manual .pdf](/u.pdf)')
    expect(mediaMarkdown(file('', 'application/pdf'), '/u.pdf')).toBe('[file](/u.pdf)')
  })
})

describe('uploadError', () => {
  it("relays the server's reason", () => {
    expect(uploadError({ response: { data: { detail: 'File too large (max 10 MB)' } } })).toBe(
      'File too large (max 10 MB)',
    )
  })

  it('falls back when there is none to relay', () => {
    expect(uploadError(new Error('network'))).toBe('Upload failed')
    expect(uploadError({ response: { data: { detail: [{ msg: 'x' }] } } })).toBe('Upload failed')
  })
})
