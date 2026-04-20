import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportToPng, EXPORT_QUALITY_OPTIONS } from '../export'

const mockToPng = vi.fn()
vi.mock('html-to-image', () => ({ toPng: (...args: unknown[]) => mockToPng(...args) }))

describe('exportToPng', () => {
  let el: HTMLElement
  let clickSpy: ReturnType<typeof vi.fn>
  let appendSpy: ReturnType<typeof vi.spyOn>
  let createSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    el = document.createElement('div')
    clickSpy = vi.fn()
    createSpy = vi.spyOn(document, 'createElement').mockReturnValue(
      Object.assign(document.createElement('a'), { click: clickSpy }) as HTMLAnchorElement
    )
    appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n)
    mockToPng.mockResolvedValue('data:image/png;base64,abc')
  })

  afterEach(() => {
    createSpy.mockRestore()
    appendSpy.mockRestore()
  })

  it('calls toPng with pixelRatio 1 for standard quality', async () => {
    await exportToPng(el, 'standard')
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ pixelRatio: 1 }))
  })

  it('calls toPng with pixelRatio 2 for high quality', async () => {
    await exportToPng(el, 'high')
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ pixelRatio: 2 }))
  })

  it('calls toPng with pixelRatio 4 for ultra quality', async () => {
    await exportToPng(el, 'ultra')
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ pixelRatio: 4 }))
  })

  it('defaults to high quality when no quality arg given', async () => {
    await exportToPng(el)
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ pixelRatio: 2 }))
  })

  it('triggers a download with the correct filename', async () => {
    await exportToPng(el, 'high')
    expect(clickSpy).toHaveBeenCalled()
  })

  it('passes dark background color', async () => {
    await exportToPng(el, 'standard')
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ backgroundColor: '#0d1117' }))
  })
})

describe('EXPORT_QUALITY_OPTIONS', () => {
  it('has exactly three options', () => {
    expect(EXPORT_QUALITY_OPTIONS).toHaveLength(3)
  })

  it('options are standard, high, ultra in order', () => {
    expect(EXPORT_QUALITY_OPTIONS.map((o) => o.value)).toEqual(['standard', 'high', 'ultra'])
  })

  it('pixel ratios are 1, 2, 4', () => {
    expect(EXPORT_QUALITY_OPTIONS.map((o) => o.pixelRatio)).toEqual([1, 2, 4])
  })
})
