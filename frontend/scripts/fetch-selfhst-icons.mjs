#!/usr/bin/env node
/**
 * Fetches the selfh.st/icons slug list and writes it to
 * src/data/selfhstIcons.json. Run from the frontend/ directory:
 *
 *   node scripts/fetch-selfhst-icons.mjs
 *
 * Primary: jsDelivr CDN resolve API (no auth required).
 * Fallback: GitHub contents API (1000-item limit per page).
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// jsDelivr v1 flat API
const JSDELIVR_URL = 'https://data.jsdelivr.com/v1/packages/gh/selfhst/icons@main/flat'

let slugs

const res = await fetch(JSDELIVR_URL)
const data = await res.json()

if (Array.isArray(data?.files)) {
  // v1 API: { files: ["/svg/foo.svg", ...] }
  slugs = data.files
    .filter((f) => f.startsWith('/svg/') && f.endsWith('.svg'))
    .map((f) => f.replace('/svg/', '').replace('.svg', ''))
    .sort()
} else {
  // jsDelivr returned a non-array (API may have changed) — fall back to GitHub
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
  if (!Array.isArray(files)) {
    console.error('GitHub API error:', JSON.stringify(files).slice(0, 200))
    process.exit(1)
  }
  slugs = files
    .filter((f) => f.type === 'file' && f.name.endsWith('.svg'))
    .map((f) => f.name.replace('.svg', ''))
    .sort()
  if (slugs.length >= 1000) {
    console.warn('Note: GitHub contents API caps at 1000 entries per page; result may be incomplete.')
  }
}

const outPath = join(__dirname, '../src/data/selfhstIcons.json')
writeFileSync(outPath, JSON.stringify(slugs, null, 2) + '\n')
console.log(`✓ Wrote ${slugs.length} selfh.st icon slugs to ${outPath}`)
