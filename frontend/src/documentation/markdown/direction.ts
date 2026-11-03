/**
 * Text direction of a rendered block, from its first strong character.
 *
 * Set explicitly on every block rather than `dir="auto"`: an `auto` ancestor
 * skips descendants carrying their own `dir`, so a table or a quote whose
 * cells and paragraphs are `auto` would find no text and fall back to LTR.
 * Code is skipped — it reads left-to-right whatever the prose around it.
 */

export type TextDir = 'rtl' | 'ltr'

const RTL_CHAR = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u
const LETTER = /\p{L}/u

interface DirNode {
  type?: string
  tagName?: string
  value?: unknown
  children?: DirNode[]
}

function walk(node?: DirNode): TextDir | undefined {
  if (!node) return undefined
  if (node.type === 'text' && typeof node.value === 'string') {
    for (const ch of node.value) {
      if (RTL_CHAR.test(ch)) return 'rtl'
      if (LETTER.test(ch)) return 'ltr'
    }
    return undefined
  }
  if (node.tagName === 'code' || node.tagName === 'pre') return undefined
  for (const child of node.children ?? []) {
    const dir = walk(child)
    if (dir) return dir
  }
  return undefined
}

/** `undefined` when the block holds no letter, so it inherits its parent's. */
export function textDir(node?: unknown): TextDir | undefined {
  return walk(node as DirNode | undefined)
}
