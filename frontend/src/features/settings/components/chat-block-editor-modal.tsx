import { useLayoutEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Save, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  createChatBlock,
  deleteChatBlock,
  updateChatBlock,
  type ChatDisplayBlock,
  type ChatSharedBlock,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { BLOCK_KEY_PATTERN, ChatBlockEditor, starterBlock } from './chat-block-editor'
import { downloadChatBlockFile } from './chat-block-file'

/** Create or edit one shared display block. Saving reaches every profile that links it. */
export function ChatBlockEditorModal({ open, shared, onClose }: { open: boolean; shared: ChatSharedBlock | null; onClose: () => void }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [block, setBlock] = useState<ChatDisplayBlock>(starterBlock)
  /** Bumped with every open, so the editor (and its field table) mounts on the block being opened, not the last one. */
  const [session, setSession] = useState(0)

  useLayoutEffect(() => {
    if (open) {
      setName(shared?.name ?? '')
      setBlock(shared?.block ?? starterBlock())
      setSession((current) => current + 1)
    }
  }, [shared, open])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_BLOCKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (shared ? updateChatBlock(shared.id, { name, block }) : createChatBlock({ name: name.trim() || block.key, block })),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatBlock(shared?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const handleDelete = async () => {
    const linked = shared?.profiles.length ?? 0
    const confirmed = await confirm({
      title: t({ ko: '표시 블록 삭제', en: 'Delete display block' }),
      description: linked > 0
        ? t({ ko: '프로필 {count}개에서 쓰는 중이야. 지우면 연결도 같이 풀려.', en: 'Used by {count} profiles. Deleting also unlinks it from them.' }, { count: linked })
        : t({ ko: '이 표시 블록을 지울까?', en: 'Delete this display block?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const keyValid = BLOCK_KEY_PATTERN.test(block.key)

  return (
    <Modal open={open} onClose={onClose} title={shared ? t({ ko: '표시 블록 편집', en: 'Edit display block' }) : t({ ko: '표시 블록 추가', en: 'Add display block' })} widthClassName="max-w-4xl">
      <ModalBody className="space-y-4">
        <Field label={t({ ko: '이름', en: 'Name' })} hint={t({ ko: '비우면 블록 이름을 써', en: 'Empty uses the block name' })}>
          <Input variant="settings" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <ChatBlockEditor key={session} block={block} onChange={setBlock} />
      </ModalBody>
      <ModalFooter>
        {shared ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatBlockFile(name.trim() || block.key, block)} disabled={!keyValid} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
          <Download />
        </IconButton>
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={!keyValid || saveMutation.isPending} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}
