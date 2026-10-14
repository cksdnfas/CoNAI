import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import type { FileWriteSource, StoredFileEntry } from '@conai/shared'
import { TextDiff } from '@/components/common/text-diff'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, listStoredFileRevisions, readStoredFileRevision, readWholeStoredFileText, restoreStoredFileRevision } from '@/lib/api-files'
import { formatFileSize } from '@/lib/format-size'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

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
      <div className="max-h-[60vh] min-w-0 overflow-auto">
        {version.data && current.data !== undefined
          ? <TextDiff before={version.data.text} after={current.data} fill={false} className="py-0" empty={<p className="px-3 py-2 font-sans text-sm text-muted-foreground">{t({ ko: '지금 내용과 같아.', en: 'Same as the current text.' })}</p>} />
          : <LoadingState />}
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
