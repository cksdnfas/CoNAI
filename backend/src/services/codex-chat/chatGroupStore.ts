import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CodexChatStore } from './codexChatStore'

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
  joined_date: string
}

const RESET_MEMBER_CODEX = `codex_thread_id = NULL, last_seen_message_id = NULL, codex_context_tokens = NULL, codex_context_window = NULL,
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
    const next = (db.prepare('SELECT COALESCE(MAX(member_order), -1) + 1 AS next FROM chat_group_members WHERE thread_id = ?').get(threadId) as { next: number }).next
    const insert = db.prepare('INSERT OR IGNORE INTO chat_group_members (thread_id, profile_id, member_order) VALUES (?, ?, ?)')
    profileIds.forEach((profileId, index) => insert.run(threadId, profileId, next + index))
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

  setLimits(threadId: number, limits: { chain?: number | null; window?: number | null }) {
    const db = getUserSettingsDb()
    if (limits.chain !== undefined) db.prepare('UPDATE codex_chat_threads SET group_chain_limit = ? WHERE id = ?').run(limits.chain, threadId)
    if (limits.window !== undefined) db.prepare('UPDATE codex_chat_threads SET group_window_limit = ? WHERE id = ?').run(limits.window, threadId)
  },

  setLastSeen(threadId: number, profileId: number, messageId: number) {
    getUserSettingsDb().prepare('UPDATE chat_group_members SET last_seen_message_id = ? WHERE thread_id = ? AND profile_id = ?').run(messageId, threadId, profileId)
  },

  /** A new Codex thread starts with no memory: no usage, no lore, nothing seen. */
  setMemberCodexThread(threadId: number, profileId: number, codexThreadId: string) {
    getUserSettingsDb().prepare(`UPDATE chat_group_members SET ${RESET_MEMBER_CODEX} WHERE thread_id = ? AND profile_id = ?`).run(threadId, profileId)
    getUserSettingsDb().prepare('UPDATE chat_group_members SET codex_thread_id = ? WHERE thread_id = ? AND profile_id = ?').run(codexThreadId, threadId, profileId)
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

  /** Forget every Codex member's memory (history rewritten or cleared); returns the Codex threads to delete. */
  resetCodexMemory(threadId: number) {
    const db = getUserSettingsDb()
    const codexThreadIds = ChatGroupStore.members(threadId).map((member) => member.codex_thread_id).filter((id): id is string => Boolean(id))
    db.prepare(`UPDATE chat_group_members SET ${RESET_MEMBER_CODEX} WHERE thread_id = ?`).run(threadId)
    return codexThreadIds
  },
}
