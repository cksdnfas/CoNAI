import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  OWN_LOREBOOKS_QUERY_KEY,
  createChatLorebook,
  createOwnLorebook,
  deleteChatLorebook,
  deleteOwnLorebook,
  updateChatLorebook,
  updateOwnLorebook,
  type ChatLoreEntry,
  type ChatLorebook,
  type OwnedChatLorebook,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatLorebookEditor, newLoreEntry } from './chat-profile-lorebook'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'

/**
 * Create or edit one lorebook: a shared (global) one, or with `kind: 'account'` one of the signed-in account's own
 * (a 로어북/ folder in its file store). Saving reaches every profile that links it.
 */
export function ChatLorebookEditorModal({ open, lorebook, kind = 'global', onClose, onUpdateFromFile, updating }: {
  open: boolean
  lorebook: ChatLorebook | OwnedChatLorebook | null
  /** What a new book becomes; an existing book keeps its own kind. */
  kind?: 'global' | 'account'
  onClose: () => void
  /** Pick a file to refresh the opened book (only offered when editing an existing one). */
  onUpdateFromFile?: (lorebook: ChatLorebook) => void
  updating?: boolean
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<ChatLoreEntry[]>([])
  const owned = (lorebook?.kind ?? kind) !== 'global'
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const folderId = lorebook && 'folderId' in lorebook ? lorebook.folderId : null

  useEffect(() => {
    if (open) {
      setName(lorebook?.name ?? '')
      setEntries(lorebook?.entries ?? [])
    }
  }, [lorebook, open])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: OWN_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => owned
      ? (lorebook ? updateOwnLorebook(lorebook.id, { name, entries }) : createOwnLorebook({ name, entries }))
      : (lorebook ? updateChatLorebook(lorebook.id, { name, entries }) : createChatLorebook({ name, entries })),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => (owned ? deleteOwnLorebook(lorebook?.id ?? 0) : deleteChatLorebook(lorebook?.id ?? 0)),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const dirty = name !== (lorebook?.name ?? '') || JSON.stringify(entries) !== JSON.stringify(lorebook?.entries ?? [])
  // A connected chat reads the book, adds or replaces entries (draft) and asks to save it with a card.
  useSettingsEditorChatPage({
    open,
    title: lorebook ? t({ ko: '로어북 편집 · {name}', en: 'Edit lorebook · {name}' }, { name: lorebook.name }) : t({ ko: '로어북 추가', en: 'Add lorebook' }),
    resourceId: `lorebook:${lorebook?.id ?? 'new'}`,
    dirty,
    fields: [{ id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: name }],
    data: {
      kind: owned ? 'account' : 'global',
      entries: entries.slice(0, 200).map((entry) => ({ title: entry.title ?? '', keys: entry.keys, content: entry.content.slice(0, 2000), enabled: entry.enabled, constant: entry.constant })),
      selected: { name, entries: entries.length },
    },
    apply: (patch) => { if (patch.name !== undefined) setName(String(patch.name)) },
    actions: [pageAction('lorebook.entries', t({ ko: '로어북 항목 채우기', en: 'Fill lorebook entries' }), t({ ko: '항목을 뒤에 더하거나(append) 전부 바꿔(replace). 저장하지 않아. keys는 이 단어가 대화에 나오면 content가 들어가는 키워드, constant는 항상 넣기.', en: 'Append entries or replace them all; nothing is saved. keys trigger the content when they appear in the chat; constant always includes it.' }), pageObject({
      mode: pageChoice(['append', 'replace']),
      entries: pageArray(pageObject({ title: pageText(120), keys: pageArray(pageText(100), 20), content: pageText(8000), constant: { type: 'boolean' }, enabled: { type: 'boolean' } }, ['keys', 'content']), 50, 1),
    }, ['mode', 'entries']))],
    applyAction: (id, args) => {
      if (id !== 'lorebook.entries' || !Array.isArray(args.entries)) throw new Error('로어북 편집기에 없는 작업이야.')
      const before = entriesRef.current
      const base = args.mode === 'replace' ? [] : before
      const added = args.entries.map((raw, index) => {
        const entry = raw as { title?: string; keys: string[]; content: string; constant?: boolean; enabled?: boolean }
        return { ...newLoreEntry(base.length + index), title: entry.title ?? '', keys: entry.keys, content: entry.content, constant: entry.constant === true, enabled: entry.enabled !== false }
      })
      const next = [...base, ...added]
      setEntries(next)
      return { isCurrent: () => entriesRef.current === next, restore: () => setEntries(before) }
    },
    save: () => saveMutation.mutateAsync(),
  })

  const handleDelete = async () => {
    const linked = lorebook?.profiles.length ?? 0
    const confirmed = await confirm({
      title: t({ ko: '로어북 삭제', en: 'Delete lorebook' }),
      description: linked > 0
        ? t({ ko: '프로필 {count}개에서 쓰는 중이야. 지우면 연결도 같이 풀려.', en: 'Used by {count} profiles. Deleting also unlinks it from them.' }, { count: linked })
        : t({ ko: '이 로어북을 지울까?', en: 'Delete this lorebook?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const canSave = Boolean(name.trim()) && !saveMutation.isPending && (dirty || !lorebook)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={lorebook ? t({ ko: '로어북 편집', en: 'Edit lorebook' }) : owned ? t({ ko: '계정 로어북 추가', en: 'Add account lorebook' }) : t({ ko: '로어북 추가', en: 'Add lorebook' })}
      size="normal"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
      dirty={dirty}
      onSave={canSave ? () => saveMutation.mutate() : undefined}
    >
      <ModalBody className="space-y-4">
        <Field label={<ChatFilledLabel fieldId="name">{t({ ko: '이름', en: 'Name' })}</ChatFilledLabel>}>
          <Input variant="settings" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <ChatLorebookEditor entries={entries} onChange={setEntries} filePlace={owned ? { kind: 'owned', folderId } : { kind: 'global' }} />
      </ModalBody>
      <EditorFooter
        onDelete={lorebook ? () => void handleDelete() : undefined}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={canSave}
        saving={saveMutation.isPending}
      >
        {lorebook && onUpdateFromFile && !owned ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onUpdateFromFile(lorebook)} disabled={updating} label={t({ ko: '파일로 업데이트', en: 'Update from file' })}>
            <RefreshCw />
          </IconButton>
        ) : null}
      </EditorFooter>
    </Modal>
  )
}
