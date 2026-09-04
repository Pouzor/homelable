import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const appVersion = fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf-8').trim()

// Serve Homelable under a subpath (`VITE_BASE_PATH=/homelab/`) instead of the root of
// an origin. Defaults to '/', where the built output is byte-for-byte what it was
// before this knob existed. Mirrors `normalizeBasePath` in src/utils/basePath.ts —
// duplicated rather than imported because that module reads `import.meta.env`, which
// does not exist while this config is being evaluated by Node.
const rawBase = (process.env.VITE_BASE_PATH ?? '').trim()
const base = !rawBase || rawBase === '/' ? '/' : `/${rawBase}/`.replace(/\/{2,}/g, '/')

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/components/ui/**', 'src/test/**'],
    },
  },
  server: {
    // Keyed off the base so `npm run dev` keeps working when one is set: the app then
    // calls /<base>/api/v1, and the prefix is stripped before hitting uvicorn.
    proxy: {
      [`${base}api`]: {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        rewrite: (p: string) => p.replace(base, '/'),
      },
      [`${base}ws`]: {
        target: 'ws://localhost:8000',
        ws: true,
        rewrite: (p: string) => p.replace(base, '/'),
      },
    },
  },
})
