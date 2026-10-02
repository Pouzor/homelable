import fs from 'node:fs'
import path from 'node:path'
import { DIALOG_TITLES, DYNAMIC_TABLES, valuesOf } from '../dynamicTables'

// __dirname is src/i18n/__tests__, so `../..` is already `src`.
const SRC = path.resolve(__dirname, '../..')

/** Every key that has a zh-CN entry, across all parts. */
function dictionaryKeys(): Set<string> {
  const keys = new Set<string>()
  const dir = path.join(SRC, 'i18n/locales/parts')
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/^\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*:/gm)) {
      keys.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'))
    }
  }
  return keys
}

describe('tables whose values reach t() at runtime', () => {
  const dict = dictionaryKeys()

  for (const table of DYNAMIC_TABLES) {
    it(`${table.what} all have a zh-CN entry`, () => {
      const src = fs.readFileSync(path.join(SRC, table.file), 'utf8')
      const all = valuesOf(src, table)
      // Guard against a stale selector making this pass vacuously.
      expect(all.length, `no values found in ${table.file} — the selector is stale`).toBeGreaterThan(0)
      // Protocol names are exempt by *value*, not by table: a table-level
      // exemption would cover every string later added to the same table.
      const verbatim = new Set<string>(table.verbatim ?? [])
      const missing = all.filter((v) => !verbatim.has(v) && !dict.has(v))
      expect(
        missing,
        `These ${table.what} fall back to English (from ${table.file}):\n` + missing.join('\n'),
      ).toEqual([])
    })
  }
})

describe('no English string literal reaches a render site untranslated', () => {
  // The sweep that found the first batch of misses only looked at JSX text and
  // the standard title/aria/placeholder attributes, so it missed custom props
  // (<Centered detail=…>), object-literal fields and default parameters. This is
  // the wider net, kept deliberately blunt: it flags anything prose-shaped that
  // is not inside t(). A hit means "look at it by hand"; a hit that is
  // deliberate belongs in ALLOWED with the reason stated.
  const ALLOWED = new Map<string, string>([
    ['Home', 'brand wordmark, deliberately kept as typed'],
    // Sample input, not copy.
    ['My Server', 'sample input'],
    ['Node host (app.example.com)', 'sample input'],
    ['Path (/admin)', 'sample input'],
    // Sliced on the way to t(): PropertyForm does
    // `(visibleLabel ?? 'Show on node').replace(/^Show on /i, '')` to pull the
    // surface word out and look it up in a translated map. The English default
    // is the input to that slice, not copy in its own right.
    ['Show on node', 'sliced for a surface word before t()'],
    ['Show on canvas', 'sliced for a surface word before t()'],
    // A backend error string that is compared against, not shown: LiveView
    // branches on `detail === 'Live view is disabled'` to tell "disabled" from
    // "bad key". Translating it would break the branch.
    ['Live view is disabled', 'compared against to branch, never displayed'],
    // Property keys the Proxmox and YAML importers already mint. They become
    // data, so a translated suggestion would key off a name the import never emits.
    ['CPU Model', 'property key minted by the importers, becomes data'],
    ['CPU Cores', 'property key minted by the importers, becomes data'],
    // Proper nouns.
    ['Z-Wave JS', 'proper noun'],
    ['Proxmox VE', 'proper noun'],
    // Sample data the demo seeds into a fresh canvas: an OS release, a product
    // name, a rack name, a cable label. They stand in for what a user would type,
    // so they behave like the other sample values.
    ['Debian 12', 'demo sample data, stands in for a user-entered value'],
    ['TrueNAS SCALE', 'demo sample data, stands in for a user-entered value'],
    ['Main rack', 'demo sample data, stands in for a user-entered value'],
    ['Cable manager', 'demo sample data, stands in for a user-entered value'],
    ['WAN uplink', 'demo sample data, stands in for a user-entered value'],
    ['Patch ref', 'demo sample data, stands in for a user-entered value'],
    // Device and product names in the seeded demo canvases. They are the app's
    // stand-ins for what a user would have typed on their own network.
    ['Freebox Ultra', 'demo sample data: a real product name'],
    ['Netgear GS308', 'demo sample data: a real product name'],
    ['TP-Link TL-SG108', 'demo sample data: a real product name'],
    ['Proxmox VE 8.2', 'demo sample data: an OS release'],
    ['Synology DSM', 'demo sample data: a product name'],
    ['UniFi AP', 'demo sample data: a real product name'],
    ['Zigbee Hub', 'demo sample data: a device name of the demo canvas'],
    ['VLAN 20', 'demo sample data: a technical value, not copy'],
    ['DSM 7.2', 'demo sample data: an OS release'],
    ['Synology NAS', 'demo sample data: a product name'],
    ['Raspberry Pi', 'demo sample data: a product name'],
    // Property keys the Z-Wave importer mints. They persist as data, so a
    // translated key would name a property the importer never emits.
    ['Z-Wave ID', 'property key minted by the Z-Wave importer, becomes data'],
    ['Vendor', 'property key minted by the importer, becomes data'],
    ['Model', 'property key minted by the importer, becomes data'],
  ])
  // The modal title defaults, each of which the modal renders as {t(title)}.
  for (const title of DIALOG_TITLES) {
    ALLOWED.set(title, 'dialog title default, rendered as {t(title)}')
  }

    // Prose in a comment is documentation, not copy. Strip comments before
    // scanning rather than guessing from line prefixes — a block comment's
    // continuation lines do not start with `*`, and its opening line often
    // carries no marker at all. The block state carries across lines, since a
    // comment may open mid-line.
    function stripComments(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
      let code = ''
      for (let i = 0; i < line.length; i++) {
        if (inBlock) {
          if (line[i] === '*' && line[i + 1] === '/') { inBlock = false; i++ }
          continue
        }
        if (line[i] === '/' && line[i + 1] === '*') { inBlock = true; i++; continue }
        if (line[i] === '/' && line[i + 1] === '/') break
        code += line[i]
      }
      return { code, inBlock }
    }

    const SKIP_LINE = [
      /^\s*import\b/,
      /^\s*export\s+.*from/,
      /^\s*$/,
      /className=/,
      /\bfrom ['"]/,
      /data-[a-z-]+=/,
      /console\.(log|warn|error|info)/,
      /@ts-ignore/,
      /@ts-expect-error/,
      /eslint/,
    ]

  const isProse = (s: string) => {
    if (!/^[A-Z]/.test(s) || !/\s/.test(s) || s.length < 6) return false
    if (/^[A-Z0-9_./:-]+$/.test(s)) return false
    // SVG path data. Interpolated coordinates are stripped first: their variable
    // names would never match a path-command character class.
    const bare = s.replace(/\$\{[^}]*\}/g, '')
    if (/^[MmLlHhVvCcSsQqTtAaZz][\d\s.,MHmLlHhVvCcSsQqTtAaZz-]*$/.test(bare)) return false
    if (/,\s*(monospace|serif|sans-serif|cursive|fantasy)$/.test(s)) return false
    if (/^(Bearer|Basic)\s/.test(s)) return false
    // An HTTP verb used as a terse note, e.g. "GET /nodes".
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\//.test(s)) return false
    // Composite keys built by joining fields with a pipe — de-duplication keys,
    // cache keys, the like. Never shown to anyone.
    if (s.includes('|')) return false
    return true
  }

  it('finds nothing outside the allowlist', () => {
    // A string that has a dictionary entry is, by definition, translated — so it
    // is skipped here even when the `t()` is applied somewhere other than this
    // line. That covers the three shapes the earlier version of this sweep
    // false-positived on: values in a data table (`t(source.description)`),
    // component defaults (`title = 'Add Node'`, rendered as `{t(title)}`), and a
    // default sliced before lookup. A genuine miss has no entry, and that is
    // exactly what this test is here to catch.
    const dict = dictionaryKeys()
    const tableValues = new Set<string>()
    for (const table of DYNAMIC_TABLES) {
      for (const v of valuesOf(fs.readFileSync(path.join(SRC, table.file), 'utf8'), table)) {
        tableValues.add(v)
      }
    }

    const files: string[] = []
    ;(function walk(d: string) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'i18n') continue
          // src/test/ holds shared fixture factories, not app copy.
          if (e.name === 'test') continue
          walk(full)
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) {
          files.push(full)
        }
      }
    })(SRC)

    expect(files.length).toBeGreaterThan(100)

    const hits: string[] = []
    for (const f of files) {
      let inBlock = false
      for (const [i, raw] of fs.readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
        const { code: line, inBlock: stillInBlock } = stripComments(raw, inBlock)
        inBlock = stillInBlock
        if (SKIP_LINE.some((re) => re.test(line))) continue
        const translated = new Set(
          [...line.matchAll(/\bt\((['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]),
        )
        for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
          const v = m[2]
          if (!isProse(v) || translated.has(v) || dict.has(v) || tableValues.has(v) || ALLOWED.has(v)) continue
          if (/^https?:|^\/|^\.|^#/.test(v)) continue
          hits.push(`${path.relative(SRC, f)}:${i + 1}  ${JSON.stringify(v)}`)
        }
      }
    }
    expect(
      hits,
      `Untranslated English literals — translate them, or add them to ALLOWED with a reason:\n${hits.join('\n')}`,
    ).toEqual([])
  })

  it('states a reason for every allowlisted string', () => {
    for (const [text, reason] of ALLOWED) {
      expect(reason.length, `ALLOWED entry ${JSON.stringify(text)} has no reason`).toBeGreaterThan(10)
    }
  })

  /**
   * Every read of the check-method table must be wrapped in `t()`.
   *
   * This is the one gap the other checks cannot close. The literal sweep skips
   * table values (they are data), the dictionary test only asks whether `Ping`
   * *has* an entry, and neither notices that a render site stopped calling
   * `t()` — the value is still translated, it just is not being read any more.
   * That is not hypothetical: all three check-method pickers in this app
   * printed the table straight to the screen, so the dropdown offered a bare
   * English `Ping` in an otherwise Chinese interface, in two modals, with the
   * whole suite green.
   *
   * The tables are now one, so this asserts that no caller can quietly drop
   * the wrapper again, and a re-introduced local copy fails too.
   */
  it('routes every check-method caption read through t()', () => {
    const CALLERS = [
      'components/modals/NodeModal.tsx',
      'components/modals/InventoryDeviceModal.tsx',
    ]
    const hits: string[] = []
    for (const rel of CALLERS) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
      let inBlock = false
      for (const [i, raw] of src.split(/\r?\n/).entries()) {
        const { code: line, inBlock: stillInBlock } = stripComments(raw, inBlock)
        inBlock = stillInBlock
        // The import is the one legitimate bare mention.
        if (/^\s*import\b/.test(line)) continue
        for (const m of line.matchAll(/\bCHECK_METHOD_LABELS\b/g)) {
          const before = line.slice(0, m.index)
          // `t(CHECK_METHOD_LABELS[…])` is the only acceptable shape.
          if (/\bt\(\s*$/.test(before)) continue
          hits.push(`${rel}:${i + 1}  CHECK_METHOD_LABELS read without t()`)
        }
      }
    }
    expect(
      hits,
      `Check-method captions reaching the screen untranslated:\n${hits.join('\n')}`,
    ).toEqual([])
  })

  it('no dynamic table waives its whole value set', () => {
    // `verbatim` exists for protocol names. If it ever covered a whole table
    // the entry would assert nothing at all while still reading as coverage.
    for (const table of DYNAMIC_TABLES) {
      if (!table.verbatim?.length) continue
      const all = valuesOf(fs.readFileSync(path.join(SRC, table.file), 'utf8'), table)
      const waived = all.filter((v) => (table.verbatim ?? []).includes(v))
      expect(waived.length, `${table.what} waives every value it has`).toBeLessThan(all.length)
    }
  })
})
