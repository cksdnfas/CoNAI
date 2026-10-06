import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { CodexChatThreadRecord } from './codexChatStore'
import { ModelSlotStore } from './modelSlots'

/**
 * User profiles (personas): who the account is in a chat — a name the models address and see in transcripts, a
 * description that goes into every member's instructions, and an avatar on the account's own messages. An account
 * keeps several and picks one per chat; without one a chat uses the plain `사용자`.
 */

export const CHAT_USER_PROFILE_LIMITS = { perAccount: 20, name: 30, persona: 4000 }
const AVATAR_MAX_LENGTH = 300_000
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

/** What a chat shows and sends as the user when no profile is attached. */
export const DEFAULT_USER_NAME = '사용자'

export type ChatUserProfile = {
  id: number
  name: string
  persona: string
  avatar: string | null
  /** New chats pick this profile without asking. */
  isDefault: boolean
  sortOrder: number
  /** The model (llm_model_slots) this profile writes reply suggestions with when a chat profile links it; null: none. */
  modelSlotId: number | null
}

/** What prompt builders need of the user: the name they go by and their description ('' when none). */
export type ChatUserPersona = { name: string; persona: string }

export const PLAIN_USER: ChatUserPersona = { name: DEFAULT_USER_NAME, persona: '' }

type Row = { id: number; account_id: number | null; name: string; persona: string; avatar: string | null; is_default: number; sort_order: number; model_slot_id: number | null }

export class ChatUserProfileError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function toProfile(row: Row): ChatUserProfile {
  // A slot that went missing reads as none.
  return { id: row.id, name: row.name, persona: row.persona, avatar: row.avatar, isDefault: row.is_default === 1, sortOrder: row.sort_order, modelSlotId: ModelSlotStore.existing(row.model_slot_id) }
}

function normalizeInput(input: Record<string, unknown>) {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
  const persona = typeof input.persona === 'string' ? input.persona.trim() : ''
  const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : null
  if (!name || name.length > CHAT_USER_PROFILE_LIMITS.name) throw new ChatUserProfileError(`이름은 1~${CHAT_USER_PROFILE_LIMITS.name}자로 정해줘.`)
  // Mentions and speaker lines are parsed by name: `@` and brackets would break them.
  if (/[@[\]]/.test(name)) throw new ChatUserProfileError('이름에 @나 대괄호는 쓸 수 없어.')
  if (persona.length > CHAT_USER_PROFILE_LIMITS.persona) throw new ChatUserProfileError(`설명은 ${CHAT_USER_PROFILE_LIMITS.persona}자까지야.`)
  if (avatar && (avatar.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(avatar))) throw new ChatUserProfileError('아바타 이미지가 너무 크거나 형식이 맞지 않아.')
  // Left out (undefined): an update keeps the model it had.
  let modelSlotId: number | null | undefined
  if (input.modelSlotId === null || input.modelSlotId === '') modelSlotId = null
  else if (input.modelSlotId !== undefined) {
    modelSlotId = ModelSlotStore.existing(input.modelSlotId)
    if (modelSlotId === null) throw new ChatUserProfileError('모델을 찾을 수 없어.')
  }
  return { name, persona, avatar, isDefault: input.isDefault === true, modelSlotId }
}

export const ChatUserProfileStore = {
  list(accountId: number | null) {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_user_profiles WHERE account_id IS ? ORDER BY sort_order, id').all(accountId) as Row[]
    return rows.map(toProfile)
  },

  find(accountId: number | null, profileId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_user_profiles WHERE id = ? AND account_id IS ?').get(profileId, accountId) as Row | undefined
    return row ? toProfile(row) : null
  },

  /** The chat's user profile (null: none attached, or it was deleted). */
  forThread(thread: Pick<CodexChatThreadRecord, 'account_id' | 'user_profile_id'> | null | undefined) {
    if (!thread || thread.user_profile_id === null || thread.user_profile_id === undefined) return null
    return ChatUserProfileStore.find(thread.account_id, thread.user_profile_id)
  },

  /**
   * The profile a new chat gets when none is named: the default one, else the only one; null when there are none or
   * several without a default (the client asks then).
   */
  resolveNew(accountId: number | null) {
    const profiles = ChatUserProfileStore.list(accountId)
    return (profiles.find((profile) => profile.isDefault) ?? (profiles.length === 1 ? profiles[0] : null))?.id ?? null
  },

  /** `id` as this account's profile, or an error; null stays null (no profile). */
  requireOwn(accountId: number | null, id: number | null) {
    if (id === null) return null
    const profile = ChatUserProfileStore.find(accountId, id)
    if (!profile) throw new ChatUserProfileError('사용자 프로필을 찾을 수 없어.', 404)
    return profile
  },

  create(accountId: number | null, input: Record<string, unknown>) {
    const value = normalizeInput(input)
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const { count, last } = db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(sort_order), -1) AS last FROM chat_user_profiles WHERE account_id IS ?').get(accountId) as { count: number; last: number }
      if (count >= CHAT_USER_PROFILE_LIMITS.perAccount) throw new ChatUserProfileError(`사용자 프로필은 ${CHAT_USER_PROFILE_LIMITS.perAccount}개까지 만들 수 있어.`)
      if (value.isDefault) db.prepare('UPDATE chat_user_profiles SET is_default = 0 WHERE account_id IS ?').run(accountId)
      const result = db.prepare('INSERT INTO chat_user_profiles (account_id, name, persona, avatar, is_default, sort_order, model_slot_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(accountId, value.name, value.persona, value.avatar, value.isDefault ? 1 : 0, last + 1, value.modelSlotId ?? null)
      return ChatUserProfileStore.find(accountId, Number(result.lastInsertRowid)) as ChatUserProfile
    })()
  },

  update(accountId: number | null, profileId: number, input: Record<string, unknown>) {
    const value = normalizeInput(input)
    const db = getUserSettingsDb()
    return db.transaction(() => {
      if (value.isDefault) db.prepare('UPDATE chat_user_profiles SET is_default = 0 WHERE account_id IS ?').run(accountId)
      const result = db.prepare('UPDATE chat_user_profiles SET name = ?, persona = ?, avatar = ?, is_default = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ? AND account_id IS ?')
        .run(value.name, value.persona, value.avatar, value.isDefault ? 1 : 0, profileId, accountId)
      if (result.changes && value.modelSlotId !== undefined) db.prepare('UPDATE chat_user_profiles SET model_slot_id = ? WHERE id = ?').run(value.modelSlotId, profileId)
      if (!result.changes) throw new ChatUserProfileError('사용자 프로필을 찾을 수 없어.', 404)
      return ChatUserProfileStore.find(accountId, profileId) as ChatUserProfile
    })()
  },

  /** Chats that used the profile go back to the plain user. */
  delete(accountId: number | null, profileId: number) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const result = db.prepare('DELETE FROM chat_user_profiles WHERE id = ? AND account_id IS ?').run(profileId, accountId)
      if (!result.changes) throw new ChatUserProfileError('사용자 프로필을 찾을 수 없어.', 404)
      db.prepare('UPDATE codex_chat_threads SET user_profile_id = NULL WHERE user_profile_id = ? AND account_id IS ?').run(profileId, accountId)
    })()
  },

  /** The account's profiles in this order; profiles missing from `ids` keep their place after them. */
  reorder(accountId: number | null, ids: number[]) {
    const db = getUserSettingsDb()
    const current = ChatUserProfileStore.list(accountId)
    const ordered = [...ids.flatMap((id) => current.filter((profile) => profile.id === id)), ...current.filter((profile) => !ids.includes(profile.id))]
    db.transaction(() => {
      ordered.forEach((profile, index) => db.prepare('UPDATE chat_user_profiles SET sort_order = ? WHERE id = ?').run(index, profile.id))
    })()
    return ChatUserProfileStore.list(accountId)
  },

  /** Any account's profile by id (a chat profile's suggestion writer; the caller checks whose it is). */
  findById(profileId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_user_profiles WHERE id = ?').get(profileId) as Row | undefined
    return row ? { ...toProfile(row), accountId: row.account_id } : null
  },

  setThreadUserProfile(threadId: number, userProfileId: number | null) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET user_profile_id = ? WHERE id = ?').run(userProfileId, threadId)
  },
}

/** The user as prompt builders see them in this chat: the attached profile, else the plain user. */
export function userPersonaOf(profile: ChatUserProfile | null | undefined): ChatUserPersona {
  return profile ? { name: profile.name, persona: profile.persona } : PLAIN_USER
}

export function userPersonaForThread(thread: Pick<CodexChatThreadRecord, 'account_id' | 'user_profile_id'> | null | undefined) {
  return userPersonaOf(ChatUserProfileStore.forThread(thread))
}

/** The user's section of a persona prompt: who they are to the character ('' for the plain user). */
export function userPersonaPrompt(user: ChatUserPersona | null | undefined) {
  if (!user || (user.name === DEFAULT_USER_NAME && !user.persona)) return ''
  return [`## 사용자`, `이름: ${user.name}`, user.persona].filter(Boolean).join('\n')
}
