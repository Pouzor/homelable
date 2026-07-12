#!/usr/bin/env node
/**
 * Fetches the selfh.st/icons slug list and writes it to
 * src/data/selfhstIcons.json. Run from the frontend/ directory:
 *
 *   node scripts/fetch-selfhst-icons.mjs
 *
 * Uses the jsDelivr CDN's resolve API to enumerate available SVG files
 * in the selfhst/icons GitHub repository.
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// jsDelivr resolve API lists all files in the package (no auth required)
const API_URL = 'https://data.jsdelivr.com/v1/packages/gh/selfhst/icons@main/flat'

const res = await fetch(API_URL)
const data = await res.json()

let slugs

if (Array.isArray(data?.files)) {
  // Response has { files: ["/svg/foo.svg", ...] }
  slugs = data.files
    .filter((f) => f.startsWith('/svg/') && f.endsWith('.svg'))
    .map((f) => f.replace('/svg/', '').replace('.svg', ''))
    .sort()
} else {
  // Fallback: use GitHub contents API
  console.warn('jsDelivr API unavailable, trying GitHub contents API...')
  const ghRes = await fetch(
    'https://api.github.com/repos/selfhst/icons/contents/svg',
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'homelable/1.0' } },
  )
  if (!ghRes.ok) {
    console.error('Both APIs failed. Keeping existing selfhstIcons.json.')
    process.exit(0)
  }
  const files = await ghRes.json()
  slugs = files
    .filter((f) => f.type === 'file' && f.name.endsWith('.svg'))
    .map((f) => f.name.replace('.svg', ''))
    .sort()
}

const outPath = join(__dirname, '../src/data/selfhstIcons.json')
writeFileSync(outPath, JSON.stringify(slugs, null, 2) + '\n')
console.log(`✓ Wrote ${slugs.length} selfh.st icon slugs to ${outPath}`)
