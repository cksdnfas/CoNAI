import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Save, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  createChatLorebook,
  deleteChatLorebook,
  updateChatLorebook,
  type ChatLoreEntry,
  type ChatLorebook,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatLorebookEditor } from './chat-profile-lorebook'

/** Create or edit one shared lorebook. Saving reaches every profile that links it. */
export function ChatLorebookEditorModal({ open, lorebook, onClose, onUpdateFromFile, updating }: {
  open: boolean
  lorebook: ChatLorebook | null
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

  useEffect(() => {
    if (open) {
      setName(lorebook?.name ?? '')
      setEntries(lorebook?.entries ?? [])
    }
  }, [lorebook, open])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (lorebook ? updateChatLorebook(lorebook.id, { name, entries }) : createChatLorebook({ name, entries })),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatLorebook(lorebook?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
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

  return (
    <Modal open={open} onClose={onClose} title={lorebook ? t({ ko: '로어북 편집', en: 'Edit lorebook' }) : t({ ko: '로어북 추가', en: 'Add lorebook' })} widthClassName="max-w-3xl">
      <ModalBody className="space-y-4">
        <Field label={t({ ko: '이름', en: 'Name' })}>
          <Input variant="settings" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <ChatLorebookEditor entries={entries} onChange={setEntries} />
      </ModalBody>
      <ModalFooter>
        {lorebook ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        {lorebook && onUpdateFromFile ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onUpdateFromFile(lorebook)} disabled={updating} label={t({ ko: '파일로 업데이트', en: 'Update from file' })}>
            <RefreshCw />
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}
