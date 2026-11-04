import type { useI18n } from '@/i18n'
import type { ChatProfile, ModelSlot } from '@/lib/api-codex-chat'

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
