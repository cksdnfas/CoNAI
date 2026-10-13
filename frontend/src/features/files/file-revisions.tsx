import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import type { FileWriteSource, StoredFileEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, formatFileSize, listStoredFileRevisions, readStoredFileRevision, readWholeStoredFileText, restoreStoredFileRevision } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

type DiffLine = { kind: 'same' | 'del' | 'ins'; text: string }
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
function foldUnchanged(lines: DiffLine[]): Array<DiffLine | { kind: 'gap'; count: number }> {
  const keep = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let k = Math.max(0, index - CONTEXT_LINES); k <= Math.min(lines.length - 1, index + CONTEXT_LINES); k++) keep[k] = true
  })
  const result: Array<DiffLine | { kind: 'gap'; count: number }> = []
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

function useWriterLabel() {
  const { t } = useI18n()
  return (source: FileWriteSource | null) => {
    if (!source) return t({ ko: '알 수 없음', en: 'Unknown' })
    if (source.via === 'chat') return source.profileName ?? t({ ko: '채팅', en: 'Chat' })
    if (source.via === 'editor') return t({ ko: '편집기', en: 'Editor' })
    if (source.via === 'restore') return t({ ko: '되돌리기', en: 'Restore' })
    if (source.via === 'mcp') return 'MCP'
    return t({ ko: '앱', en: 'App' })
  }
}

/**
 * A text file's versions beside a comparison: the list (the current text first), and for the chosen version what
 * changed from it to the current text. `canRestore`: the viewer may write the file.
 */
export function FileRevisionsPanel({ entry, canRestore, onRestored }: { entry: StoredFileEntry; canRestore: boolean; onRestored: (entry: StoredFileEntry) => void }) {
  const { t, formatDateTime } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const writer = useWriterLabel()
  const [selected, setSelected] = useState<string | null>(null)
  const list = useQuery({ queryKey: [...FILES_QUERY_KEY, 'revisions', entry.id, entry.updatedAt], queryFn: () => listStoredFileRevisions(entry.id) })
  const chosen = selected ?? list.data?.revisions[0]?.id ?? null
  const current = useQuery({ queryKey: [...FILES_QUERY_KEY, 'whole-text', entry.id, entry.updatedAt], queryFn: () => readWholeStoredFileText(entry.id), enabled: chosen !== null })
  const version = useQuery({ queryKey: [...FILES_QUERY_KEY, 'revision', entry.id, chosen], queryFn: () => readStoredFileRevision(entry.id, chosen as string), enabled: chosen !== null })
  const rows = useMemo(() => version.data && current.data !== undefined ? foldUnchanged(diffLines(version.data.text, current.data)) : null, [version.data, current.data])
  const restore = useMutation({
    mutationFn: () => restoreStoredFileRevision(entry.id, chosen as string),
    onSuccess: async (saved) => {
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
      showSnackbar({ message: t({ ko: '그 버전으로 되돌렸어.', en: 'Restored that version.' }) })
      onRestored(saved)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '되돌리지 못했어.', en: 'Could not restore.' })), tone: 'error' }),
  })

  if (list.isPending) return <LoadingState />
  const revisions = list.data?.revisions ?? []
  if (revisions.length === 0) return <EmptyState icon={History} title={t({ ko: '이전 버전이 없어', en: 'No earlier versions' })} />
  return (
    <div className="grid min-h-0 gap-0 md:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="max-h-[60vh] min-w-0 overflow-auto font-mono text-xs leading-relaxed">
        {rows === null ? <LoadingState /> : rows.every((row) => row.kind === 'same' || row.kind === 'gap')
          ? <p className="px-3 py-2 font-sans text-sm text-muted-foreground">{t({ ko: '지금 내용과 같아.', en: 'Same as the current text.' })}</p>
          : rows.map((row, index) => row.kind === 'gap'
            ? <div key={index} className="select-none px-3 py-0.5 text-muted-foreground">⋯ {t({ ko: '{count}줄 같음', en: '{count} lines unchanged' }, { count: row.count })}</div>
            : <div key={index} className={cn('whitespace-pre-wrap break-words px-3', row.kind === 'del' && 'bg-destructive/15 text-destructive line-through decoration-destructive/50', row.kind === 'ins' && 'bg-success/15 text-success')}>
              <span className="mr-2 select-none text-muted-foreground" aria-hidden="true">{row.kind === 'del' ? '−' : row.kind === 'ins' ? '+' : ' '}</span>{row.text || ' '}
            </div>)}
      </div>
      <div className="flex min-w-0 flex-col border-t border-line md:border-l md:border-t-0">
        <div className="max-h-[52vh] overflow-auto">
          <div className="border-b border-line px-3 py-2">
            <div className="text-xs font-semibold">{t({ ko: '지금', en: 'Now' })}</div>
            <div className="truncate text-2xs text-muted-foreground">{writer(list.data?.current.writtenBy ?? null)} · {formatFileSize(entry.size)}</div>
          </div>
          {revisions.map((revision) => (
            <ListRow key={revision.id} asChild interactive size="sm" selected={chosen === revision.id} className="px-3 last:border-b">
              <button type="button" onClick={() => setSelected(revision.id)}>
                <span className="flex min-w-0 flex-col">
                  <span className={cn('text-xs font-semibold tabular-nums', chosen === revision.id && 'text-primary')}>{formatDateTime(revision.writtenAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="truncate text-2xs text-muted-foreground">{writer(revision.writtenBy)} · {formatFileSize(revision.size)}</span>
                </span>
              </button>
            </ListRow>
          ))}
        </div>
        {canRestore && chosen ? (
          <div className="p-2">
            <Button size="sm" className="w-full" disabled={restore.isPending} onClick={() => restore.mutate()}>{t({ ko: '이 버전으로 되돌리기', en: 'Restore this version' })}</Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
