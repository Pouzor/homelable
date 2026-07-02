import { describe, it, expect } from 'vitest'
import { generateMarkdownTable } from '../exportMarkdown'
import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const makeNode = (overrides: Partial<NodeData> = {}, id = '1'): Node<NodeData> => ({
  id,
  type: overrides.type ?? 'server',
  position: { x: 0, y: 0 },
  data: { label: 'Test', type: 'server', status: 'online', services: [], ...overrides },
})

describe('generateMarkdownTable', () => {
  it('returns empty string for empty node list', () => {
    expect(generateMarkdownTable([])).toBe('')
  })

  it('excludes groupRect nodes', () => {
    const nodes = [makeNode({ type: 'groupRect', label: 'Zone' })]
    expect(generateMarkdownTable(nodes)).toBe('')
  })

  it('generates header + separator + row', () => {
    const nodes = [makeNode({ label: 'Router', type: 'router', ip: '192.168.1.1', status: 'online' })]
    const md = generateMarkdownTable(nodes)
    const lines = md.split('\n')
    expect(lines[0]).toContain('Label')
    expect(lines[0]).toContain('IP')
    expect(lines[1]).toContain('---')
    expect(lines[2]).toContain('Router')
    expect(lines[2]).toContain('192.168.1.1')
  })

  it('uses — for missing fields', () => {
    const nodes = [makeNode({ label: 'Node', type: 'generic', ip: undefined, hostname: undefined })]
    const md = generateMarkdownTable(nodes)
    expect(md).toContain('—')
  })

  it('lists services as name:port pairs', () => {
    const nodes = [makeNode({
      label: 'Server',
      services: [{ port: 80, protocol: 'tcp', service_name: 'nginx' }, { port: 443, protocol: 'tcp', service_name: 'https' }],
    })]
    const md = generateMarkdownTable(nodes)
    expect(md).toContain('nginx:80')
    expect(md).toContain('https:443')
  })

  it('escapes pipe characters in cell values', () => {
    const nodes = [makeNode({ label: 'A|B' })]
    const md = generateMarkdownTable(nodes)
    expect(md).toContain('A\\|B')
  })

  it('escapes backslashes before pipes so the escape char is not ambiguous', () => {
    const nodes = [makeNode({ label: 'A\\|B' })]
    const md = generateMarkdownTable(nodes)
    // backslash doubled, then the literal pipe escaped
    expect(md).toContain('A\\\\\\|B')
  })

  it('collapses newlines in cell values so they do not break the table', () => {
    const nodes = [makeNode({ label: 'line1\nline2', hostname: 'a\r\nb' })]
    const lines = generateMarkdownTable(nodes).split('\n')
    // header + separator + exactly one data row (no extra line from the value)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('line1 line2')
    expect(lines[2]).toContain('a b')
  })

  it('escapes pipe characters inside service names', () => {
    const nodes = [makeNode({
      label: 'Server',
      services: [{ port: 80, protocol: 'tcp', service_name: 'web|proxy' }],
    })]
    const lines = generateMarkdownTable(nodes).split('\n')
    // header + separator + exactly one data row — the pipe must not add a column
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('web\\|proxy')
  })

  it('generates one row per non-groupRect node', () => {
    const nodes = [
      makeNode({ type: 'server', label: 'A' }, '1'),
      makeNode({ type: 'router', label: 'B' }, '2'),
      makeNode({ type: 'groupRect', label: 'Zone' }, '3'),
    ]
    const lines = generateMarkdownTable(nodes).split('\n')
    // header + separator + 2 data rows
    expect(lines).toHaveLength(4)
  })
})
