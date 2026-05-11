#!/usr/bin/env node
// Regenerate frontend/src/data/dashboardIcons.json from the upstream
// homarr-labs/dashboard-icons repo. Run manually to refresh the manifest.
//
//   node scripts/fetch-dashboard-icons.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TREE_URL = 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/tree.json'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/dashboardIcons.json')

const res = await fetch(TREE_URL)
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
const tree = await res.json()
const slugs = (tree.svg ?? [])
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .sort()

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(slugs))
console.log(`wrote ${slugs.length} slugs → ${OUT}`)
