#!/usr/bin/env node
// Regenerate frontend/src/data/dashboardIcons.json from the upstream
// homarr-labs/dashboard-icons repo. Run manually to refresh the manifest.
//
//   node scripts/fetch-dashboard-icons.mjs
//
// Uses the GitHub git-tree API to enumerate the actual svg/*.svg files. The
// repo's own tree.json manifest lags the real icon set by hundreds of icons,
// so it must not be used as the source of truth.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TREE_URL =
  'https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main?recursive=1'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/dashboardIcons.json')

const res = await fetch(TREE_URL, { headers: { 'User-Agent': 'homelable-icon-refresh' } })
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
const data = await res.json()
if (data.truncated) console.warn('warning: GitHub tree was truncated \u2014 list may be incomplete')
const slugs = (data.tree ?? [])
  .filter((f) => f.type === 'blob' && f.path.startsWith('svg/') && f.path.endsWith('.svg'))
  .map((f) => f.path.slice(4, -4))
  .sort()

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(slugs))
console.log(`wrote ${slugs.length} slugs \u2192 ${OUT}`)
