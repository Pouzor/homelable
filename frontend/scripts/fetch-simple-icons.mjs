#!/usr/bin/env node
/**
 * Fetches the Simple Icons slug list from their npm package and writes it to
 * src/data/simpleIcons.json. Run from the frontend/ directory:
 *
 *   node scripts/fetch-simple-icons.mjs
 *
 * Each entry in the output is: { slug: string, title: string, hex: string }
 * so that the picker can show the icon name and default brand color.
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DATA_URL =
  'https://cdn.jsdelivr.net/npm/simple-icons@latest/_data/simple-icons.json'

const res = await fetch(DATA_URL)
if (!res.ok) {
  console.error(`Failed to fetch simple-icons data: ${res.status}`)
  process.exit(1)
}

// The _data/simple-icons.json is a flat array of { title, hex, source, aliases }
// Slugs are derived from title using simple-icons' slug algorithm.
const icons = await res.json()

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/\./g, 'dot')
    .replace(/&/g, 'and')
    .replace(/\+/g, 'plus')
    .replace(/!/g, '')
    .replace(/'/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\w-]/g, '')
}

const entries = icons
  .map(({ title, hex }) => ({ slug: slugify(title), title, hex }))
  .sort((a, b) => a.slug.localeCompare(b.slug))

const outPath = join(__dirname, '../src/data/simpleIcons.json')
writeFileSync(outPath, JSON.stringify(entries, null, 2) + '\n')
console.log(`✓ Wrote ${entries.length} Simple Icons entries to ${outPath}`)
