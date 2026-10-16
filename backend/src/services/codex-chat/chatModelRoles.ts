import type { ChatProfileEngine } from './chatProfiles'
import { ModelSlotStore, type ModelRole, type ModelTarget } from './modelSlots'
import { CLAUDE_CHAT_PROVIDER } from './claudeChatCompletion'

/**
 * Where a role's model comes from: `slot` (the row the role picked, a model or a representative model), `inherit`
 * (summary / suggestions borrowing the chat role's model), `default` (the part's built-in representative model, for a
 * role with nothing set), `engine` (Claude Code's own model).
 */
export type ResolvedModel = {
  providerName: string
  model: string
  via: 'slot' | 'inherit' | 'default' | 'engine'
  /** The model row reached. */
  slotId: number | null
  /** The representative model it came through, when it did (its content rating ceiling applies). */
  routeId: number | null
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
  return { providerName: target.providerName, model: target.model, via, slotId: target.id, routeId: target.routeId, label: target.label }
}

function resolveChat(profile: ModelRoleProfile): ResolvedModel | null {
  if (profile.engine === 'claude') {
    const model = profile.model || 'sonnet'
    return { providerName: CLAUDE_CHAT_PROVIDER, model, via: 'engine', slotId: null, routeId: null, label: `Claude Code · ${model}` }
  }
  if (profile.engine === 'codex') return null
  const slot = ModelSlotStore.target(profile.modelSlotId)
  if (slot) return fromTarget(slot, 'slot')
  const fallback = ModelSlotStore.defaultTarget()
  return fallback ? fromTarget(fallback, 'default') : null
}

/**
 * The connection + model a profile uses for a role, or null when the role is off or has nothing to call.
 * The role's own row wins (a summary / suggestion representative model without a target follows the chat role);
 * without one, summary and suggestions use their part's representative model, which by default follows the chat
 * role's model (API LLM / Claude profiles); translation is off, and the chat role uses the chat representative model.
 * A Codex profile has no chat connection. A row id that no longer exists counts as unset.
 */
export function resolveProfileModel(profile: ModelRoleProfile, role: ModelRole): ResolvedModel | null {
  if (role === 'chat') return resolveChat(profile)
  const slotId = slotIdOf(profile, role)
  const inherit = () => {
    const chat = resolveChat(profile)
    return chat ? { ...chat, via: 'inherit' as const } : null
  }
  if (ModelSlotStore.followsChat(slotId)) return profile.engine === 'codex' ? null : inherit()
  const slot = ModelSlotStore.target(slotId)
  if (slot) return fromTarget(slot, 'slot')
  if (role === 'translation' || profile.engine === 'codex') return null
  const routeId = ModelSlotStore.routeId(role)
  if (!ModelSlotStore.followsChat(routeId)) {
    const route = ModelSlotStore.target(routeId)
    if (route) return fromTarget(route, 'default')
  }
  return inherit()
}

/** Whether the profile translates (user messages into the model language, replies into the display language). */
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
