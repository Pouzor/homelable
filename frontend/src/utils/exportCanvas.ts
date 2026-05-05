// Utility: export/import canvas state as Base64-safe string

// - exportCanvasToBase64: serializes the provided payload and returns a Base64 string

// - importCanvasFromBase64: decodes a Base64 string back to the original object



export function exportCanvasToBase64(payload: unknown): string {

  const json = JSON.stringify(payload)

  // Browser-safe UTF-8 -> Base64

  try {

    return btoa(unescape(encodeURIComponent(json)))

  } catch (err) {

    // Fallback for environments where btoa is not available (e.g., SSR)

    if (typeof (globalThis as any).Buffer !== 'undefined') {

      // eslint-disable-next-line @typescript-eslint/no-explicit-any

      return (globalThis as any).Buffer.from(json, 'utf-8').toString('base64')

    }

    throw err

  }

}



export function importCanvasFromBase64<T = unknown>(b64: string): T {

  // Decode Base64 -> UTF-8 -> object

  try {

    const json = decodeURIComponent(escape(atob(b64)))

    return JSON.parse(json) as T

  } catch (err) {

    if (typeof (globalThis as any).Buffer !== 'undefined') {

      // eslint-disable-next-line @typescript-eslint/no-explicit-any

      const json = (globalThis as any).Buffer.from(b64, 'base64').toString('utf-8')

      return JSON.parse(json) as T

    }

    throw err

  }

}



export default exportCanvasToBase64