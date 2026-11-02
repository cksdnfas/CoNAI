import { useLayoutEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CHAT_SKILL_LIMITS } from '@conai/shared'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_SKILLS_QUERY_KEY,
  createChatSkill,
  deleteChatSkill,
  updateChatSkill,
  type ChatSkill,
  type ChatSkillInput,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { CHAT_DOCK_INSET } from './use-settings-editor-chat-page'

const EMPTY: ChatSkillInput = { name: '', description: '', instructions: '' }

/**
 * Create or edit one shared skill: its name, when to use it (all the chat model sees until it loads the skill) and
 * the instructions use_skill returns. Saving reaches every profile that links it; `onSaved` hands the skill back.
 */
export function ChatSkillEditorModal({ open, skill, initial, onClose, onSaved }: {
  open: boolean
  skill: ChatSkill | null
  /** Starting values for a new skill (a proposal opened in the editor). */
  initial?: ChatSkillInput
  onClose: () => void
  onSaved?: (skill: ChatSkill) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ChatSkillInput>(EMPTY)
  const saved = useMemo<ChatSkillInput>(() => (skill ? { name: skill.name, description: skill.description, instructions: skill.instructions } : initial ?? EMPTY), [initial, skill])

  useLayoutEffect(() => {
    if (open) setDraft(saved)
  }, [open, saved])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_SKILLS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (skill ? updateChatSkill(skill.id, draft) : createChatSkill(draft)),
    onSuccess: async (result) => {
      await refresh()
      onSaved?.(result)
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatSkill(skill?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t({ ko: '스킬 삭제', en: 'Delete skill' }),
      description: skill && skill.profiles.length > 0
        ? t({ ko: '이 스킬을 지우면 연결한 프로필 {count}개에서도 빠져.', en: 'Deleting this skill also unlinks it from {count} profiles.' }, { count: skill.profiles.length })
        : t({ ko: '이 스킬을 지울까?', en: 'Delete this skill?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const filled = draft.name.trim() !== '' && draft.description.trim() !== '' && draft.instructions.trim() !== ''
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const canSave = filled && !saveMutation.isPending && (dirty || !skill)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={skill ? t({ ko: '스킬 편집', en: 'Edit skill' }) : t({ ko: '스킬 추가', en: 'Add skill' })}
      size="lg"
      height="tall"
      sidePanelInset={CHAT_DOCK_INSET}
      dirty={dirty}
      onSave={canSave ? () => saveMutation.mutate() : undefined}
    >
      <ModalBody>
        <Field label={t({ ko: '이름', en: 'Name' })} info={t({ ko: '모델이 use_skill을 부를 때 쓰는 이름이야. 짧고 겹치지 않게.', en: 'The name the model passes to use_skill. Keep it short and unique.' })}>
          <Input variant="settings" value={draft.name} maxLength={CHAT_SKILL_LIMITS.name} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label={t({ ko: '언제 쓰는지', en: 'When to use' })} info={t({ ko: '모델은 스킬을 불러오기 전까지 이름과 이 설명만 봐. "Use when …"처럼 어떤 요청에 쓰는지 구체적으로 적어줘.', en: 'Until it loads the skill, the model sees only the name and this text. Say which requests it is for, e.g. "Use when …".' })}>
          <Textarea variant="settings" rows={2} value={draft.description} maxLength={CHAT_SKILL_LIMITS.description} placeholder="Use when the user asks for …" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </Field>
        <Field label={t({ ko: '지시', en: 'Instructions' })} info={t({ ko: 'use_skill이 돌려주는 본문이야. 따를 단계와 규칙을 번호 매긴 명령문으로 적으면 작은 모델도 잘 따라. {{char}}·{{user}}는 이름으로 바뀌어.', en: 'What use_skill returns. Numbered, direct steps and rules work best, even for small models. {{char}} and {{user}} become the names.' })}>
          <Textarea variant="settings" rows={14} value={draft.instructions} maxLength={CHAT_SKILL_LIMITS.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
        </Field>
        {skill && skill.profiles.length > 0 ? (
          <p className="text-xs text-muted-foreground">{t({ ko: '연결한 프로필: {names}', en: 'Linked profiles: {names}' }, { names: skill.profiles.map((profile) => profile.name).join(', ') })}</p>
        ) : null}
      </ModalBody>
      <EditorFooter
        onDelete={skill ? () => void handleDelete() : undefined}
        deleting={deleteMutation.isPending}
        onSave={() => saveMutation.mutate()}
        canSave={canSave}
        saving={saveMutation.isPending}
      />
    </Modal>
  )
}
