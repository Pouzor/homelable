/**
 * Short labels that appear in more than one area of the app.
 *
 * Split out from the per-area parts by a deterministic rule: a key used by more
 * than one source file lives here, everything else lives with the file that uses
 * it. That way a caption like "Cancel" is written once and can never drift into
 * two different Chinese words in two different modals.
 *
 * Sourced from ../GLOSSARY.md.
 */
const part: Record<string, string> = {
  'Close': '关闭',
  'Due for review': '待复核',
  'Send devices to': '把设备发送到',
}

export default part
