import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { OWN_LOREBOOKS_QUERY_KEY, listOwnLorebooks, type OwnedChatLorebook, type ThreadLorebookAction } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'

type Action = ThreadLorebookAction['action']

/**
 * C: deleting a chat whose own lorebook has entries — delete the book with it (default), keep it as an account book,
 * or merge it into one (the merge dialog follows when duplicates need a decision).
 */
export function ChatDeleteDialog({ book, pending, onConfirm, onClose }: {
  /** The chat's book; the dialog is open while it is set. */
  book: OwnedChatLorebook | null
  pending: boolean
  onConfirm: (lorebook: ThreadLorebookAction) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [action, setAction] = useState<Action>('delete')
  const [targetId, setTargetId] = useState<number | null>(null)
  const booksQuery = useQuery({ queryKey: OWN_LOREBOOKS_QUERY_KEY, queryFn: listOwnLorebooks, enabled: book !== null })
  const targets = useMemo(() => (booksQuery.data ?? []).filter((item) => item.kind === 'account'), [booksQuery.data])

  useEffect(() => {
    if (book) setAction('delete')
  }, [book])
  useEffect(() => {
    setTargetId((current) => (current !== null && targets.some((item) => item.id === current) ? current : targets[0]?.id ?? null))
  }, [targets])

  const entries = book?.entries.length ?? 0
  const files = book?.entries.filter((entry) => entry.file).length ?? 0
  const choice = (value: Action, label: string, extra?: ReactNode, disabled?: boolean, trailing?: ReactNode) => (
    <div
      role="radio"
      aria-checked={action === value}
      aria-disabled={disabled}
      tabIndex={action === value ? 0 : -1}
      onClick={() => !disabled && setAction(value)}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !disabled) { event.preventDefault(); setAction(value) }
      }}
      className={cn(
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-sm border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        action === value ? 'border-primary/60' : 'border-line',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span aria-hidden className={cn('size-3.5 shrink-0 rounded-full border-[1.5px]', action === value ? 'border-primary bg-primary shadow-[inset_0_0_0_2.5px_var(--background)]' : 'border-muted-foreground/60')} />
      <span className="min-w-0 flex-1">{label}{extra}</span>
      {trailing}
    </div>
  )

  return (
    <Modal open={book !== null} onClose={onClose} title={t({ ko: '채팅을 지울까?', en: 'Delete this chat?' })} widthClassName="max-w-md">
      <ModalBody>
        <p className="text-sm text-muted-foreground">
          {files > 0
            ? t({ ko: '이 채팅의 로어북에 항목 {entries}개와 자료 {files}개가 있어.', en: 'This chat’s lorebook has {entries} entries and {files} files.' }, { entries, files })
            : t({ ko: '이 채팅의 로어북에 항목 {entries}개가 있어.', en: 'This chat’s lorebook has {entries} entries.' }, { entries })}
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
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={pending || (action === 'merge' && targetId === null)}
          onClick={() => onConfirm(action === 'merge' ? { action, targetId: targetId as number } : { action })}
        >
          {pending ? <Spinner className="size-3.5" /> : null}
          {t({ ko: '지우기', en: 'Delete' })}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
