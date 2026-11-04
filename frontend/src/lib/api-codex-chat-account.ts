// Per-account chat settings: model slots and routes, user profiles, flags and appearance.
// Lower layer than api-codex-chat.ts, which re-exports this file: import only from api-codex-chat-core and the modules before this one, never from api-codex-chat.ts.

import { requestApiData } from '@/lib/api-request'
import { JSON_HEADERS } from './api-codex-chat-core'

export const MODEL_SLOTS_QUERY_KEY = ['codex-chat-model-slots'] as const
export const MODEL_USAGE_QUERY_KEY = ['codex-chat-model-usage'] as const

export type ModelRole = 'chat' | 'summary' | 'translation' | 'suggest'

/** What a profile uses a model row for: one of its roles, or its judge. */
export type ModelUseRole = ModelRole | 'judge'

/** The built-in representative models, one per part. */
export type ModelRouteKey = ModelUseRole

/**
 * One model an LLM connection serves (`kind: 'model'`, listed under its connection in Settings → LLM) or a
 * representative model (`kind: 'route'`, 대표모델) that points at one. Profiles, judge presets, user profiles and chats
 * reference rows of either kind by id, so changing a row's model, or where a representative model points, reaches all
 * of them. The list comes routes first.
 */
export interface ModelSlot {
  id: number
  kind: 'model' | 'route'
  /** Routes: the connection of the model it reaches ('' for none). */
  providerName: string
  providerLabel: string
  /** Null when the connection is gone, or a route reaches no model. */
  providerType: string | null
  /** Routes: the model it reaches ('' for none). */
  model: string
  /** `connection · model`, or `대표 · name` for a route */
  label: string
  /** The built-in chat route: what a chat role with no model of its own uses, and where new profiles start. */
  isDefault: boolean
  /** The built-in judge route: what a judge, board evaluation or topic relevance with no model of its own asks. */
  isDefaultJudge: boolean
  sortOrder: number
  /** Routes: the built-in part, null for a named one. */
  routeKey: ModelRouteKey | null
  routeName: string | null
  /** Routes: the model row it points at; null for none. */
  targetSlotId: number | null
  /** Routes: no target of its own (summary / suggestions), so it follows the chat model. */
  followsChat: boolean
  /** Built-in routes: the part's default prompt ('' keeps the built-in text). */
  prompt: string
  /** Model rows: the routes pointing at it. */
  routes: Array<{ id: number; name: string; key: ModelRouteKey | null }>
  /** The highest rating tier (id) of media this model is shown; null: no ceiling. A route: null follows its target's, ROUTE_NO_CEILING is none. */
  contentRatingTierId: number | null
  profiles: Array<{ id: number; name: string; roles: ModelUseRole[] }>
  judgePresets: Array<{ id: number; name: string }>
  contentEvaluations?: number
  userProfiles: number
  chats: number
  createdDate: string
  updatedDate: string
  /** Read-only: its connection can be used. */
  ready?: boolean
  /** Read-only: profiles that send their reply and a per-turn helper (judge, translation) to this row's connection. */
  sharedServer?: Array<{ id: number; name: string; roles: Array<'judge' | 'translation'> }>
}

export interface ModelUsage {
  /** Saved workflow LLM nodes per row (through the profile they chat as). */
  slots: Array<{ id: number; workflowNodes: number }>
}

export function listModelSlots() {
  return requestApiData<ModelSlot[]>('/api/codex-chat/admin/model-slots')
}

/** Sets a connection's models to exactly `models`, in order; a model still in use is never dropped (the call fails instead). */
export function syncConnectionModels(providerName: string, models: string[]) {
  return requestApiData<ModelSlot[]>(`/api/codex-chat/admin/connections/${encodeURIComponent(providerName)}/models`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ models }) })
}

/** Changes a row's model; everything that references the row follows. */
export function updateModelSlot(slotId: number, patch: { model?: string; isDefault?: boolean; contentRatingTierId?: number | null }) {
  return requestApiData<ModelSlot>(`/api/codex-chat/admin/model-slots/${slotId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

/** A representative model's own "no ceiling" (null on one follows its target's). */
export const ROUTE_NO_CEILING = -1

export type ModelRouteInput = { name?: string; targetSlotId?: number | null; prompt?: string; contentRatingTierId?: number | null }

/** A named representative model pointing at a model row. */
export function createModelRoute(input: ModelRouteInput) {
  return requestApiData<ModelSlot>('/api/codex-chat/admin/model-routes', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** Changes a representative model; everything that picked it follows a new target. Deleting goes through deleteModelSlot. */
export function updateModelRoute(routeId: number, patch: ModelRouteInput) {
  return requestApiData<ModelSlot>(`/api/codex-chat/admin/model-routes/${routeId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteModelSlot(slotId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/model-slots/${slotId}`, { method: 'DELETE' })
}

export function getModelUsage() {
  return requestApiData<ModelUsage>('/api/codex-chat/admin/model-usage', { cache: 'no-store' })
}

export const CHAT_USER_PROFILES_QUERY_KEY = ['codex-chat-user-profiles'] as const
export const CHAT_USER_PROFILE_LIMITS = { perAccount: 20, name: 30, persona: 4000 }

/** Who the account is in a chat: the name the models use for the user, a description for them, an avatar. */
export interface ChatUserProfile {
  id: number
  name: string
  persona: string
  avatar: string | null
  /** New chats take this profile without asking. */
  isDefault: boolean
  sortOrder: number
  /** The model (a model row) this profile writes reply suggestions with when a chat profile links it; null: none. */
  modelSlotId: number | null
  /** Read-only: the model is set and its connection works. */
  modelReady?: boolean
}

/** `modelSlotId` left out keeps the model the profile had. */
export type ChatUserProfileInput = Pick<ChatUserProfile, 'name' | 'persona' | 'avatar' | 'isDefault'> & { modelSlotId?: number | null }

/** A model any chat user can give a user profile: an LLM model row or a representative model, and whether it works. */
export interface ChatModelOption {
  id: number
  kind: 'model' | 'route'
  routeKey: ModelRouteKey | null
  providerName: string
  providerLabel: string
  /** `connection · model` */
  label: string
  model: string
  ready: boolean
}

export const CHAT_MODEL_OPTIONS_QUERY_KEY = ['codex-chat-model-options'] as const

export function listChatModelOptions() {
  return requestApiData<ChatModelOption[]>('/api/codex-chat/model-options')
}

export function listChatUserProfiles() {
  return requestApiData<ChatUserProfile[]>('/api/codex-chat/user-profiles')
}

export function createChatUserProfile(input: ChatUserProfileInput) {
  return requestApiData<ChatUserProfile>('/api/codex-chat/user-profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateChatUserProfile(userProfileId: number, input: ChatUserProfileInput) {
  return requestApiData<ChatUserProfile>(`/api/codex-chat/user-profiles/${userProfileId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function deleteChatUserProfile(userProfileId: number) {
  return requestApiData<unknown>(`/api/codex-chat/user-profiles/${userProfileId}`, { method: 'DELETE' })
}

export const CHAT_FLAGS_QUERY_KEY = ['codex-chat-flags'] as const
export const CHAT_FLAG_LIMITS = { perAccount: 20, name: 30, content: 2000 }

/** An instruction switched on per chat and added to the messages sent while on: the account's own, or an admin's (shared). */
export interface ChatFlag {
  id: number
  /** `lucide:<name>` for a built-in icon, otherwise an emoji; empty shows the name's first letter. */
  icon: string
  name: string
  content: string
  sortOrder: number
  /** An admin's flag, shown to every account. */
  shared: boolean
  /** Shared flag whose text this account changed (its own copy). */
  edited: boolean
  /** Shared flag this account hid: not in the tray, listed where flags are managed. */
  hidden: boolean
}

export type ChatFlagInput = Pick<ChatFlag, 'icon' | 'name' | 'content'>
/**
 * `pick`: not a flag but an item chosen in the status panel, sent with that message. `choice`: a pick that answers
 * the chat's question card of that id.
 */
export type ChatFlagSnapshot = Pick<ChatFlag, 'id' | 'icon' | 'name' | 'content'> & { pick?: true; choice?: { id: number; question: string }; order?: ChatOrderKind }

/** One tool job ordered from a character's reply (its bar): drawing the scene, saving lore… done on that reply (runChatOrder). */
export type ChatOrderKind = 'image' | 'redraw' | 'audio' | 'lore' | 'choices'

/** In bar order. */
export const CHAT_ORDERS: Array<{ kind: ChatOrderKind; label: { ko: string; en: string } }> = [
  { kind: 'image', label: { ko: '이 장면 그리기', en: 'Draw this scene' } },
  { kind: 'redraw', label: { ko: '이미지 다시 그리기', en: 'Draw the image again' } },
  { kind: 'audio', label: { ko: '목소리·소리 만들기', en: 'Make voice or sound' } },
  { kind: 'lore', label: { ko: '로어로 남기기', en: 'Save as lore' } },
  { kind: 'choices', label: { ko: '다음 선택지 만들기', en: 'Offer next choices' } },
]

/** The snapshot a status panel pick becomes (what the server stores on the message). */
export function pickSnapshot(label: string): ChatFlagSnapshot {
  return { id: 0, icon: 'lucide:target', name: label, content: label, pick: true }
}

/** The snapshot an answer to a question card becomes. */
export function choiceSnapshot(label: string, choice: { id: number; question: string }): ChatFlagSnapshot {
  return { id: 0, icon: 'lucide:list-checks', name: label, content: label, pick: true, choice }
}

/** Every flag the account sees, hidden shared ones included (the tray leaves those out). */
export function listChatFlags() {
  return requestApiData<ChatFlag[]>('/api/codex-chat/flags?all=1')
}

export function createChatFlag(input: ChatFlagInput) {
  return requestApiData<ChatFlag>('/api/codex-chat/flags', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateChatFlag(flagId: number, input: ChatFlagInput) {
  return requestApiData<ChatFlag>(`/api/codex-chat/flags/${flagId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function deleteChatFlag(flagId: number) {
  return requestApiData<unknown>(`/api/codex-chat/flags/${flagId}`, { method: 'DELETE' })
}

/** A hidden shared flag back in the tray. */
export function restoreChatFlag(flagId: number) {
  return requestApiData<ChatFlag>(`/api/codex-chat/flags/${flagId}/restore`, { method: 'POST' })
}

/** A shared flag back to the admin's text. */
export function resetChatFlag(flagId: number) {
  return requestApiData<ChatFlag>(`/api/codex-chat/flags/${flagId}/reset`, { method: 'POST' })
}

export function reorderChatFlags(ids: number[]) {
  return requestApiData<ChatFlag[]>('/api/codex-chat/flags/order', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ids }) })
}

export function setChatThreadFlags(threadId: number, flagIds: number[]) {
  return requestApiData<{ flagIds: number[] }>(`/api/codex-chat/threads/${threadId}/flags`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ flagIds }) })
}

export const CHAT_APPEARANCE_QUERY_KEY = ['codex-chat-appearance'] as const
export const CHAT_APPEARANCE_LIMITS = { slots: 12, name: 20 }

/** A reader's chat appearance values, opaque to the server (flat scalars; the chat feature gives them meaning). */
export type ChatAppearanceValue = Record<string, string | number | boolean | null>
export interface ChatAppearanceSlot {
  id: number
  name: string
  appearance: ChatAppearanceValue
}
/** One account's appearance file: slots to apply quickly, the slot new chats start from, and each chat's own values. */
export interface ChatAppearanceFile {
  defaultSlotId: number | null
  slots: ChatAppearanceSlot[]
  threads: Record<string, ChatAppearanceValue>
}

export function getChatAppearance() {
  return requestApiData<ChatAppearanceFile>('/api/codex-chat/appearance')
}

export function saveChatAppearanceSlots(input: { defaultSlotId: number | null; slots: ChatAppearanceSlot[] }) {
  return requestApiData<{ defaultSlotId: number | null; slots: ChatAppearanceSlot[] }>('/api/codex-chat/appearance/slots', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function setChatThreadAppearance(threadId: number, appearance: ChatAppearanceValue | null) {
  return requestApiData<{ appearance: ChatAppearanceValue | null }>(`/api/codex-chat/threads/${threadId}/appearance`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ appearance }) })
}
