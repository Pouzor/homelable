import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToPng, exportToSvg, EXPORT_QUALITY_OPTIONS, EXPORT_BACKGROUND_OPTIONS } from '../export'

const mockToPng = vi.fn()
const mockToSvg = vi.fn()
vi.mock('html-to-image', () => ({
  toPng: (...args: unknown[]) => mockToPng(...args),
  toSvg: (...args: unknown[]) => mockToSvg(...args),
}))

describe('exportToPng', () => {
  let el: HTMLElement
  let clickSpy: ReturnType<typeof vi.fn>
  let appendSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>
  let createSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    el = document.createElement('div')
    clickSpy = vi.fn()
    createSpy = vi.spyOn(document, 'createElement').mockReturnValue(
      Object.assign(document.createElement('a'), { click: clickSpy }) as HTMLAnchorElement
    )
    appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n)
    removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n)
    mockToPng.mockResolvedValue('data:image/png;base64,abc')
    mockToSvg.mockResolvedValue('data:image/svg+xml;base64,abc')
  })

  afterEach(() => {
    createSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
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

  it('defaults to dark background color', async () => {
    await exportToPng(el, 'standard')
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ backgroundColor: '#0d1117' }))
  })

  it('uses white background color when white is requested (printing)', async () => {
    await exportToPng(el, 'standard', 'white')
    expect(mockToPng).toHaveBeenCalledWith(el, expect.objectContaining({ backgroundColor: '#ffffff' }))
  })

  it('overrides the react-flow root background via inline style so white is visible', async () => {
    await exportToPng(el, 'standard', 'white')
    expect(mockToPng).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ style: expect.objectContaining({ backgroundColor: '#ffffff' }) }),
    )
  })

  it('attaches the download anchor to the DOM so Firefox triggers the download', async () => {
    await exportToPng(el, 'high')
    expect(appendSpy).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalled()
  })
})

describe('exportToSvg', () => {
  let el: HTMLElement
  let clickSpy: ReturnType<typeof vi.fn>
  let appendSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>
  let createSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    el = document.createElement('div')
    clickSpy = vi.fn()
    createSpy = vi.spyOn(document, 'createElement').mockReturnValue(
      Object.assign(document.createElement('a'), { click: clickSpy }) as HTMLAnchorElement
    )
    appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n)
    removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n)
    mockToSvg.mockResolvedValue('data:image/svg+xml;base64,abc')
  })

  afterEach(() => {
    createSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('defaults to dark background color', async () => {
    await exportToSvg(el)
    expect(mockToSvg).toHaveBeenCalledWith(el, expect.objectContaining({ backgroundColor: '#0d1117' }))
  })

  it('uses white background color when white is requested (printing)', async () => {
    await exportToSvg(el, 'white')
    expect(mockToSvg).toHaveBeenCalledWith(el, expect.objectContaining({ backgroundColor: '#ffffff' }))
  })

  it('overrides the react-flow root background via inline style so white is visible', async () => {
    await exportToSvg(el, 'white')
    expect(mockToSvg).toHaveBeenCalledWith(
      el,
      expect.objectContaining({ style: expect.objectContaining({ backgroundColor: '#ffffff' }) }),
    )
  })

  it('triggers a download', async () => {
    await exportToSvg(el)
    expect(clickSpy).toHaveBeenCalled()
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

describe('EXPORT_BACKGROUND_OPTIONS', () => {
  it('offers dark and white', () => {
    expect(EXPORT_BACKGROUND_OPTIONS.map((o) => o.value)).toEqual(['dark', 'white'])
  })

  it('maps to the expected colors', () => {
    expect(EXPORT_BACKGROUND_OPTIONS.map((o) => o.color)).toEqual(['#0d1117', '#ffffff'])
  })
})
