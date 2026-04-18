import { describe, it, expect } from 'vitest'
import { THEMES, THEME_ORDER, type ThemeId } from '../themes'
import type { NodeType, EdgeType, NodeStatus } from '@/types'

const NODE_TYPES: NodeType[] = [
  'isp', 'router', 'switch', 'server', 'proxmox', 'vm', 'lxc',
  'nas', 'iot', 'ap', 'camera', 'printer', 'computer', 'cpl', 'docker_host', 'docker_container', 'generic', 'groupRect',
]
const EDGE_TYPES: EdgeType[] = ['ethernet', 'wifi', 'iot', 'vlan', 'virtual', 'cluster']
const STATUS_TYPES: NodeStatus[] = ['online', 'offline', 'pending', 'unknown']

describe('THEME_ORDER', () => {
  it('contains all theme IDs', () => {
    const keys = Object.keys(THEMES) as ThemeId[]
    expect(THEME_ORDER).toHaveLength(keys.length)
    expect(new Set(THEME_ORDER)).toEqual(new Set(keys))
  })
})

describe('THEMES', () => {
  for (const themeId of Object.keys(THEMES) as ThemeId[]) {
    describe(`theme: ${themeId}`, () => {
      const preset = THEMES[themeId]

      it('has id, label, description', () => {
        expect(preset.id).toBe(themeId)
        expect(typeof preset.label).toBe('string')
        expect(preset.label.length).toBeGreaterThan(0)
        expect(typeof preset.description).toBe('string')
      })

      it('has nodeAccents for all node types', () => {
        for (const type of NODE_TYPES) {
          expect(preset.colors.nodeAccents[type]).toBeDefined()
          expect(typeof preset.colors.nodeAccents[type].border).toBe('string')
          expect(typeof preset.colors.nodeAccents[type].icon).toBe('string')
        }
      })

      it('has surface colors', () => {
        expect(typeof preset.colors.nodeCardBackground).toBe('string')
        expect(typeof preset.colors.nodeIconBackground).toBe('string')
        expect(typeof preset.colors.nodeLabelColor).toBe('string')
        expect(typeof preset.colors.nodeSubtextColor).toBe('string')
      })

      it('has statusColors for all statuses', () => {
        for (const status of STATUS_TYPES) {
          expect(typeof preset.colors.statusColors[status]).toBe('string')
        }
      })

      it('has edgeColors for all edge types', () => {
        for (const type of EDGE_TYPES) {
          expect(typeof preset.colors.edgeColors[type]).toBe('string')
        }
      })

      it('has edge label colors', () => {
        expect(typeof preset.colors.edgeSelectedColor).toBe('string')
        expect(typeof preset.colors.edgeLabelBackground).toBe('string')
        expect(typeof preset.colors.edgeLabelColor).toBe('string')
        expect(typeof preset.colors.edgeLabelBorder).toBe('string')
      })

      it('has canvas colors', () => {
        expect(typeof preset.colors.canvasBackground).toBe('string')
        expect(typeof preset.colors.canvasDotColor).toBe('string')
      })

      it('has handle colors', () => {
        expect(typeof preset.colors.handleBackground).toBe('string')
        expect(typeof preset.colors.handleBorder).toBe('string')
      })

      it('has valid reactFlowColorMode', () => {
        expect(['dark', 'light']).toContain(preset.colors.reactFlowColorMode)
      })
    })
  }

  it('default theme matches original hardcoded colors', () => {
    const d = THEMES.default.colors
    expect(d.nodeAccents.server.border).toBe('#a855f7')
    expect(d.nodeAccents.isp.border).toBe('#00d4ff')
    expect(d.nodeAccents.proxmox.border).toBe('#ff6e00')
    expect(d.nodeAccents.docker_host.border).toBe('#2496ED')
    expect(d.nodeCardBackground).toBe('#21262d')
    expect(d.nodeIconBackground).toBe('#161b22')
    expect(d.canvasBackground).toBe('#0d1117')
    expect(d.canvasDotColor).toBe('#30363d')
    expect(d.edgeColors.ethernet).toBe('#30363d')
    expect(d.edgeColors.wifi).toBe('#00d4ff')
    expect(d.statusColors.online).toBe('#39d353')
    expect(d.statusColors.offline).toBe('#f85149')
  })

  it('light theme has reactFlowColorMode light', () => {
    expect(THEMES.light.colors.reactFlowColorMode).toBe('light')
  })

  it('light theme has light canvas background', () => {
    expect(THEMES.light.colors.canvasBackground).toBe('#f6f8fa')
  })

  it('matrix theme uses green accents', () => {
    const m = THEMES.matrix.colors
    expect(m.nodeAccents.isp.border).toMatch(/^#0/)
    expect(m.nodeLabelColor).toBe('#00ff41')
    expect(m.canvasBackground).toBe('#000000')
  })
})
