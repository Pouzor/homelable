import { toPng, toSvg } from 'html-to-image'

export type ExportQuality = 'standard' | 'high' | 'ultra'
export type ExportFormat = 'png' | 'svg'
export type ExportBackground = 'dark' | 'white'

export const EXPORT_QUALITY_OPTIONS: { value: ExportQuality; label: string; pixelRatio: number; hint: string }[] = [
  { value: 'standard', label: 'Standard', pixelRatio: 1, hint: '1× — small file' },
  { value: 'high',     label: 'High',     pixelRatio: 2, hint: '2× — recommended' },
  { value: 'ultra',    label: 'Ultra',    pixelRatio: 4, hint: '4× — print quality, large file' },
]

export const EXPORT_BACKGROUND_OPTIONS: { value: ExportBackground; label: string; color: string; hint: string }[] = [
  { value: 'dark',  label: 'Dark',  color: '#0d1117', hint: 'screen / docs' },
  { value: 'white', label: 'White', color: '#ffffff', hint: 'printing' },
]

function backgroundColor(background: ExportBackground): string {
  return (EXPORT_BACKGROUND_OPTIONS.find((o) => o.value === background) ?? EXPORT_BACKGROUND_OPTIONS[0]).color
}

export async function exportToPng(
  element: HTMLElement,
  quality: ExportQuality = 'high',
  background: ExportBackground = 'dark',
): Promise<void> {
  const option = EXPORT_QUALITY_OPTIONS.find((o) => o.value === quality) ?? EXPORT_QUALITY_OPTIONS[1]
  const color = backgroundColor(background)
  const dataUrl = await toPng(element, {
    backgroundColor: color,
    pixelRatio: option.pixelRatio,
    style: {
      '--xy-controls-display': 'none',
      // The .react-flow root paints its own opaque background (colorMode),
      // which would hide the canvas backgroundColor above — override it inline.
      backgroundColor: color,
    } as Partial<CSSStyleDeclaration>,
  })

  triggerDownload(dataUrl, 'homelable-canvas.png')
}

export async function exportToSvg(
  element: HTMLElement,
  background: ExportBackground = 'dark',
): Promise<void> {
  const color = backgroundColor(background)
  const dataUrl = await toSvg(element, {
    backgroundColor: color,
    style: {
      '--xy-controls-display': 'none',
      backgroundColor: color,
    } as Partial<CSSStyleDeclaration>,
  })

  triggerDownload(dataUrl, 'homelable-canvas.svg')
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  // Firefox only triggers a programmatic click when the anchor is in the DOM.
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
