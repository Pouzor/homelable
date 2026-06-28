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

// The `.react-flow` element paints its own opaque background (colorMode dark),
// and html-to-image's `backgroundColor` option only shows through transparent
// areas. Force the chosen colour directly on the live element for the duration
// of the capture, then restore whatever was there before.
async function withBackground<T>(
  element: HTMLElement,
  color: string,
  capture: () => Promise<T>,
): Promise<T> {
  const previous = element.style.backgroundColor
  element.style.backgroundColor = color
  try {
    return await capture()
  } finally {
    element.style.backgroundColor = previous
  }
}

export async function exportToPng(
  element: HTMLElement,
  quality: ExportQuality = 'high',
  background: ExportBackground = 'dark',
): Promise<void> {
  const option = EXPORT_QUALITY_OPTIONS.find((o) => o.value === quality) ?? EXPORT_QUALITY_OPTIONS[1]
  const color = backgroundColor(background)
  const dataUrl = await withBackground(element, color, () =>
    toPng(element, {
      backgroundColor: color,
      pixelRatio: option.pixelRatio,
    }),
  )

  triggerDownload(dataUrl, 'homelable-canvas.png')
}

export async function exportToSvg(
  element: HTMLElement,
  background: ExportBackground = 'dark',
): Promise<void> {
  const color = backgroundColor(background)
  const dataUrl = await withBackground(element, color, () =>
    toSvg(element, {
      backgroundColor: color,
    }),
  )

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
