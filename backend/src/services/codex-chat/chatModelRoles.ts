import type { ChatProfileEngine } from './chatProfiles'
import { ModelSlotStore, type ModelRole, type ModelTarget } from './modelSlots'
import { CLAUDE_CHAT_PROVIDER } from './claudeChatCompletion'

/**
 * Where a role's model comes from: `slot` (the role's model row), `inherit` (summary / suggestions borrowing the chat
 * role's model), `default` (the default row, for a chat role with nothing set), `engine` (Claude Code's own model).
 */
export type ResolvedModel = {
  providerName: string
  model: string
  via: 'slot' | 'inherit' | 'default' | 'engine'
  slotId: number | null
  /** `connection · model`, or the engine's name for Claude Code. */
  label: string
}

/** The profile fields model resolution reads; all optional so a partial profile (a test double, a draft) works. */
export type ModelRoleProfile = {
  engine?: ChatProfileEngine
  /** Codex / Claude Code: the engine's own model. */
  model?: string
  modelSlotId?: number | null
  summarySlotId?: number | null
  translationSlotId?: number | null
  suggestSlotId?: number | null
}

function slotIdOf(profile: ModelRoleProfile, role: ModelRole) {
  switch (role) {
    case 'chat': return profile.modelSlotId
    case 'summary': return profile.summarySlotId
    case 'translation': return profile.translationSlotId
    case 'suggest': return profile.suggestSlotId
  }
}

function fromTarget(target: ModelTarget, via: ResolvedModel['via']): ResolvedModel {
  return { providerName: target.providerName, model: target.model, via, slotId: target.id, label: target.label }
}

function resolveChat(profile: ModelRoleProfile): ResolvedModel | null {
  if (profile.engine === 'claude') {
    const model = profile.model || 'sonnet'
    return { providerName: CLAUDE_CHAT_PROVIDER, model, via: 'engine', slotId: null, label: `Claude Code · ${model}` }
  }
  if (profile.engine === 'codex') return null
  const slot = ModelSlotStore.target(profile.modelSlotId)
  if (slot) return fromTarget(slot, 'slot')
  const fallback = ModelSlotStore.defaultTarget()
  return fallback ? fromTarget(fallback, 'default') : null
}

/**
 * The connection + model a profile uses for a role, or null when the role is off or has nothing to call.
 * The role's own row wins; without one, summary and suggestions borrow the chat role's model (API LLM / Claude
 * profiles), translation is off, and the chat role uses the default row. A Codex profile has no chat connection.
 * A row id that no longer exists counts as unset.
 */
export function resolveProfileModel(profile: ModelRoleProfile, role: ModelRole): ResolvedModel | null {
  if (role === 'chat') return resolveChat(profile)
  const slot = ModelSlotStore.target(slotIdOf(profile, role))
  if (slot) return fromTarget(slot, 'slot')
  if (role === 'translation' || profile.engine === 'codex') return null
  const chat = resolveChat(profile)
  return chat ? { ...chat, via: 'inherit' } : null
}

/** Whether the profile translates (user messages to English, replies to Korean). */
export function hasTranslation(profile: ModelRoleProfile | null | undefined) {
  return profile ? resolveProfileModel(profile, 'translation') !== null : false
}

/** The model name a chat user sees. */
export function effectiveModelOf(profile: ModelRoleProfile): string {
  if (profile.engine === 'codex') return profile.model ?? ''
  return resolveProfileModel(profile, 'chat')?.model ?? ''
}

/** The line the chat UI shows for a profile's model: `connection · model`, `Claude Code · model` or `Codex · model`. */
export function modelLabelOf(profile: ModelRoleProfile): string {
  if (profile.engine === 'codex') return `Codex · ${profile.model || '기본 모델'}`
  return resolveProfileModel(profile, 'chat')?.label ?? ''
}
