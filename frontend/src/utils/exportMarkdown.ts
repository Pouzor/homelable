import type { Node } from '@xyflow/react'
import type { NodeData } from '@/types'

const EMPTY = '—'

function cell(v: string | null | undefined): string {
  if (!v) return EMPTY
  // Escape backslashes first, then pipes, and collapse newlines so they don't break the table
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
}

export function generateMarkdownTable(nodes: Node<NodeData>[]): string {
  const rows = nodes
    .filter((n) => n.data.type !== 'groupRect')
    .map((n) => {
      const d = n.data
      const services = d.services?.length
        ? d.services.map((s) => {
          const port = s.port != null ? `:${s.port}` : ''
          const path = s.path?.trim() ? s.path.trim() : ''
          return `${s.service_name}${port}${path}`
        }).join(', ')
        : EMPTY
      return [
        cell(d.label),
        cell(d.type),
        cell(d.ip),
        cell(d.hostname),
        cell(d.status),
        cell(services),
      ]
    })

  if (rows.length === 0) return ''

  const headers = ['Label', 'Type', 'IP', 'Hostname', 'Status', 'Services']
  const separator = headers.map(() => '---')

  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ]

  return lines.join('\n')
}
