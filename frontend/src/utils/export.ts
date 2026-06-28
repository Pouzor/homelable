import { toPng, toSvg } from 'html-to-image'

export type ExportQuality = 'standard' | 'high' | 'ultra'
export type ExportFormat = 'png' | 'svg'

export const EXPORT_QUALITY_OPTIONS: { value: ExportQuality; label: string; pixelRatio: number; hint: string }[] = [
  { value: 'standard', label: 'Standard', pixelRatio: 1, hint: '1× — small file' },
  { value: 'high',     label: 'High',     pixelRatio: 2, hint: '2× — recommended' },
  { value: 'ultra',    label: 'Ultra',    pixelRatio: 4, hint: '4× — print quality, large file' },
]

export async function exportToPng(element: HTMLElement, quality: ExportQuality = 'high'): Promise<void> {
  const option = EXPORT_QUALITY_OPTIONS.find((o) => o.value === quality) ?? EXPORT_QUALITY_OPTIONS[1]
  const dataUrl = await toPng(element, {
    backgroundColor: '#0d1117',
    pixelRatio: option.pixelRatio,
    style: {
      '--xy-controls-display': 'none',
    } as Partial<CSSStyleDeclaration>,
  })

  triggerDownload(dataUrl, 'homelable-canvas.png')
}

export async function exportToSvg(element: HTMLElement): Promise<void> {
  const dataUrl = await toSvg(element, {
    backgroundColor: '#0d1117',
    style: {
      '--xy-controls-display': 'none',
    } as Partial<CSSStyleDeclaration>,
  })

  triggerDownload(dataUrl, 'homelable-canvas.svg')
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}
