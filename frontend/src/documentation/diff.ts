/**
 * A line diff between two document bodies.
 *
 * History is only useful if you can see what a version actually changed, and
 * "restore and compare afterwards" is not that. This is deliberately small: no
 * word-level diff, no library — a document is prose in lines, and lines are the
 * unit a writer thinks in.
 *
 * The matching is a plain LCS over the lines that differ, after the common head
 * and tail are trimmed off. That trim is what keeps it cheap: a typical edit
 * touches a paragraph in the middle of a long document, so the matrix is built
 * over a handful of lines rather than the whole file. `MAX_CELLS` catches the
 * pathological case — two long, wholly different bodies — where the answer is
 * "all of it changed" anyway.
 */

export type DiffKind = 'same' | 'add' | 'del'

export interface DiffLine {
  kind: DiffKind
  text: string
}

/** Above this many LCS cells the diff degrades to "replaced wholesale". */
const MAX_CELLS = 250_000

function split(body: string): string[] {
  return (body ?? '').split('\n')
}

function lcs(before: string[], after: string[]): DiffLine[] {
  // table[i][j] = length of the longest common subsequence of the suffixes.
  const table: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  )
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: before[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'del', text: before[i] })
      i++
    } else {
      out.push({ kind: 'add', text: after[j] })
      j++
    }
  }
  while (i < before.length) out.push({ kind: 'del', text: before[i++] })
  while (j < after.length) out.push({ kind: 'add', text: after[j++] })
  return out
}

/** Every line of both bodies, tagged with what happened to it. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = split(before)
  const b = split(after)

  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }

  const middleA = a.slice(head, a.length - tail)
  const middleB = b.slice(head, b.length - tail)
  const middle =
    middleA.length * middleB.length > MAX_CELLS
      ? [
          ...middleA.map((text): DiffLine => ({ kind: 'del', text })),
          ...middleB.map((text): DiffLine => ({ kind: 'add', text })),
        ]
      : lcs(middleA, middleB)

  return [
    ...a.slice(0, head).map((text): DiffLine => ({ kind: 'same', text })),
    ...middle,
    ...a.slice(a.length - tail).map((text): DiffLine => ({ kind: 'same', text })),
  ]
}

/** How many lines the change added and removed, for the one-line summary. */
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
  }
}

/**
 * The diff with long runs of unchanged lines collapsed to `context` on each
 * side of a change, so a one-line edit in a long document reads as one hunk.
 * A collapsed run is reported as a gap rather than dropped silently.
 */
export type DiffRow = DiffLine | { kind: 'gap'; text: string; skipped: number }

export function collapseDiff(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let i = Math.max(0, index - context); i <= Math.min(lines.length - 1, index + context); i++) {
      keep[i] = true
    }
  })

  const rows: DiffRow[] = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) {
        rows.push({ kind: 'gap', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}`, skipped })
        skipped = 0
      }
      rows.push(line)
    } else {
      skipped++
    }
  })
  if (skipped) {
    rows.push({ kind: 'gap', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}`, skipped })
  }
  return rows
}
