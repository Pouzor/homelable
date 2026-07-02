/**
 * Copy text to the clipboard.
 *
 * Uses the async Clipboard API when available in a secure context (HTTPS).
 * Over plain HTTP, `navigator.clipboard` is undefined, so falls back to a
 * hidden textarea + `document.execCommand('copy')`.
 *
 * @returns true if the copy succeeded, false otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  // Fallback for non-secure (HTTP) contexts where navigator.clipboard is unavailable.
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'absolute'
  textArea.style.left = '-999999px'
  document.body.prepend(textArea)
  textArea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textArea.remove()
  }
}
