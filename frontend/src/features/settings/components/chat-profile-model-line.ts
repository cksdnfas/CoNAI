import type { useI18n } from '@/i18n'
import type { ChatProfile, ModelSlot, ModelUseRole } from '@/lib/api-codex-chat'

const REMOVED_ROLE_NOTICES: Record<ModelUseRole, { ko: string; en: string }> = {
  chat: { ko: '대화 모델이 삭제돼서 프로필이 꺼졌어.', en: 'The chat model was deleted, so the profile is off.' },
  summary: { ko: '요약 모델이 삭제돼서 요약 기능이 꺼졌어.', en: 'The summary model was deleted, so summaries are off.' },
  translation: { ko: '번역 모델이 삭제돼서 번역 기능이 꺼졌어.', en: 'The translation model was deleted, so translation is off.' },
  suggest: { ko: '답장 추천 모델이 삭제돼서 답장 추천이 꺼졌어.', en: 'The suggestion model was deleted, so reply suggestions are off.' },
  judge: { ko: '판단 모델이 삭제돼서 판단이 꺼졌어.', en: 'The judge model was deleted, so the judge is off.' },
  reaction: { ko: '완료 반응 모델이 삭제돼서 완료 반응이 꺼졌어.', en: 'The reaction model was deleted, so completion reactions are off.' },
}

/** One line per role whose model was deleted and left blank (`removedModelRoles`), the chat model first. */
export function removedModelNotices(roles: readonly ModelUseRole[] | undefined, t: ReturnType<typeof useI18n>['t']) {
  return (Object.keys(REMOVED_ROLE_NOTICES) as ModelUseRole[]).filter((role) => roles?.includes(role)).map((role) => t(REMOVED_ROLE_NOTICES[role]))
}

type ProfileModel = Pick<ChatProfile, 'engine' | 'model' | 'modelSlotId' | 'llmRuntime'>

/** An API LLM profile's model row: its own, else the chat representative model it follows. */
function profileModelRow(profile: ProfileModel, slots: ModelSlot[]) {
  if (profile.engine !== 'llm') return undefined
  return slots.find((item) => item.id === profile.modelSlotId) ?? slots.find((item) => item.isDefault)
}

/** Slot labels already name direct models; routes additionally identify their resolved connection and model. */
export function profileModelLine(profile: ProfileModel, slots: ModelSlot[], t: ReturnType<typeof useI18n>['t']) {
  const slot = profileModelRow(profile, slots)
  const reaches = slot?.kind === 'route' && !(slot.model && slot.label.includes(slot.model))
    ? ` (${slot.model ? `${slot.providerLabel} · ${slot.model}` : t({ ko: '비어 있음', en: 'empty' })})` : ''
  if (slot) return `${profile.modelSlotId == null ? `${t({ ko: '기본 모델', en: 'Default model' })} · ` : ''}${slot.label}${reaches}${profile.llmRuntime === 'pi' ? ' · pi' : ''}`
  if (profile.engine === 'claude') return `Claude Code · ${profile.model || 'sonnet'}`
  if (profile.engine === 'codex') return `Codex · ${profile.model || t({ ko: '기본 모델', en: 'default model' })}`
  return t({ ko: '모델 없음', en: 'No model' })
}

export function profileModelChip(profile: ProfileModel, slots: ModelSlot[]) {
  const slot = profileModelRow(profile, slots)
  if (slot) return slot.model || slot.label
  if (profile.engine === 'claude') return 'Claude Code'
  return profile.engine === 'codex' ? 'Codex' : '—'
}
