/**
 * Toggling a checkbox in a rendered document.
 *
 * Addressed by source line rather than by counting checkboxes: the rendered
 * tree carries each node's position, so a click maps straight back to the line
 * that produced it and nested or reordered lists cannot shift the target.
 */

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/

export function isTaskLine(line: string): boolean {
  return TASK.test(line)
}

/** Flip the task on 1-based `line`. Returns the body unchanged if it is not one. */
export function toggleTaskAtLine(body: string, line: number): string {
  const lines = (body ?? '').split('\n')
  const index = line - 1
  if (index < 0 || index >= lines.length) return body
  const match = TASK.exec(lines[index])
  if (!match) return body
  const next = match[2].trim() ? ' ' : 'x'
  lines[index] = `${match[1]}${next}${match[3]}${lines[index].slice(match[0].length)}`
  return lines.join('\n')
}
