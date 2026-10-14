import { useMemo, type ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export type DiffLine = { kind: 'same' | 'del' | 'ins'; text: string }
type DiffRow = DiffLine | { kind: 'gap'; count: number }
/** Cells the line-by-line comparison may use before the changed middle is shown as removed then added. */
const DIFF_CELL_LIMIT = 4_000_000
/** Unchanged lines kept around each change. */
const CONTEXT_LINES = 2

/** Line diff of `before` → `after`: the common start and end are trimmed, the middle compared by longest common lines. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const head = a.slice(0, start).map((text) => ({ kind: 'same' as const, text }))
  const tail = a.slice(endA).map((text) => ({ kind: 'same' as const, text }))
  const midA = a.slice(start, endA), midB = b.slice(start, endB)
  if (midA.length * midB.length > DIFF_CELL_LIMIT) {
    return [...head, ...midA.map((text) => ({ kind: 'del' as const, text })), ...midB.map((text) => ({ kind: 'ins' as const, text })), ...tail]
  }
  const width = midB.length + 1
  const table = new Uint32Array((midA.length + 1) * width)
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const middle: DiffLine[] = []
  let i = 0, j = 0
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) { middle.push({ kind: 'same', text: midA[i] }); i++; j++ }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) middle.push({ kind: 'del', text: midA[i++] })
    else middle.push({ kind: 'ins', text: midB[j++] })
  }
  while (i < midA.length) middle.push({ kind: 'del', text: midA[i++] })
  while (j < midB.length) middle.push({ kind: 'ins', text: midB[j++] })
  return [...head, ...middle, ...tail]
}

/** Changed lines with a little context; long unchanged runs fold into one "…" row. */
export function foldUnchanged(lines: DiffLine[]): DiffRow[] {
  const keep = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, index - CONTEXT_LINES); k <= Math.min(lines.length - 1, index + CONTEXT_LINES); k++) keep[k] = true
  })
  const result: DiffRow[] = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) { result.push({ kind: 'gap', count: skipped }); skipped = 0 }
      result.push(line)
    } else skipped++
  })
  if (skipped) result.push({ kind: 'gap', count: skipped })
  return result
}

/**
 * What changed from `before` to `after`, line by line: removed lines struck through, added lines tinted, long unchanged
 * runs folded to "⋯ N줄 같음". The one comparison view (file versions, knowledge proposals, plugin save reviews).
 * `fill` gives it the field fill (off inside a frame that already has one); `empty` replaces it when nothing changed.
 */
export function TextDiff({ before, after, fold = true, fill = true, empty, className }: { before: string; after: string; fold?: boolean; fill?: boolean; empty?: ReactNode; className?: string }) {
  const { t } = useI18n()
  const rows = useMemo(() => {
    const lines = diffLines(before, after)
    return fold ? foldUnchanged(lines) : lines
  }, [before, after, fold])
  const changed = rows.some((row) => row.kind === 'del' || row.kind === 'ins')
  if (!changed && empty !== undefined) return <>{empty}</>
  return (
    <div className={cn('min-w-0 overflow-auto py-2 font-mono text-xs leading-relaxed', fill && 'rounded-sm bg-field', className)}>
      {rows.map((row, index) => row.kind === 'gap'
        ? <div key={index} className="select-none px-3 py-0.5 text-muted-foreground">⋯ {t({ ko: '{count}줄 같음', en: '{count} lines unchanged' }, { count: row.count })}</div>
        : (
          <div key={index} className={cn('whitespace-pre-wrap break-words px-3', row.kind === 'del' && 'bg-destructive/15 text-destructive line-through decoration-destructive/50', row.kind === 'ins' && 'bg-success/15 text-success')}>
            <span className="mr-2 select-none text-muted-foreground" aria-hidden="true">{row.kind === 'del' ? '−' : row.kind === 'ins' ? '+' : ' '}</span>{row.text || ' '}
          </div>
        ))}
    </div>
  )
}
