import { useLayoutEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { CHAT_GENERATION_PRESETS_QUERY_KEY, createChatGenerationPreset, type ChatGenerationPresetInput } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'

/**
 * Save the generation panel's current setup as a chat generation preset: the panel builds the setup, the person names
 * it and says what it is for (the model reads that line to pick a preset). Fields the model fills are chosen afterwards
 * in settings › chat.
 */
export function ChatGenerationPresetSaveModal({ open, build, summary, onClose }: {
  open: boolean
  /** The kind-specific setup to save, built when the person confirms (null aborts with the panel's own message). */
  build: () => Promise<Omit<ChatGenerationPresetInput, 'name' | 'instruction'> | null>
  /** What will be fixed by the preset, shown above the inputs. */
  summary: ReactNode
  onClose: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [instruction, setInstruction] = useState('')

  useLayoutEffect(() => {
    if (open) {
      setName('')
      setInstruction('')
    }
  }, [open])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const setup = await build()
      if (!setup) return null
      return createChatGenerationPreset({ ...setup, name: name.trim(), instruction: instruction.trim() })
    },
    onSuccess: async (created) => {
      if (!created) return
      await queryClient.invalidateQueries({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY })
      showSnackbar({ message: t({ ko: '채팅 생성 프리셋 "{name}"을 저장했어. 설정 › 채팅에서 프로필에 연결해.', en: 'Saved chat generation preset "{name}". Link it to a profile in settings › chat.' }, { name: created.name }), tone: 'info' })
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })

  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '채팅 생성 프리셋으로 저장', en: 'Save as chat generation preset' })} widthClassName="max-w-lg">
      <ModalBody className="space-y-4">
        <div className="text-xs text-muted-foreground">{summary}</div>
        <Field label={t({ ko: '이름', en: 'Name' })}>
          <Input variant="settings" value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t({ ko: '용도 (모델에게 보여줌)', en: 'Purpose (shown to the model)' })} info={t({ ko: '예: 캐릭터 전신 일러스트', en: 'e.g. full-body character art' })}>
          <Input variant="settings" value={instruction} maxLength={400} onChange={(event) => setInstruction(event.target.value)} />
        </Field>
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={name.trim().length === 0 || saveMutation.isPending} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}
