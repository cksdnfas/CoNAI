import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { ChatProfile } from './chatProfiles'
import { ChatProfileError } from './chatProfileError'
import { modelLabelOf, type ModelRoleProfile } from './chatModelRoles'
import { ModelSlotStore } from './modelSlots'
import { getClaudeModels } from '../claudeCli'

type ModelOverride = { chat_model_slot_id: number | null; chat_model: string | null }
type ModelThread = ModelOverride & { id: number; kind: string; profile_id: number | null }
export type ChatModelPatch = { chatModelSlotId?: number | null; chatModel?: string | null }
const overridden = Symbol('chatModelOverride')

export function chatModelOptions() {
  return ModelSlotStore.list({ usage: false }).filter(slot => slot.providerType !== 'decision_typesafe')
}

/** Call only after a successful save; catalog discovery must not delay that save or a turn. */
export function warmClaudeChatModel(profileId: number | null, patch: ChatModelPatch) {
  if (patch.chatModel && profileId !== null
    && getUserSettingsDb().prepare("SELECT 1 FROM llm_chat_profiles WHERE id = ? AND engine = 'claude'").get(profileId)) {
    void getClaudeModels()
  }
}

/** Only chat callers supply a thread; profile reads elsewhere retain their original meaning. */
export function applyChatModelOverride<T extends ModelRoleProfile & { id: number }>(thread: number | ModelThread, profile: T): T {
  const db = getUserSettingsDb()
  const room = typeof thread === 'number'
    ? db.prepare('SELECT id, kind, profile_id, chat_model_slot_id, chat_model FROM codex_chat_threads WHERE id = ?').get(thread) as ModelThread | undefined
    : thread
  if (!room) return profile
  const setting = room.kind === 'group'
    ? db.prepare('SELECT chat_model_slot_id, chat_model FROM chat_group_members WHERE thread_id = ? AND profile_id = ?').get(room.id, profile.id) as ModelOverride | undefined
    : room.profile_id === profile.id ? room : undefined
  if (!setting) return profile
  if (profile.engine === 'llm' && setting.chat_model_slot_id != null && ModelSlotStore.target(setting.chat_model_slot_id)) {
    return { ...profile, modelSlotId: setting.chat_model_slot_id, [overridden]: true }
  }
  if ((profile.engine === 'claude' || profile.engine === 'codex') && setting.chat_model) {
    return { ...profile, model: setting.chat_model, [overridden]: true }
  }
  return profile
}

export function hasChatModelOverride(profile: ModelRoleProfile): boolean {
  return (profile as { [overridden]?: boolean })[overridden] === true
}

export function chatModelLabel(profile: ModelRoleProfile | null): string | null {
  return profile && hasChatModelOverride(profile) ? modelLabelOf(profile) : null
}

/** Decorate raw records without loading prompts, assets or a transcript. */
export function withChatModelLabel<T extends ModelThread>(thread: T): T & { chat_model_label: string | null } {
  const row = thread.kind === 'direct' && thread.profile_id != null && (thread.chat_model_slot_id != null || thread.chat_model)
    ? getUserSettingsDb().prepare('SELECT id, engine, model, model_slot_id AS modelSlotId FROM llm_chat_profiles WHERE id = ?').get(thread.profile_id) as (ModelRoleProfile & { id: number }) | undefined
    : undefined
  return { ...thread, chat_model_label: row ? chatModelLabel(applyChatModelOverride(thread, row)) : null }
}

export function validateChatModelPatch(profile: ChatProfile | null, input: { chatModelSlotId?: unknown; chatModel?: unknown }): ChatModelPatch {
  const patch: ChatModelPatch = {}
  if (input.chatModelSlotId !== undefined) {
    const value = input.chatModelSlotId === '' ? null : input.chatModelSlotId
    if (value !== null && profile?.engine !== 'llm') throw new ChatProfileError('이 프로필은 모델 슬롯 대신 대화 모델을 골라줘.')
    if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0
      || !chatModelOptions().some(slot => slot.id === value))) {
      throw new ChatProfileError('대화 모델 슬롯을 다시 골라줘.')
    }
    patch.chatModelSlotId = value as number | null
  }
  if (input.chatModel !== undefined) {
    if (input.chatModel !== null && (typeof input.chatModel !== 'string' || input.chatModel.trim().length > 200)) {
      throw new ChatProfileError('대화 모델은 200자 이내의 이름으로 입력해줘.')
    }
    patch.chatModel = typeof input.chatModel === 'string' ? input.chatModel.trim() || null : null
    if (patch.chatModel !== null && profile?.engine !== 'claude' && profile?.engine !== 'codex') throw new ChatProfileError('API LLM 프로필은 대화 모델 슬롯을 골라줘.')
  }
  return patch
}
