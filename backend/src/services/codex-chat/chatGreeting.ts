import { chatGreetings, type ChatProfile } from './chatProfiles'
import { fillCharacterPlaceholders } from './chatPlaceholders'
import type { ChatUserPersona } from './chatUserProfiles'
import { CodexChatStore } from './codexChatStore'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/** Every opening is a variant of the first reply; keep the previewed index active. */
export function addChatGreeting(threadId: number, profile: ChatProfile, user: ChatUserPersona, index?: number | null) {
  const greetings = chatGreetings(profile).map((text) => fillCharacterPlaceholders(text, profile, user))
  if (!greetings.length) return
  const active = typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < greetings.length ? index : Math.floor(Math.random() * greetings.length)
  return getUserSettingsDb().transaction(() => {
    const messageId = CodexChatStore.addMessage({ thread_id: threadId, role: 'assistant', content: greetings[active], tool_calls: [], status: 'completed', error: null })
    const { created_date } = getUserSettingsDb().prepare('SELECT created_date FROM codex_chat_messages WHERE id = ?').get(messageId) as { created_date: string }
    const alternatives = greetings.map((content) => ({ content, tool_calls: [], created_at: created_date, status: 'completed', error: null }))
    getUserSettingsDb().prepare('UPDATE codex_chat_messages SET alternatives = ?, active_alternative = ? WHERE id = ?').run(JSON.stringify(alternatives), active, messageId)
    return messageId
  })()
}
