import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CodexChatStore, withEngineChange, type ChatEngineChange } from './codexChatStore'
import type { ChatModelPatch } from './chatModelOverride'

export const GROUP_MEMBER_MAX = 6
export const GROUP_LIMITS = {
  /** Bot-to-bot wakes allowed after one user message. */
  chain: { default: 3, min: 0, max: 10 },
  /** Messages handed to a woken member (the rest via the room history tools). */
  window: { default: 30, min: 5, max: 200 },
} as const

export type ChatGroupMember = {
  thread_id: number
  profile_id: number
  member_order: number
  /** The last message a Codex member has in its memory (its own last reply). */
  last_seen_message_id: number | null
  codex_thread_id: string | null
  codex_context_tokens: number | null
  codex_context_window: number | null
  codex_input_tokens: number | null
  codex_cached_input_tokens: number | null
  codex_output_tokens: number | null
  codex_lore_sent: string | null
  /** codexInstructionsFingerprint of the instructions the member's Codex thread started with (null: an older thread). */
  codex_instructions_fingerprint: string | null
  /** This member's reply token cap in the room (null: the room's cap, then the profile's). */
  max_tokens: number | null
  chat_model_slot_id: number | null
  chat_model: string | null
  joined_date: string
}

const RESET_MEMBER_CODEX = `codex_thread_id = NULL, codex_instructions_fingerprint = NULL, last_seen_message_id = NULL, codex_context_tokens = NULL, codex_context_window = NULL,
  codex_input_tokens = NULL, codex_cached_input_tokens = NULL, codex_output_tokens = NULL, codex_lore_sent = NULL`

export function groupLimitsOf(thread: { group_chain_limit: number | null; group_window_limit: number | null }) {
  return {
    chain: thread.group_chain_limit ?? GROUP_LIMITS.chain.default,
    window: thread.group_window_limit ?? GROUP_LIMITS.window.default,
  }
}

export const ChatGroupStore = {
  /** A group room with its members in the given order; the representative answers unaddressed messages. */
  create(accountId: number | null, title: string, profileIds: number[], representativeId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const threadId = CodexChatStore.createThread(accountId, title, 'llm', representativeId)
      db.prepare("UPDATE codex_chat_threads SET kind = 'group' WHERE id = ?").run(threadId)
      ChatGroupStore.addMembers(threadId, profileIds)
      return threadId
    })()
  },

  members(threadId: number) {
    return getUserSettingsDb().prepare('SELECT * FROM chat_group_members WHERE thread_id = ? ORDER BY member_order, joined_date').all(threadId) as ChatGroupMember[]
  },

  /** Member profile ids per group room, for chat lists. */
  memberIdsByThread(threadIds: number[]) {
    const result = new Map<number, number[]>()
    if (threadIds.length === 0) return result
    const rows = getUserSettingsDb().prepare(`SELECT thread_id, profile_id FROM chat_group_members WHERE thread_id IN (${threadIds.map(() => '?').join(', ')}) ORDER BY member_order, joined_date`).all(...threadIds) as Array<{ thread_id: number; profile_id: number }>
    for (const row of rows) result.set(row.thread_id, [...(result.get(row.thread_id) ?? []), row.profile_id])
    return result
  },

  member(threadId: number, profileId: number) {
    return getUserSettingsDb().prepare('SELECT * FROM chat_group_members WHERE thread_id = ? AND profile_id = ?').get(threadId, profileId) as ChatGroupMember | undefined
  },

  addMembers(threadId: number, profileIds: number[]) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      const next = (db.prepare('SELECT COALESCE(MAX(member_order), -1) + 1 AS next FROM chat_group_members WHERE thread_id = ?').get(threadId) as { next: number }).next
      const insert = db.prepare('INSERT OR IGNORE INTO chat_group_members (thread_id, profile_id, member_order) VALUES (?, ?, ?)')
      profileIds.forEach((profileId, index) => insert.run(threadId, profileId, next + index))
    }).immediate()
  },

  /** Returns the member's Codex thread so its memory can be deleted. A leaving representative passes to the earliest member. */
  removeMember(threadId: number, profileId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const member = ChatGroupStore.member(threadId, profileId)
      db.prepare('DELETE FROM chat_group_members WHERE thread_id = ? AND profile_id = ?').run(threadId, profileId)
      const thread = CodexChatStore.findThreadById(threadId)
      if (thread?.profile_id === profileId) {
        db.prepare('UPDATE codex_chat_threads SET profile_id = ? WHERE id = ?').run(ChatGroupStore.members(threadId)[0]?.profile_id ?? null, threadId)
      }
      return member?.codex_thread_id ?? null
    })()
  },

  setRepresentative(threadId: number, profileId: number) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET profile_id = ? WHERE id = ?').run(profileId, threadId)
  },

  /** The room's judge preset (null: none). */
  setJudgePreset(threadId: number, presetId: number | null) {
    getUserSettingsDb().prepare("UPDATE codex_chat_threads SET judge_preset_id = ? WHERE id = ? AND kind = 'group'").run(presetId, threadId)
  },

  setLimits(threadId: number, limits: { chain?: number | null; window?: number | null }) {
    const db = getUserSettingsDb()
    if (limits.chain !== undefined) db.prepare('UPDATE codex_chat_threads SET group_chain_limit = ? WHERE id = ?').run(limits.chain, threadId)
    if (limits.window !== undefined) db.prepare('UPDATE codex_chat_threads SET group_window_limit = ? WHERE id = ?').run(limits.window, threadId)
  },

  /** One member's reply token cap in this room (null follows the room, then the profile). */
  setMemberMaxTokens(threadId: number, profileId: number, maxTokens: number | null) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET max_tokens = ? WHERE thread_id = ? AND profile_id = ?').run(maxTokens, threadId, profileId)
  },

  setMemberChatModel(threadId: number, profileId: number, patch: ChatModelPatch) {
    const db = getUserSettingsDb()
    if (patch.chatModelSlotId !== undefined) db.prepare('UPDATE chat_group_members SET chat_model_slot_id = ? WHERE thread_id = ? AND profile_id = ?').run(patch.chatModelSlotId, threadId, profileId)
    if (patch.chatModel !== undefined) db.prepare('UPDATE chat_group_members SET chat_model = ? WHERE thread_id = ? AND profile_id = ?').run(patch.chatModel, threadId, profileId)
  },

  setLastSeen(threadId: number, profileId: number, messageId: number) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET last_seen_message_id = ? WHERE thread_id = ? AND profile_id = ?').run(messageId, threadId, profileId)
  },

  /** A new Codex thread starts with no memory: no usage, no lore, nothing seen; it keeps the fingerprint of its instructions. */
  setMemberCodexThread(threadId: number, profileId: number, codexThreadId: string, instructionsFingerprint: string) {
    getUserSettingsDb().prepare(`UPDATE chat_group_members SET ${RESET_MEMBER_CODEX} WHERE thread_id = ? AND profile_id = ?`).run(threadId, profileId)
    getUserSettingsDb().prepare('UPDATE chat_group_members SET codex_thread_id = ?, codex_instructions_fingerprint = ? WHERE thread_id = ? AND profile_id = ?').run(codexThreadId, instructionsFingerprint, threadId, profileId)
  },

  /** A member's Codex thread kept from before fingerprints goes on under the current one (never reset for lacking one). */
  adoptMemberInstructionsFingerprint(threadId: number, profileId: number, codexThreadId: string, instructionsFingerprint: string) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET codex_instructions_fingerprint = ? WHERE thread_id = ? AND profile_id = ? AND codex_thread_id = ? AND codex_instructions_fingerprint IS NULL')
      .run(instructionsFingerprint, threadId, profileId, codexThreadId)
  },

  findMemberByCodexId(codexThreadId: string) {
    return getUserSettingsDb().prepare('SELECT * FROM chat_group_members WHERE codex_thread_id = ?').get(codexThreadId) as ChatGroupMember | undefined
  },

  setMemberCodexUsage(codexThreadId: string, usage: { contextTokens: number | null; contextWindow: number | null; inputTokens: number; cachedInputTokens: number; outputTokens: number }) {
    getUserSettingsDb().prepare(`
      UPDATE chat_group_members SET codex_context_tokens = ?, codex_context_window = ?, codex_input_tokens = ?, codex_cached_input_tokens = ?,
      codex_output_tokens = ? WHERE codex_thread_id = ?
    `).run(usage.contextTokens, usage.contextWindow, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, codexThreadId)
  },

  /** Codex folded the member's memory: lore must be given again. */
  markMemberCompacted(codexThreadId: string) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET codex_lore_sent = NULL WHERE codex_thread_id = ?').run(codexThreadId)
  },

  setMemberLoreSent(threadId: number, profileId: number, keys: string[]) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET codex_lore_sent = ? WHERE thread_id = ? AND profile_id = ?').run(keys.length > 0 ? JSON.stringify(keys) : null, threadId, profileId)
  },

  /**
   * A Claude member's session moved on (each turn is a new session id): what it was given, and the latest message it
   * has seen. `loreSent` null after the session folded its memory.
   */
  setMemberClaudeSession(threadId: number, profileId: number, value: string, loreSent: string[] | null, lastSeenMessageId: number) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET codex_thread_id = ?, codex_instructions_fingerprint = NULL, codex_lore_sent = ?, last_seen_message_id = ? WHERE thread_id = ? AND profile_id = ?')
      .run(value, loreSent?.length ? JSON.stringify(loreSent) : null, lastSeenMessageId, threadId, profileId)
  },

  /** The rooms the profile is a member of, for checking none is answering before its engine changes. */
  roomIdsOfProfile(profileId: number) {
    return (getUserSettingsDb().prepare('SELECT thread_id FROM chat_group_members WHERE profile_id = ?').all(profileId) as Array<{ thread_id: number }>).map((row) => row.thread_id)
  },

  /**
   * The member profile's engine changed: in every room it goes on with the new one, its old memory and model override
   * dropped (the room's own engine stays). Each room gets a notice naming the member. Returns the old sessions with
   * the room's owner, to delete.
   */
  switchProfileEngine(profileId: number, from: ChatEngineChange['from'], to: ChatEngineChange['to']) {
    const db = getUserSettingsDb()
    const rows = db.prepare(`SELECT gm.thread_id, t.account_id, gm.codex_thread_id, t.engine_changes,
      (SELECT MAX(m.id) FROM codex_chat_messages m WHERE m.thread_id = gm.thread_id) AS last_message_id
      FROM chat_group_members gm JOIN codex_chat_threads t ON t.id = gm.thread_id WHERE gm.profile_id = ?`).all(profileId) as Array<{ thread_id: number; account_id: number | null; codex_thread_id: string | null; engine_changes: string | null; last_message_id: number | null }>
    db.prepare(`UPDATE chat_group_members SET ${RESET_MEMBER_CODEX}, chat_model_slot_id = NULL, chat_model = NULL WHERE profile_id = ?`).run(profileId)
    const at = new Date().toISOString()
    const notice = db.prepare('UPDATE codex_chat_threads SET engine_changes = ? WHERE id = ?')
    for (const row of rows) {
      if (row.last_message_id !== null) notice.run(withEngineChange(row.engine_changes, { afterMessageId: row.last_message_id, from, to, at, profileId }), row.thread_id)
    }
    return rows.map((row) => ({ threadId: row.thread_id, accountId: row.account_id, codexThreadId: row.codex_thread_id }))
  },

  /** Forget one member's memory of the room; returns its Codex thread (or Claude session value) to delete. */
  resetMemberMemory(threadId: number, profileId: number) {
    const codexThreadId = ChatGroupStore.member(threadId, profileId)?.codex_thread_id ?? null
    getUserSettingsDb().prepare(`UPDATE chat_group_members SET ${RESET_MEMBER_CODEX} WHERE thread_id = ? AND profile_id = ?`).run(threadId, profileId)
    return codexThreadId
  },

  /**
   * A message changed in place (another variant chosen): the members that have it in their memory forget the room —
   * its speaker, and those that saw it before speaking. Returns the members reset.
   */
  resetMemoryOfMessage(threadId: number, messageId: number, speakerProfileId: number | null) {
    return ChatGroupStore.members(threadId)
      .filter((member) => member.codex_thread_id && (member.profile_id === speakerProfileId || (member.last_seen_message_id ?? 0) >= messageId))
      .map((member) => ({ profileId: member.profile_id, codexThreadId: ChatGroupStore.resetMemberMemory(threadId, member.profile_id) }))
  },

  /** Forget every Codex member's memory (history rewritten or cleared); returns the Codex threads to delete. */
  resetCodexMemory(threadId: number) {
    const db = getUserSettingsDb()
    const codexThreadIds = ChatGroupStore.members(threadId).map((member) => member.codex_thread_id).filter((id): id is string => Boolean(id))
    db.prepare(`UPDATE chat_group_members SET ${RESET_MEMBER_CODEX} WHERE thread_id = ?`).run(threadId)
    return codexThreadIds
  },
}
