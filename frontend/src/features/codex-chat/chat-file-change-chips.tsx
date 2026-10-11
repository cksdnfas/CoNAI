import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FilePen, FilePlus, Undo2 } from 'lucide-react'
import type { ChatFileChange, StoredFileEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { FilePreview } from '@/features/files/file-preview'
import { useI18n } from '@/i18n'
import { undoChatFileChange } from '@/lib/api-codex-chat'
import { FILES_QUERY_KEY, getStoredFile } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { codexChatThreadQueryKey } from './codex-chat-context'

/**
 * The text files a reply's tools wrote, one chip each: the name opens the file with its versions, and the undo puts
 * the file back as it was before this reply (a file the reply made is removed, after asking).
 */
export function ChatFileChangeChips({ changes, threadId, replyId }: { changes?: ChatFileChange[]; threadId?: number; replyId?: string }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<StoredFileEntry | null>(null)
  const undo = useMutation({
    mutationFn: (fileId: string) => undoChatFileChange(threadId as number, replyId as string, fileId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId ?? null) }),
        queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY }),
      ])
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '되돌리지 못했어.', en: 'Could not undo.' })), tone: 'error' }),
  })
  if (!changes?.length) return null
  const open = async (change: ChatFileChange) => {
    try { setPreview(await getStoredFile(change.fileId)) }
    catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '파일을 열지 못했어.', en: 'Could not open the file.' })), tone: 'error' }) }
  }
  const run = async (change: ChatFileChange) => {
    if (change.created && !(await confirm({ title: t({ ko: '{name}을 지울까?', en: 'Delete {name}?' }, { name: change.name }), confirmLabel: t({ ko: '지우기', en: 'Delete' }), tone: 'destructive' }))) return
    undo.mutate(change.fileId)
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {changes.map((change) => {
        const Icon = change.created ? FilePlus : FilePen
        const where = change.folder ? `${change.folder === '/' ? '' : change.folder}/${change.name}` : change.name
        return (
          <span key={change.fileId} className={cn('inline-flex h-6 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-foreground', change.undone && 'line-through opacity-60')}>
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <Tip content={change.folder === null ? t({ ko: '지워진 파일', en: 'Deleted file' }) : where}>
              <Button variant="ghost" size="xs" className="h-5 min-w-0 px-0 font-mono text-2xs hover:bg-transparent hover:text-primary" disabled={change.folder === null} onClick={() => void open(change)}><span className="truncate">{change.name}</span></Button>
            </Tip>
            {!change.undone && change.folder !== null && threadId !== undefined && replyId
              ? <IconButton variant="ghost" size="icon-xs" className="-mr-2 size-5 rounded-full text-primary" disabled={undo.isPending} label={change.created ? t({ ko: '만든 파일 지우기', en: 'Remove the file it made' }) : t({ ko: '이 답변 전으로 되돌리기', en: 'Undo to before this reply' })} onClick={() => void run(change)}><Undo2 /></IconButton>
              : null}
          </span>
        )
      })}
      {preview ? <FilePreview entry={preview} history onClose={() => setPreview(null)} onNavigate={setPreview} /> : null}
    </div>
  )
}
