/**
 * Tables of English strings that reach the UI through a *runtime* `t()` call
 * rather than a literal one.
 *
 * The completeness test scans for `t('…')` literals, so it cannot see these: the
 * call site is `t(entry.label)` or `t(NODE_TYPE_LABELS[type])`, and a missing
 * entry degrades to English silently with every test still green. That is
 * exactly how ~170 strings were missed the first time round.
 *
 * Both test files need this list, and a test file cannot be imported from
 * another test file without executing its suites — hence this module.
 */
export interface DynamicTable {
  /** What the table is, for the failure message. */
  what: string
  /** Path under `src`. */
  file: string
  /**
   * How to pull the values out. `block` names an exported const and reads to its
   * closing brace, which is exact; `pattern` is for tables that are one big array
   * with no per-entry key to anchor on. A block table may narrow to the fields
   * that are actually displayed — the same object also carries ids, colours and
   * CSS hooks that must stay verbatim.
   */
  block?: string
  fields?: string[]
  pattern?: string
}

export const DYNAMIC_TABLES: DynamicTable[] = [
  {
    what: 'icon picker labels (rendered as t(entry.label))',
    file: 'utils/nodeIcons.ts',
    pattern: "label:\\s*'((?:[^'\\\\]|\\\\.)*)'",
  },
  {
    what: 'theme descriptions (rendered as t(preset.description))',
    file: 'utils/themes.ts',
    pattern: "description:\\s*'((?:[^'\\\\]|\\\\.)*)'",
  },
  {
    // Only this const — the same file also holds STATUS_COLORS and
    // EDGE_TYPE_LABELS, whose values are enums rather than display copy.
    what: 'device type labels (rendered as t(NODE_TYPE_LABELS[...]))',
    file: 'types/index.ts',
    block: 'NODE_TYPE_LABELS',
  },
  {
    what: 'document template labels and hints',
    file: 'documentation/types.ts',
    pattern: "(?:label|hint):\\s*'((?:[^'\\\\]|\\\\.)*)'",
  },
  {
    // Only the fields the modal displays. Excluded: `label` (a proper noun the
    // caller interpolates as data into another key), and `key` / `brandSlug` /
    // `accent` / `dataTour` — an id, a brand key, a colour and a walkthrough
    // anchor, all of which must stay verbatim.
    what: 'import source captions and descriptions (t(source.description), t(item))',
    file: 'components/modals/ImportSourceModal.tsx',
    block: 'SOURCES',
    fields: ['description', 'duration', 'durationNote', 'imports'],
  },
  {
    // Edge type names, read raw at the render sites that show a link's type.
    what: 'edge type labels (EDGE_TYPE_LABELS)',
    file: 'types/index.ts',
    block: 'EDGE_TYPE_LABELS',
  },
  {
    // The icon picker's filter tabs are built from this field.
    what: 'icon categories (the picker filter tabs)',
    file: 'utils/nodeIcons.ts',
    pattern: "category:\\s*'((?:[^'\\\\]|\\\\.)*)'",
  },
  {
    // Rendered as t(GROUP_BY_LABELS[option]) in the tree toolbar.
    what: 'documentation tree group-by captions',
    file: 'documentation/types.ts',
    block: 'GROUP_BY_LABELS',
  },
  {
    what: 'rack faceplate labels (faceplateLabel())',
    file: 'rack/faceplates.ts',
    pattern: "label:\\s*'((?:[^'\\\\]|\\\\.)*)'",
  },
]

/** Read the display fields inside `export const <name> = { … }` or `[ … ]`. */
export function valuesInBlock(source: string, name: string, fields?: string[]): string[] {
  const start = source.indexOf(`${name}`)
  if (start === -1) return []
  // The table may be an object or an array of objects. Find the first opener
  // that actually contains something: `const SOURCES: ImportSource[] = [` has an
  // empty `[]` in the type annotation just before the real literal.
  let open = -1
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (c !== '{' && c !== '[') continue
    if (source[i + 1] === (c === '{' ? '}' : ']')) { i += 1; continue }
    open = i
    break
  }
  if (open === -1) return []
  const closer = source[open] === '{' ? '}' : ']'
  const opener = source[open]

  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === opener) depth++
    else if (source[i] === closer) {
      depth--
      if (depth === 0) {
        const body = source.slice(open, i)
        const quoted = (s: string) => s.replace(/\\'/g, "'").replace(/\\"/g, '"')
        const found: string[] = []
        if (!fields) {
          for (const m of body.matchAll(/:\s*'((?:[^'\\]|\\')*)'/g)) found.push(m[1])
          for (const m of body.matchAll(/\[([^\]]*)\]/g)) {
            for (const n of m[1].matchAll(/'((?:[^'\\]|\\')*)'/g)) found.push(n[1])
          }
        } else {
          // Global: the same field repeats once per entry, and a non-global
          // regex would only ever see the first one.
          for (const field of fields) {
            const scalar = new RegExp(`\\b${field}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g')
            for (const m of body.matchAll(scalar)) found.push(m[1])
            const arr = new RegExp(`\\b${field}:\\s*\\[([^\\]]*)\\]`, 'g')
            for (const m of body.matchAll(arr)) {
              for (const n of m[1].matchAll(/'((?:[^'\\]|\\')*)'/g)) found.push(n[1])
            }
          }
        }
        return [...new Set(found.map(quoted))]
      }
    }
  }
  return []
}

/**
 * Modal title/label defaults. The modal renders `{t(title)}`, so the default
 * literal is a key rather than a bare string, and two of them are additionally
 * compared with `===` to pick the Add-vs-Save button set. Listed explicitly
 * because they are scattered across nine component signatures rather than one
 * table.
 */
export const DIALOG_TITLES = [
  'Add Node',
  'Add Service',
  'Add Text',
  'Add Zone',
  'Connect Nodes',
  'Edit Link',
  'Edit Node',
  'Edit Text',
  'Edit Zone',
  'New Canvas',
] as const

/** Every value this table can put in front of a user. */
export function valuesOf(source: string, table: DynamicTable): string[] {
  if (table.block) return valuesInBlock(source, table.block, table.fields)
  const re = new RegExp(table.pattern!, 'g')
  return [...new Set([...source.matchAll(re)].map((m) => m[1].replace(/\\'/g, "'")))]
}
