import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { CHAT_BACKUP_FOLDER, OWN_LOREBOOKS_QUERY_KEY, chatBackupDate, listOwnLorebooks, type OwnedChatLorebook, type ThreadLorebookAction } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'

type Action = ThreadLorebookAction['action']

/** What a delete goes ahead with: the chat book's fate (single chats with a book) and the backup day, if backed up. */
export type ChatDeleteChoice = { lorebook?: ThreadLorebookAction; backupDate?: string }

/**
 * Deleting chats: back them up to the file store first (default) or just delete. A single chat whose own lorebook has
 * entries also asks about the book — delete it with the chat (default), keep it as an account book, or merge it into
 * one (the merge dialog follows when duplicates need a decision). Several chats take their books with them; a backup
 * carries the entries.
 */
export function ChatDeleteDialog({ open, count = 1, book, pending, onConfirm, onClose }: {
  open: boolean
  /** How many chats go (the selection of the chat list); a single chat may bring its `book`. */
  count?: number
  book: OwnedChatLorebook | null
  pending: boolean
  onConfirm: (choice: ChatDeleteChoice) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [action, setAction] = useState<Action>('delete')
  const [backup, setBackup] = useState(true)
  const [targetId, setTargetId] = useState<number | null>(null)
  const booksQuery = useQuery({ queryKey: OWN_LOREBOOKS_QUERY_KEY, queryFn: listOwnLorebooks, enabled: open && book !== null })
  const targets = useMemo(() => (booksQuery.data ?? []).filter((item) => item.kind === 'account'), [booksQuery.data])
  const backupDate = chatBackupDate()

  useEffect(() => {
    if (open) {
      setAction('delete')
      setBackup(true)
    }
  }, [open])
  useEffect(() => {
    setTargetId((current) => (current !== null && targets.some((item) => item.id === current) ? current : targets[0]?.id ?? null))
  }, [targets])

  const entries = book?.entries.length ?? 0
  const files = book?.entries.filter((entry) => entry.file).length ?? 0
  const radio = (checked: boolean, select: () => void, label: string, extra?: ReactNode, disabled?: boolean, trailing?: ReactNode) => (
    <div
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled}
      tabIndex={checked ? 0 : -1}
      onClick={() => !disabled && select()}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !disabled) { event.preventDefault(); select() }
      }}
      className={cn(
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        checked ? 'border-primary/60' : 'border-line',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span aria-hidden className={cn('size-3.5 shrink-0 rounded-full border-[1.5px]', checked ? 'border-primary bg-primary shadow-[inset_0_0_0_2.5px_var(--background)]' : 'border-muted-foreground/60')} />
      <span className="min-w-0 flex-1">{label}{extra}</span>
      {trailing}
    </div>
  )
  const choice = (value: Action, label: string, extra?: ReactNode, disabled?: boolean, trailing?: ReactNode) => radio(action === value, () => setAction(value), label, extra, disabled, trailing)
  const withBook = count === 1 && book !== null && book.entries.length > 0

  return (
    <Modal open={open} onClose={onClose} title={count > 1 ? t({ ko: '채팅 {count}개를 지울까?', en: 'Delete {count} chats?' }, { count }) : t({ ko: '채팅을 지울까?', en: 'Delete this chat?' })} widthClassName="max-w-md">
      <ModalBody>
        <div role="radiogroup" aria-label={t({ ko: '백업', en: 'Backup' })} className="flex flex-col gap-1.5">
          {radio(backup, () => setBackup(true), t({ ko: '백업하고 지우기', en: 'Back up, then delete' }), <span className="block truncate font-mono text-xs text-muted-foreground">{t({ ko: '파일 보관함', en: 'Files' })}/{CHAT_BACKUP_FOLDER}/{backupDate}</span>)}
          {radio(!backup, () => setBackup(false), t({ ko: '그냥 지우기', en: 'Just delete' }))}
        </div>
        {withBook ? <>
        <p className="text-sm text-muted-foreground">
          {files > 0
            ? t({ ko: '로어북 항목 {entries} · 자료 {files}', en: 'Lorebook: {entries} entries · {files} files' }, { entries, files })
            : t({ ko: '로어북 항목 {entries}', en: 'Lorebook: {entries} entries' }, { entries })}
        </p>
        <div role="radiogroup" aria-label={t({ ko: '채팅 로어북', en: 'Chat lorebook' })} className="flex flex-col gap-1.5">
          {choice('delete', t({ ko: '같이 지우기', en: 'Delete it too' }))}
          {choice('keep', t({ ko: '계정 로어북으로 보관', en: 'Keep as an account lorebook' }), book ? <span className="block truncate font-mono text-xs text-muted-foreground">로어북/{book.name}</span> : null)}
          {choice('merge', t({ ko: '계정 로어북에 병합', en: 'Merge into an account lorebook' }), undefined, targets.length === 0, targets.length > 0 ? (
            <Select className="h-8 w-36" value={targetId === null ? '' : String(targetId)} onChange={(event) => { setTargetId(Number(event.target.value)); setAction('merge') }} aria-label={t({ ko: '병합할 계정 로어북', en: 'Account lorebook to merge into' })}>
              {targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          ) : null)}
        </div>
        </> : null}
        <p className="text-xs text-muted-foreground">{t({ ko: '되돌릴 수 없어. 생성 이미지는 라이브러리에 남아.', en: 'This cannot be undone. Generated images stay in the library.' })}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending || (withBook && action === 'merge' && targetId === null)}
          onClick={() => onConfirm({
            ...(withBook ? { lorebook: action === 'merge' ? { action, targetId: targetId as number } : { action } } : {}),
            ...(backup ? { backupDate } : {}),
          })}
        >
          {pending ? <Spinner className="size-3.5" /> : null}
          {t({ ko: '지우기', en: 'Delete' })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
