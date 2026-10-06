import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../llmGenerationOptions'
import type { ChatProfileEngine } from './chatProfiles'
import { ModelSlotStore, type ModelRole } from './modelSlots'

/**
 * Where a role's model comes from: `slot` (the role's model slot), `direct` (the role's own connection + model),
 * `inherit` (summary / suggestions borrowing the chat role's connection), `default` (the default slot, for a chat role with nothing set).
 */
export type ResolvedModel = {
  providerName: string
  /** Null: the connection's default model applies downstream. */
  model: string | null
  via: 'slot' | 'direct' | 'inherit' | 'default'
  slotId: number | null
  slotName: string | null
}

/** The profile fields model resolution reads; all optional so a partial profile (a test double, a draft) works. */
export type ModelRoleProfile = {
  engine?: ChatProfileEngine
  providerName?: string
  model?: string
  modelSlotId?: number | null
  summaryProviderName?: string | null
  summaryModel?: string
  summarySlotId?: number | null
  translationProviderName?: string | null
  translationModel?: string
  translationSlotId?: number | null
  suggestProviderName?: string | null
  suggestModel?: string
  suggestSlotId?: number | null
}

function directPairOf(profile: ModelRoleProfile, role: ModelRole): { slotId: number | null | undefined; providerName: string; model: string } {
  switch (role) {
    case 'chat': return { slotId: profile.modelSlotId, providerName: profile.providerName ?? '', model: profile.model ?? '' }
    case 'summary': return { slotId: profile.summarySlotId, providerName: profile.summaryProviderName ?? '', model: profile.summaryModel ?? '' }
    case 'translation': return { slotId: profile.translationSlotId, providerName: profile.translationProviderName ?? '', model: profile.translationModel ?? '' }
    case 'suggest': return { slotId: profile.suggestSlotId, providerName: profile.suggestProviderName ?? '', model: profile.suggestModel ?? '' }
  }
}

function resolveChat(profile: ModelRoleProfile): ResolvedModel | null {
  if (profile.engine === 'codex') return null
  const direct = directPairOf(profile, 'chat')
  const slot = ModelSlotStore.target(direct.slotId)
  if (slot) return { providerName: slot.providerName, model: slot.model, via: 'slot', slotId: slot.id, slotName: slot.name }
  if (direct.providerName) return { providerName: direct.providerName, model: direct.model || null, via: 'direct', slotId: null, slotName: null }
  const fallback = ModelSlotStore.defaultTarget()
  return fallback ? { providerName: fallback.providerName, model: fallback.model, via: 'default', slotId: fallback.id, slotName: fallback.name } : null
}

/**
 * The connection + model a profile uses for a role, or null when the role is off or has nothing to call.
 * Precedence: the role's slot, then its direct connection + model; with neither, summary and suggestions borrow the chat
 * role's connection (API LLM profiles; their own model still overrides), translation is off, and the chat role falls
 * back to the default slot. A Codex profile has no chat connection. A slot id that no longer exists counts as unset.
 */
export function resolveProfileModel(profile: ModelRoleProfile, role: ModelRole): ResolvedModel | null {
  if (role === 'chat') return resolveChat(profile)
  const direct = directPairOf(profile, role)
  const slot = ModelSlotStore.target(direct.slotId)
  if (slot) return { providerName: slot.providerName, model: slot.model, via: 'slot', slotId: slot.id, slotName: slot.name }
  if (direct.providerName) return { providerName: direct.providerName, model: direct.model || null, via: 'direct', slotId: null, slotName: null }
  if (role === 'translation' || profile.engine === 'codex') return null
  const chat = resolveChat(profile)
  return chat ? { ...chat, model: direct.model || chat.model, via: 'inherit' } : null
}

/** Whether the profile translates (user messages to English, replies to Korean). */
export function hasTranslation(profile: ModelRoleProfile | null | undefined) {
  return profile ? resolveProfileModel(profile, 'translation') !== null : false
}

/** Whether reply suggestions have a connection to ask (their own, or the chat's). */
export function hasSuggestionModel(profile: ModelRoleProfile) {
  return resolveProfileModel(profile, 'suggest') !== null
}

/** The model name a chat user sees: the resolved model, or the connection's default when the profile leaves it empty. */
export function effectiveModelOf(profile: ModelRoleProfile): string {
  if (profile.engine === 'codex') return profile.model ?? ''
  const resolved = resolveProfileModel(profile, 'chat')
  if (!resolved) return ''
  return resolved.model || readLlmConnectionConfig(ExternalApiProvider.findByName(resolved.providerName)?.additional_config).defaultModel || ''
}

/** The line the chat UI shows for a profile's model: `slot · model`, `connection · model`, or `Codex · model`. */
export function modelLabelOf(profile: ModelRoleProfile): string {
  if (profile.engine === 'codex') return `Codex · ${profile.model || '기본 모델'}`
  const resolved = resolveProfileModel(profile, 'chat')
  if (!resolved) return ''
  const model = effectiveModelOf(profile)
  const head = resolved.slotName ?? ExternalApiProvider.findByName(resolved.providerName)?.display_name ?? resolved.providerName
  return model ? `${head} · ${model}` : head
}
